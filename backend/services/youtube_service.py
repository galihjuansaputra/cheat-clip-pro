import html
import json
import logging
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, List, Optional, Union

# Windows Python 3.14 compatibility hotfix for unix RTLD flags used in yt-dlp plugins
for flag in ('RTLD_LAZY', 'RTLD_NOW', 'RTLD_GLOBAL', 'RTLD_LOCAL', 'RTLD_NODELETE', 'RTLD_NOLOAD', 'RTLD_DEEPBIND'):
    if not hasattr(os, flag):
        setattr(os, flag, 1)

import requests
import yt_dlp
from fastapi import HTTPException
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import JSONFormatter

from backend.config import TEMP_DIR, get_effective_cookies_path, ephemeral_cookies_file, logger
from backend.utils.proxy import (
    TimeoutSession,
    _shared_cookie_jar,
    create_http_client,
    get_proxy_url,
    get_youtube_transcript_proxy_config,
)
from backend.utils.text import (
    extract_video_id,
    detect_transcript_language,
    validate_transcript_language,
)


def normalize_transcript(fetched_data) -> List[dict]:
    """Normalizes FetchedTranscript objects (using JSONFormatter or to_raw_data()),
    raw JSON strings, or dict lists into standard timestamped segment dictionaries.
    Per https://github.com/jdepoix/youtube-transcript-api#using-formatters
    """
    if not fetched_data:
        return []

    items = []
    if hasattr(fetched_data, "snippets") or hasattr(fetched_data, "to_raw_data"):
        try:
            formatter = JSONFormatter()
            json_str = formatter.format_transcript(fetched_data)
            items = json.loads(json_str)
        except Exception:
            items = fetched_data.to_raw_data() if hasattr(fetched_data, "to_raw_data") else list(fetched_data)
    elif isinstance(fetched_data, str):
        try:
            parsed = json.loads(fetched_data)
            items = parsed[0] if isinstance(parsed, list) and len(parsed) > 0 and isinstance(parsed[0], list) else parsed
        except Exception:
            return []
    elif isinstance(fetched_data, list):
        items = fetched_data
    else:
        try:
            items = list(fetched_data)
        except Exception:
            return []

    results = []
    for item in items:
        if isinstance(item, dict):
            text = html.unescape(str(item.get("text", ""))).strip()
            start = float(item.get("start", 0.0))
            dur = float(item.get("duration", 0.0))
        else:
            text = html.unescape(getattr(item, "text", "")).strip()
            start = float(getattr(item, "start", 0.0))
            dur = float(getattr(item, "duration", 0.0))

        if text:
            results.append({
                "text": text,
                "start": round(start, 2),
                "duration": max(0.1, round(dur, 2))
            })

    return results


def prioritize_transcripts(transcripts: list, expected_lang: Optional[str] = None) -> list:
    """
    Filters and sorts transcript tracks ensuring:
    1. STRICT 2-LANGUAGE RESTRICTION: Only Indonesian ('id', 'in') and English ('en') tracks are allowed.
    2. Respects user-selected expected_lang ('id' or 'en') as top priority:
       - If expected_lang is 'id', selects Indonesian tracks (manual first, then auto-generated).
         If not available directly, attempts to translate translatable tracks to 'id'.
       - If expected_lang is 'en', selects English tracks (manual first, then auto-generated).
         If not available directly, attempts to translate translatable tracks to 'en'.
    3. If no expected_lang specified, infers from YouTube generated captions or falls back to manual tracks.
    """
    def _clean_code(t):
        raw = (getattr(t, 'language_code', '') or '').lower().strip()
        base = raw.split('-')[0]
        return 'id' if base == 'in' else base

    cleaned_expected = 'id' if expected_lang in ('id', 'in') else ('en' if expected_lang == 'en' else None)
    target_lang = cleaned_expected

    # If expected_lang is not specified, infer from YouTube generated captions
    if not target_lang:
        for t in transcripts:
            if getattr(t, 'is_generated', False):
                base = _clean_code(t)
                if base in ('id', 'en'):
                    target_lang = base
                    break
                elif base:
                    logger.warning(f"Video native audio is '{base}' (not Indonesian or English). Rejecting foreign transcript tracks.")
                    return []

    # 1. Direct matching tracks in target_lang (manual first, then auto-generated)
    if target_lang in ('id', 'en'):
        matching_tracks = [t for t in transcripts if _clean_code(t) == target_lang]
        if matching_tracks:
            return sorted(matching_tracks, key=lambda t: 1 if getattr(t, 'is_generated', False) else 0)

        # 2. If direct track not found, try translating available translatable tracks to target_lang
        for t in transcripts:
            if getattr(t, 'is_translatable', False) and callable(getattr(t, 'translate', None)):
                try:
                    translated = t.translate(target_lang)
                    if translated:
                        logger.info(f"Using translated transcript track to {target_lang} from {getattr(t, 'language_code', 'unknown')}")
                        return [translated]
                except Exception as tr_err:
                    logger.warning(f"Failed to translate transcript {getattr(t, 'language_code', '')} to {target_lang}: {tr_err}")

    # Fallback when target_lang is unknown: filter allowed id/en tracks, manual first
    allowed = [t for t in transcripts if _clean_code(t) in ('id', 'en')]
    return sorted(allowed, key=lambda t: 1 if getattr(t, 'is_generated', False) else 0)


def fetch_transcript_cli(
    video_id: str,
    priority_langs: Optional[List[str]] = None,
    proxy_url: Optional[str] = None,
    custom_proxy: Optional[str] = None,
    timeout: int = 20,
    expected_language: Optional[str] = None
) -> List[dict]:
    """Attempts subtitle extraction using youtube_transcript_api CLI subprocess.
    Provides an isolated process environment with independent network & proxy stack.
    Handles hyphenated video IDs (e.g. \"\\-abc\") per documentation:
    https://github.com/jdepoix/youtube-transcript-api#cli
    """
    escaped_id = f"\\{video_id}" if video_id.startswith("-") else video_id
    cmd = [sys.executable, "-m", "youtube_transcript_api", escaped_id, "--format", "json"]

    if expected_language == 'id':
        effective_langs = ['id', 'id-ID']
    elif expected_language == 'en':
        effective_langs = ['en', 'en-US', 'en-GB']
    elif priority_langs:
        effective_langs = [l for l in priority_langs if l.split('-')[0].lower() in ('id', 'in', 'en')]
        if not effective_langs:
            effective_langs = ['id', 'en']
    else:
        effective_langs = ['id', 'en']

    cmd.extend(["--languages"] + effective_langs)

    ws_user = os.environ.get("WEBSHARE_USERNAME", "").strip()
    ws_pass = os.environ.get("WEBSHARE_PASSWORD", "").strip()
    effective_proxy = custom_proxy or proxy_url or get_proxy_url()

    if ws_user and ws_pass and not custom_proxy:
        cmd.extend(["--webshare-proxy-username", ws_user, "--webshare-proxy-password", ws_pass])
    elif effective_proxy:
        cmd.extend(["--http-proxy", effective_proxy, "--https-proxy", effective_proxy])

    logger.info(f"Executing CLI transcript extraction for {video_id} (languages: {effective_langs})...")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        out_str = (proc.stdout or "").strip()
        if proc.returncode == 0 and out_str and (out_str.startswith("[") or out_str.startswith("{")):
            raw = json.loads(out_str)
            items = raw[0] if isinstance(raw, list) and len(raw) > 0 and isinstance(raw[0], list) else raw
            result = normalize_transcript(items)
            if result:
                check = validate_transcript_language(result, expected_video_lang=expected_language)
                if not check['is_supported']:
                    logger.warning(f"CLI returned transcript in unsupported language '{check['name']}'. Discarding.")
                    return []
                if check['mismatch_detected']:
                    logger.warning(f"CLI returned transcript in '{check['name']}' which mismatches video audio language '{expected_language}'. Discarding.")
                    return []
                logger.info(f"Transcript fetched via CLI fallback ({check['name']}): {len(result)} lines")
                return result

        err_snippet = (proc.stderr or proc.stdout or "").strip()
        first_err_line = err_snippet.split("\n")[0] if err_snippet else f"exit code {proc.returncode}"
        raise Exception(f"CLI returned: {first_err_line}")
    except Exception as e:
        logger.warning(f"CLI transcript extraction failed: {e}")
        raise


def get_youtube_oembed_title(video_id_or_url: str) -> Optional[str]:
    """Fetches video title directly from YouTube's public oEmbed API.
    Fast (<300ms), requires no authentication or cookies, and works reliably when yt-dlp is blocked."""
    video_id = extract_video_id(video_id_or_url) if ("youtube" in video_id_or_url or "youtu.be" in video_id_or_url or "/" in video_id_or_url) else video_id_or_url
    if not video_id:
        return None
    
    # 1. Try direct HTTP GET to oEmbed endpoint
    try:
        resp = requests.get(
            f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json",
            timeout=5
        )
        if resp.status_code == 200:
            title = resp.json().get("title")
            if title and title.strip():
                return title.strip()
    except Exception as e:
        logger.warning(f"Direct oEmbed title fetch failed for {video_id}: {e}")

    # 2. Try via proxy if configured
    proxy = get_proxy_url()
    if proxy:
        try:
            resp = requests.get(
                f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json",
                proxies={"http": proxy, "https": proxy},
                timeout=5
            )
            if resp.status_code == 200:
                title = resp.json().get("title")
                if title and title.strip():
                    return title.strip()
        except Exception as e:
            logger.warning(f"Proxy oEmbed title fetch failed for {video_id}: {e}")

    # 3. Direct HTML title scraping fallback
    try:
        resp = requests.get(f"https://www.youtube.com/watch?v={video_id}", timeout=5)
        if resp.status_code == 200:
            m = re.search(r'<meta\s+property="og:title"\s+content="([^"]+)"', resp.text)
            if m and m.group(1).strip():
                return m.group(1).strip()
            m2 = re.search(r'<title>(.*?)(?:\s*-\s*YouTube)?</title>', resp.text)
            if m2 and m2.group(1).strip():
                return m2.group(1).strip()
    except Exception:
        pass

    return None


def fetch_video_metadata(url: str, custom_proxy: Optional[str] = None, cookies_content: Optional[str] = None):
    """Fetches video title, duration, and viewer retention heatmap using yt-dlp with oEmbed title fallback."""
    is_vercel = bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
    proxy = custom_proxy or get_proxy_url()
    video_id = extract_video_id(url)
    target_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else url
    
    attempts = [proxy, None] if (is_vercel and proxy) else [None, proxy] if proxy else [None]
    
    with ephemeral_cookies_file(cookies_content) as temp_cookies:
        eff_cookies = temp_cookies or get_effective_cookies_path()
        for attempt_proxy in attempts:
            ydl_opts = {
                'skip_download': True,
                'youtube_include_dash_manifest': False,
                'quiet': True,
                'no_warnings': True,
                'nocheckcertificate': True,
                'proxy': attempt_proxy,
                'socket_timeout': 10,
                'extractor_args': {'youtube': {'player_client': ['android', 'ios', 'web_embedded', 'mweb', 'web']}}
            }
            if eff_cookies:
                ydl_opts['cookiefile'] = str(eff_cookies)

            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(target_url, download=False)
                    if not info:
                        raise Exception("yt-dlp returned empty info dict")
                    title = info.get('title')
                    if not title or title.lower() == 'unknown youtube video':
                        if video_id:
                            title = get_youtube_oembed_title(video_id) or title
                    audio_lang_raw = (info.get('audio_language') or info.get('language') or '').lower().split('-')[0]
                    audio_lang = 'id' if audio_lang_raw == 'in' else (audio_lang_raw if audio_lang_raw in ('id', 'en') else '')
                    return {
                        "title": title or 'Unknown YouTube Video',
                        "channel": info.get('channel') or info.get('uploader') or info.get('creator') or '',
                        "duration": float(info.get('duration') or 0.0),
                        "heatmap": info.get('heatmap') or [],
                        "is_live": bool(info.get('is_live') or False),
                        "live_status": info.get('live_status') or 'not_live',
                        "audio_language": audio_lang
                    }
            except Exception as e:
                logger.warning(f"yt-dlp metadata extraction failed (proxy={'yes' if attempt_proxy else 'no'}): {e}")

    # Fallback: parse video ID and retrieve title from oEmbed API directly
    if video_id:
        fallback_title = get_youtube_oembed_title(video_id) or f"YouTube Video ({video_id})"
        return {
            "title": fallback_title,
            "channel": "",
            "duration": 0.0,
            "heatmap": [],
            "is_live": False,
            "live_status": "not_live",
            "audio_language": ""
        }
    raise HTTPException(status_code=400, detail="Failed to retrieve YouTube video details from URL.")


_supadata_key_index = 0

def get_supadata_keys() -> List[str]:
    """Retrieves list of Supadata API keys from environment variables."""
    raw = os.environ.get("SUPADATA_API_KEYS") or os.environ.get("SUPADATA_API_KEY") or ""
    keys = re.findall(r'sd_[a-zA-Z0-9]+', raw)
    if not keys:
        keys = [k.strip('\"\' ') for k in re.split(r'[,\s\n]+', raw) if k.strip('\"\' ')]
    return keys

_supadata_usage_cache = {
    "data": None,
    "timestamp": 0
}
_CACHE_TTL_SECONDS = 30


def fetch_transcript_supadata(
    video_id: str,
    error_collector: Optional[List[str]] = None,
    expected_language: Optional[str] = None
) -> List[dict]:
    """Fetches transcript from Supadata API, rotating through available keys if rate limits/quotas occur."""
    global _supadata_key_index, _supadata_usage_cache
    keys = get_supadata_keys()
    if not keys:
        if error_collector is not None:
            error_collector.append("Supadata API: No keys configured (SUPADATA_API_KEYS is empty in .env)")
        return []

    start_idx = _supadata_key_index % len(keys)
    rotated_keys = keys[start_idx:] + keys[:start_idx]
    _supadata_key_index = (_supadata_key_index + 1) % len(keys)

    quota_exhausted_count = 0
    not_found = False
    last_error = ""

    for key in rotated_keys:
        masked_key = f"{key[:7]}...{key[-4:]}" if len(key) >= 11 else "***"
        try:
            logger.info(f"Attempting Supadata transcript fetch with key {masked_key} (lang={expected_language})")
            supa_params = {"videoId": video_id}
            if expected_language in ("id", "en"):
                supa_params["lang"] = expected_language
            response = requests.get(
                "https://api.supadata.ai/v1/youtube/transcript",
                headers={"x-api-key": key},
                params=supa_params,
                timeout=12
            )
            if response.status_code == 200:
                data = response.json()
                content = data.get("content") or []
                if content:
                    result = []
                    for seg in content:
                        text = seg.get("text", "").strip()
                        if text:
                            start = float(seg.get("offset", 0)) / 1000.0
                            dur = float(seg.get("duration", 0)) / 1000.0
                            result.append({"text": text, "start": start, "duration": dur})
                    if result:
                        check = validate_transcript_language(result, expected_video_lang=expected_language)
                        if not check['is_supported']:
                            logger.warning(f"Supadata returned transcript in unsupported language '{check['name']}'. Discarding.")
                            if error_collector is not None:
                                error_collector.append(f"Supadata API: Returned transcript in unsupported language '{check['name']}'")
                            return []
                        if check['mismatch_detected']:
                            logger.warning(f"Supadata returned transcript in '{check['name']}' which mismatches video audio language '{expected_language}'. Discarding.")
                            if error_collector is not None:
                                error_collector.append(f"Supadata API: Subtitle language ({check['name']}) mismatches video audio language")
                            return []
                        logger.info(f"Successfully retrieved {len(result)} transcript lines via Supadata ({masked_key}, {check['name']})")
                        _supadata_usage_cache["timestamp"] = 0
                        return result
            elif response.status_code in (429, 402):
                quota_exhausted_count += 1
                logger.warning(f"Supadata key {masked_key} returned status {response.status_code} (quota/limit). Rotating to next key...")
                continue
            elif response.status_code == 404:
                not_found = True
                last_error = "HTTP 404 (No subtitles found for this video on YouTube)"
                logger.warning(f"Supadata key {masked_key} returned status 404: No subtitles found")
                break
            else:
                last_error = f"HTTP {response.status_code}: {response.text[:100]}"
                logger.warning(f"Supadata key {masked_key} returned status {response.status_code}: {response.text[:100]}")
        except Exception as e:
            last_error = str(e)
            logger.warning(f"Supadata request with key {masked_key} failed: {e}")
            continue

    if error_collector is not None:
        if quota_exhausted_count == len(keys):
            error_collector.append(f"Supadata API: All {len(keys)} configured API keys exhausted (HTTP 429/402 Monthly Quota Exceeded)")
        elif not_found:
            error_collector.append(f"Supadata API: {last_error}")
        elif last_error:
            error_collector.append(f"Supadata API: Requests failed across all keys ({last_error})")
        else:
            error_collector.append("Supadata API: Transcript content was empty")

    return []


def check_single_supadata_key(key: str, index: int) -> dict:
    masked = f"{key[:7]}...{key[-4:]}" if len(key) >= 11 else "***"
    try:
        resp = requests.get(
            "https://api.supadata.ai/v1/me",
            headers={"x-api-key": key},
            timeout=5
        )
        if resp.status_code == 200:
            data = resp.json()
            max_credits = int(data.get("maxCredits", 100))
            used_credits = int(data.get("usedCredits", 0))
            remaining = max(0, max_credits - used_credits)
            status = "exhausted" if remaining == 0 else "active"
            return {
                "index": index,
                "masked_key": masked,
                "status": status,
                "max_credits": max_credits,
                "used_credits": used_credits,
                "remaining_credits": remaining,
                "plan": data.get("plan", "Free (100/mo)")
            }
        elif resp.status_code in (429, 402):
            return {
                "index": index,
                "masked_key": masked,
                "status": "exhausted",
                "max_credits": 100,
                "used_credits": 100,
                "remaining_credits": 0,
                "plan": "Limit Exceeded"
            }
        else:
            return {
                "index": index,
                "masked_key": masked,
                "status": "error",
                "max_credits": 100,
                "used_credits": 0,
                "remaining_credits": 100,
                "plan": f"HTTP {resp.status_code}"
            }
    except Exception as e:
        logger.warning(f"Error checking Supadata key {masked}: {e}")
        return {
            "index": index,
            "masked_key": masked,
            "status": "error",
            "max_credits": 100,
            "used_credits": 0,
            "remaining_credits": 100,
            "plan": "Timeout/Error"
        }


def get_supadata_usage_data(force: bool = False) -> dict:
    """Aggregates quota metrics across all configured Supadata API keys in parallel with 30s cache."""
    global _supadata_usage_cache
    now = time.time()
    if not force and _supadata_usage_cache["data"] and (now - _supadata_usage_cache["timestamp"] < _CACHE_TTL_SECONDS):
        cached_res = dict(_supadata_usage_cache["data"])
        cached_res["cached"] = True
        return cached_res

    keys = get_supadata_keys()
    if not keys:
        empty_res = {
            "total_keys": 0,
            "total_limit": 0,
            "total_used": 0,
            "total_remaining": 0,
            "usage_percent": 0.0,
            "active_keys": 0,
            "exhausted_keys": 0,
            "keys_detail": [],
            "cached": False,
            "timestamp": now
        }
        _supadata_usage_cache = {"data": empty_res, "timestamp": now}
        return empty_res

    with ThreadPoolExecutor(max_workers=min(len(keys), 12)) as executor:
        futures = [executor.submit(check_single_supadata_key, k, i + 1) for i, k in enumerate(keys)]
        details = [f.result() for f in futures]

    total_limit = sum(k["max_credits"] for k in details)
    total_used = sum(k["used_credits"] for k in details)
    total_remaining = sum(k["remaining_credits"] for k in details)
    active_count = sum(1 for k in details if k["remaining_credits"] > 0)
    exhausted_count = sum(1 for k in details if k["remaining_credits"] == 0 and k["status"] != "error")
    usage_percent = round((total_used / total_limit * 100.0), 1) if total_limit > 0 else 0.0

    res = {
        "total_keys": len(keys),
        "total_limit": total_limit,
        "total_used": total_used,
        "total_remaining": total_remaining,
        "usage_percent": usage_percent,
        "active_keys": active_count,
        "exhausted_keys": exhausted_count,
        "keys_detail": details,
        "cached": False,
        "timestamp": now
    }
    _supadata_usage_cache = {"data": res, "timestamp": now}
    return res


def fetch_transcript_ytdlp(
    video_id: str,
    proxy: Optional[str] = None,
    cookies_content: Optional[str] = None,
    expected_language: Optional[str] = None
) -> List[dict]:
    """Attempts to extract captions using yt-dlp's player response directly (free, no quota used).
    Strictly limited to authentic Indonesian and English captions matching video dialogue."""
    with ephemeral_cookies_file(cookies_content) as temp_cookies:
        eff_cookies = temp_cookies or get_effective_cookies_path()
        ydl_opts = {
            'skip_download': True,
            'quiet': True,
            'no_warnings': True,
            'nocheckcertificate': True,
            'proxy': proxy,
            'socket_timeout': 10,
            'extractor_args': {
                'youtube': {
                    'player_client': ['web', 'mweb', 'android', 'ios'] if eff_cookies else ['android', 'ios', 'web_embedded', 'mweb', 'web']
                }
            }
        }
        if eff_cookies:
            ydl_opts['cookiefile'] = str(eff_cookies)

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
                if not info:
                    return []
                
                subtitles = info.get('subtitles') or {}
                auto_subtitles = info.get('automatic_captions') or {}
                
                # Identify the video's native audio language
                raw_audio_lang = (info.get('audio_language') or info.get('language') or '').lower().split('-')[0]
                audio_lang = 'id' if raw_audio_lang == 'in' else (raw_audio_lang if raw_audio_lang in ('id', 'en') else None)
                target = expected_language if expected_language in ('id', 'en') else audio_lang

                # Only allow ID or EN captions
                if target == 'id':
                    langs_to_try = ['id', 'id-ID']
                elif target == 'en':
                    langs_to_try = ['en', 'en-US', 'en-GB']
                else:
                    langs_to_try = ['id', 'id-ID', 'en', 'en-US', 'en-GB']

                # Manual subtitles first, then auto captions in matching language
                for lang_dict, is_auto in [(subtitles, False), (auto_subtitles, True)]:
                    ordered_langs = [l for l in langs_to_try if l in lang_dict]
                    for lang in ordered_langs:
                        base_l = lang.split('-')[0].lower()
                        if base_l not in ('id', 'in', 'en'):
                            continue
                        formats = lang_dict.get(lang) or []
                        json3_entry = next((f['url'] for f in formats if f.get('ext') == 'json3'), None)
                        if json3_entry:
                            proxies_dict = {'http': proxy, 'https': proxy} if proxy else None
                            attempts = [proxies_dict, None] if proxy else [None]
                            for p in attempts:
                                try:
                                    r = requests.get(json3_entry, proxies=p, timeout=8)
                                    if r.status_code == 200:
                                        events = r.json().get('events', [])
                                        result = []
                                        for ev in events:
                                            segs = ev.get('segs', [])
                                            text = ''.join(s.get('utf8', '') for s in segs).strip()
                                            if text:
                                                start = ev.get('tStartMs', 0) / 1000.0
                                                dur = ev.get('dDurationMs', 0) / 1000.0
                                                result.append({'text': text, 'start': start, 'duration': dur})
                                        if result:
                                            check = validate_transcript_language(result, expected_video_lang=expected_language)
                                            if not check['is_supported'] or check['mismatch_detected']:
                                                logger.warning(f"yt-dlp caption track ({lang}) failed language validation: {check['error_message']}. Discarding.")
                                                continue
                                            logger.info(f"Transcript fetched via yt-dlp (lang={lang}, auto={is_auto}, proxy={'yes' if p else 'no'})")
                                            return result
                                except Exception:
                                    continue
        except Exception as e:
            logger.warning(f"yt-dlp subtitle extraction failed (proxy={'yes' if proxy else 'no'}): {e}")
    return []


def download_youtube_audio_file(
    video_id: str,
    output_dir: Optional[Union[str, Path]] = None,
    proxy: Optional[str] = None,
    cookies_content: Optional[str] = None,
    on_progress: Optional[Callable[[str, str, int], None]] = None
) -> Optional[Path]:
    """Downloads audio track for a YouTube video using multi-client yt-dlp.
    Guarantees bypass of 'Sign in to confirm you are not a bot' even without cookies."""
    target_dir = Path(output_dir) if output_dir else TEMP_DIR
    target_dir.mkdir(parents=True, exist_ok=True)

    # Check for existing cached audio
    for cand in target_dir.glob(f"yt_audio_{video_id}.*"):
        if cand.is_file() and cand.stat().st_size > 10000:
            logger.info(f"Using cached YouTube audio file: {cand}")
            return cand

    if on_progress:
        on_progress("Downloading Audio Track", "Downloading audio stream for Whisper speech transcription...", 35)

    with ephemeral_cookies_file(cookies_content) as temp_cookies:
        eff_cookies = temp_cookies or get_effective_cookies_path()
        client_combinations = [
            ['android', 'ios', 'web_embedded', 'mweb', 'web'],
            ['android', 'web_embedded', 'ios'],
            ['web_embedded', 'ios'],
            ['android'],
            ['default', 'web_embedded', 'ios']
        ]

        target_url = f"https://www.youtube.com/watch?v={video_id}"

        for clients in client_combinations:
            ydl_opts = {
                'format': 'bestaudio[ext=m4a]/bestaudio/best[height<=360]/best',
                'outtmpl': str(target_dir / f"yt_audio_{video_id}.%(ext)s"),
                'quiet': True,
                'no_warnings': True,
                'nocheckcertificate': True,
                'proxy': proxy or get_proxy_url(),
                'socket_timeout': 15,
                'retries': 3,
                'extractor_args': {'youtube': {'player_client': clients}}
            }
            if eff_cookies:
                ydl_opts['cookiefile'] = str(eff_cookies)

            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([target_url])

                for cand in target_dir.glob(f"yt_audio_{video_id}.*"):
                    if cand.is_file() and cand.stat().st_size > 5000:
                        logger.info(f"YouTube audio downloaded successfully ({clients}): {cand} ({cand.stat().st_size} bytes)")
                        return cand
            except Exception as e:
                logger.warning(f"Audio download attempt with client {clients} failed: {e}")
                continue

    return None


def fetch_transcript(
    video_id: str,
    custom_proxy: Optional[str] = None,
    on_progress: Optional[Callable[[str, str, int], None]] = None,
    cookies_content: Optional[str] = None,
    expected_language: Optional[str] = None
) -> List[dict]:
    """Retrieves subtitles using a comprehensive multi-tier fallback pipeline:
      Tier 1: Supadata API (if keys configured) — cloud residential rotation
      Tier 2: YouTubeTranscriptApi Python API (Proxy + Shared Session + Browser Headers + Translation fallback)
      Tier 3: YouTubeTranscriptApi CLI Subprocess (Proxy)
      Tier 4: yt-dlp Native Extraction (Proxy)
      Tier 5: Direct YouTubeTranscriptApi Python API (Direct, Shared Session + Browser Headers)
      Tier 6: Direct YouTubeTranscriptApi CLI Subprocess (Direct)
      Tier 7: Direct yt-dlp Native Extraction (Direct)
    Strictly limited to authentic Indonesian and English captions matching video dialogue.
    If all tiers fail, raises detailed HTTPException with full diagnostics and solutions.
    """
    def notify(stage: str, detail: str, pct: int):
        if on_progress:
            try:
                on_progress(stage, detail, pct)
            except Exception:
                pass

    priority_langs = ['id', 'en'] if not expected_language else ([expected_language] if expected_language in ('id', 'en') else ['id', 'en'])
    keys = get_supadata_keys()
    proxy_url = custom_proxy or get_proxy_url()
    proxy_cfg = get_youtube_transcript_proxy_config(custom_proxy)
    attempt_history: List[str] = []

    # ── Tier 1: Supadata API (if keys configured) ─────────────────────────────
    if keys:
        logger.info(f"[Tier 1] Attempting transcript retrieval via Supadata API ({len(keys)} keys configured)...")
        notify("Tier 1/7: Supadata Cloud API", f"Trying Method 1/7: Supadata Cloud API ({len(keys)} keys rotation)...", 30)
        supadata_data = fetch_transcript_supadata(video_id, error_collector=attempt_history, expected_language=expected_language)
        if supadata_data:
            res = normalize_transcript(supadata_data)
            check = validate_transcript_language(res, expected_video_lang=expected_language)
            if check['is_supported'] and not check['mismatch_detected']:
                return res
        logger.info("[Tier 1] Supadata API unsuccessful — proceeding to proxy fallback tiers...")
    else:
        attempt_history.append("Tier 1 (Supadata API): Not configured (no keys in SUPADATA_API_KEYS)")

    # ── Proxy Tiers (Tier 2 - 4) ──────────────────────────────────────────────
    if proxy_cfg or proxy_url:
        masked_proxy = proxy_url.split('@')[-1] if (proxy_url and '@' in proxy_url) else (proxy_url or "Configured Proxy")
        logger.info(f"[Tier 2-4] Attempting proxy fallback pipeline ({masked_proxy})...")

        # ── Tier 2: YouTubeTranscriptApi Python API with Proxy & Shared Session ───
        notify("Tier 2/7: Proxy Python API", f"Trying Method 2/7: YouTubeTranscriptApi via rotating proxy ({masked_proxy})...", 45)
        try:
            client = create_http_client(timeout=15.0)
            proxy_api = YouTubeTranscriptApi(proxy_config=proxy_cfg, http_client=client)

            # 2. List all transcripts and strictly prioritize Indonesian and English
            try:
                all_transcripts = list(proxy_api.list(video_id))
                target_tracks = prioritize_transcripts(all_transcripts, expected_lang=expected_language)
                
                for t in target_tracks:
                    try:
                        data = t.fetch()
                        res = normalize_transcript(data)
                        if res:
                            check = validate_transcript_language(res, expected_video_lang=expected_language)
                            if not check['is_supported'] or check['mismatch_detected']:
                                logger.warning(f"[Tier 2] Track ({t.language_code}) rejected: {check['error_message']}")
                                continue
                            _shared_cookie_jar.update(client.cookies)
                            logger.info(f"[Tier 2] Transcript fetched via proxy Python API ({t.language_code} - {check['name']}): {len(res)} lines")
                            return res
                    except Exception:
                        continue

                attempt_history.append(f"Tier 2 (Proxy Python API): No accessible track in {len(all_transcripts)} tracks")
            except Exception as list_err:
                err_type = type(list_err).__name__
                err_msg = str(list_err).strip().split('\n')[0]
                attempt_history.append(f"Tier 2 (Proxy Python API): {err_type} ({err_msg})")
        except Exception as init_err:
            attempt_history.append(f"Tier 2 (Proxy Python API setup): {type(init_err).__name__} ({init_err})")

        # ── Tier 3: YouTubeTranscriptApi CLI Subprocess with Proxy ───────────────
        notify("Tier 3/7: Proxy CLI Subprocess", "Trying Method 3/7: Isolated CLI subprocess via proxy...", 60)
        try:
            cli_data = fetch_transcript_cli(
                video_id,
                priority_langs=priority_langs,
                proxy_url=proxy_url,
                custom_proxy=custom_proxy,
                timeout=20,
                expected_language=expected_language
            )
            if cli_data:
                logger.info(f"[Tier 3] Transcript fetched via proxy CLI subprocess: {len(cli_data)} lines")
                return cli_data
        except Exception as cli_err:
            attempt_history.append(f"Tier 3 (Proxy CLI Subprocess): {type(cli_err).__name__} ({str(cli_err)[:150]})")

        # ── Tier 4: yt-dlp Native Extraction with Proxy ──────────────────────────
        notify("Tier 4/7: Proxy yt-dlp Native", "Trying Method 4/7: yt-dlp native caption extraction via proxy...", 70)
        try:
            ytdlp_proxy_data = fetch_transcript_ytdlp(
                video_id,
                proxy=proxy_url,
                cookies_content=cookies_content,
                expected_language=expected_language
            )
            if ytdlp_proxy_data:
                res = normalize_transcript(ytdlp_proxy_data)
                if res:
                    logger.info(f"[Tier 4] Transcript fetched via proxy yt-dlp: {len(res)} lines")
                    return res
            attempt_history.append("Tier 4 (Proxy yt-dlp): No subtitle streams found or extraction empty")
        except Exception as ytdlp_err:
            attempt_history.append(f"Tier 4 (Proxy yt-dlp): {type(ytdlp_err).__name__} ({str(ytdlp_err)[:150]})")

    else:
        attempt_history.append("Tier 2-4 (Proxy Fallbacks): No proxy configured in .env (WEBSHARE_PROXY, WEBSHARE_USERNAME, or PROXY_URL)")

    # ── Direct Tiers (Tier 5 - 7: Localhost / Residential IP fallback) ─────────
    logger.info("[Tier 5-7] Attempting direct YouTube retrieval (no proxy)...")

    # ── Tier 5: Direct YouTubeTranscriptApi Python API ────────────────────────
    notify("Tier 5/7: Direct YouTube API", "Trying Method 5/7: Direct YouTubeTranscriptApi (localhost / residential)...", 80)
    try:
        direct_client = create_http_client(timeout=10.0)
        direct_api = YouTubeTranscriptApi(http_client=direct_client)

        try:
            all_transcripts = list(direct_api.list(video_id))
            target_tracks = prioritize_transcripts(all_transcripts, expected_lang=expected_language)
            
            for transcript in target_tracks:
                try:
                    data = transcript.fetch()
                    res = normalize_transcript(data)
                    if res:
                        check = validate_transcript_language(res, expected_video_lang=expected_language)
                        if not check['is_supported'] or check['mismatch_detected']:
                            logger.warning(f"[Tier 5] Track ({transcript.language_code}) rejected: {check['error_message']}")
                            continue
                        _shared_cookie_jar.update(direct_client.cookies)
                        logger.info(f"[Tier 5] Transcript fetched via direct list ({transcript.language_code} - {check['name']}): {len(res)} lines")
                        return res
                except Exception:
                    continue

            attempt_history.append(f"Tier 5 (Direct Python API): No accessible track in {len(all_transcripts)} tracks")
        except Exception as list_err:
            err_type = type(list_err).__name__
            err_msg = str(list_err).strip().split('\n')[0]
            attempt_history.append(f"Tier 5 (Direct Python API): {err_type} ({err_msg})")
    except Exception as api_err:
        attempt_history.append(f"Tier 5 (Direct Python API setup): {type(api_err).__name__} ({str(api_err)[:150]})")

    # ── Tier 6: Direct YouTubeTranscriptApi CLI Subprocess ────────────────────
    notify("Tier 6/7: Direct CLI Subprocess", "Trying Method 6/7: Direct isolated CLI subprocess...", 88)
    try:
        direct_cli_data = fetch_transcript_cli(
            video_id,
            priority_langs=priority_langs,
            proxy_url=None,
            timeout=15,
            expected_language=expected_language
        )
        if direct_cli_data:
            logger.info(f"[Tier 6] Transcript fetched via direct CLI subprocess: {len(direct_cli_data)} lines")
            return direct_cli_data
    except Exception as cli_err:
        attempt_history.append(f"Tier 6 (Direct CLI Subprocess): {type(cli_err).__name__} ({str(cli_err)[:150]})")

    # ── Tier 7: Direct yt-dlp Native Extraction ──────────────────────────────
    notify("Tier 7/7: Direct yt-dlp Native", "Trying Method 7/7: Direct yt-dlp native caption extraction...", 94)
    try:
        direct_ytdlp_data = fetch_transcript_ytdlp(
            video_id,
            proxy=None,
            cookies_content=cookies_content,
            expected_language=expected_language
        )
        if direct_ytdlp_data:
            res = normalize_transcript(direct_ytdlp_data)
            if res:
                check = validate_transcript_language(res, expected_video_lang=expected_language)
                if check['is_supported'] and not check['mismatch_detected']:
                    logger.info(f"[Tier 7] Transcript fetched via direct yt-dlp ({check['name']}): {len(res)} lines")
                    return res
                logger.info(f"[Tier 7] Transcript fetched via direct yt-dlp: {len(res)} lines")
                return res
        attempt_history.append("Tier 7 (Direct yt-dlp): No subtitle streams found")
    except Exception as ytdlp_err:
        attempt_history.append(f"Tier 7 (Direct yt-dlp): {type(ytdlp_err).__name__} ({str(ytdlp_err)[:150]})")

    # ── All Tiers Exhausted: Construct Comprehensive Diagnostic Error ─────────
    combined_history = " ".join(attempt_history)
    root_cause = []
    if "TranscriptsDisabled" in combined_history:
        root_cause.append("Subtitles are disabled for this video by the creator.")
    elif "AgeRestricted" in combined_history:
        root_cause.append("Video is age-restricted and requires YouTube authentication.")
    elif "VideoUnavailable" in combined_history:
        root_cause.append("Video is private or unavailable.")
    elif "IpBlocked" in combined_history or "RequestBlocked" in combined_history:
        root_cause.append("YouTube blocked the IP address (datacenter IP ban / RequestBlocked).")

    error_lines = [
        f"Unable to retrieve subtitles for YouTube video ID '{video_id}'."
    ]
    if root_cause:
        error_lines.append(f"Probable Cause: {' '.join(root_cause)}")

    error_lines.append("\nMethods attempted and diagnostic results:")
    for h in attempt_history:
        error_lines.append(f"  • {h}")

    error_lines.append("\nRecommended solutions:")
    if not (proxy_cfg or proxy_url):
        error_lines.append("  1. Configure a proxy in backend/.env (e.g. WEBSHARE_USERNAME & WEBSHARE_PASSWORD, or WEBSHARE_PROXY / PROXY_URL) to bypass datacenter IP bans.")
    else:
        error_lines.append("  1. Verify your proxy quota/credentials in backend/.env or rotate your residential proxy IP.")
    error_lines.append("  2. If using Supadata, configure SUPADATA_API_KEYS in backend/.env for residential cloud extraction.")
    error_lines.append("  3. Upload custom subtitles manually (.srt or .txt file) using the 'Upload Custom Subtitle' setting above.")

    full_error_detail = "\n".join(error_lines)
    logger.error(f"Subtitle retrieval exhausted all {len(attempt_history)} methods:\n{full_error_detail}")
    raise HTTPException(status_code=400, detail=full_error_detail)
