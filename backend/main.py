import os
import sys

# Windows Python 3.14 compatibility hotfix for unix RTLD flags and uname used in yt-dlp plugins
for flag in ('RTLD_LAZY', 'RTLD_NOW', 'RTLD_GLOBAL', 'RTLD_LOCAL', 'RTLD_NODELETE', 'RTLD_NOLOAD', 'RTLD_DEEPBIND'):
    if not hasattr(os, flag):
        setattr(os, flag, 1)

if not hasattr(os, 'uname'):
    from collections import namedtuple
    UnameResult = namedtuple('UnameResult', ['sysname', 'nodename', 'release', 'version', 'machine'])
    os.uname = lambda: UnameResult('Windows', 'localhost', '10', '10.0', 'AMD64')

from dotenv import load_dotenv

# Automatically load environment variables from backend/.env or root .env
_base_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_base_dir, ".env"))
load_dotenv(os.path.join(_base_dir, "..", ".env"))
load_dotenv()

import re
import logging
import asyncio
import json
import time
import uuid
import zipfile
import subprocess
import shutil
import html
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urlsplit
from typing import List, Optional, Dict, Any, Tuple, Callable
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.responses import StreamingResponse, RedirectResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import requests
import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import JSONFormatter
from youtube_transcript_api.proxies import WebshareProxyConfig, GenericProxyConfig
from google import genai
from google.genai import types

try:
    from backend.video_engine import (
        TEMP_DIR,
        EXPORTS_DIR,
        COOKIES_PATH,
        ROOT_COOKIES_PATH,
        get_effective_cookies_path,
        download_clip_segment,
        download_full_raw_video,
        transcribe_clip_words,
        generate_ass_file,
        render_clip_to_mp4,
        extract_clip_frame,
        detect_speaker_face_box,
        detect_hardware_support,
        ACTIVE_ENCODER_NAME,
        ACTIVE_ENCODER_ARGS,
        has_emoji,
        render_title_overlay_png,
        is_valid_mp4
    )
except ImportError:
    from video_engine import (
        TEMP_DIR,
        EXPORTS_DIR,
        COOKIES_PATH,
        ROOT_COOKIES_PATH,
        get_effective_cookies_path,
        download_clip_segment,
        download_full_raw_video,
        transcribe_clip_words,
        generate_ass_file,
        render_clip_to_mp4,
        extract_clip_frame,
        detect_speaker_face_box,
        detect_hardware_support,
        ACTIVE_ENCODER_NAME,
        ACTIVE_ENCODER_ARGS,
        has_emoji,
        render_title_overlay_png,
        is_valid_mp4
    )
# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cheat-clip-pro")

UPLOADS_DIR = TEMP_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="CHEAT CLIP PRO API", description="AI Powered YouTube Auto Clipper")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------------------
# Pydantic Schemas for Gemini Structured Output
# ----------------------------------------------------------------

class ViralClip(BaseModel):
    title: str = Field(description="Catchy clip title, max 8 words. MUST NEVER use first-person pronouns ('I', 'me', 'my', 'saya', 'aku'). Attribute to the speaker/host by name, role, or use objective framing.")
    start_time: float = Field(description="Clip start in seconds, aligned to a sentence boundary")
    end_time: float = Field(description="Clip end in seconds, aligned to a sentence boundary")
    hook_time: float = Field(description="Absolute timestamp in seconds from video start where the potential hook occurs inside this clip range (must be >= start_time and <= end_time)")
    virality_score: int = Field(description="Virality score 1-100")
    key_quotes: List[str] = Field(description="1-2 key quotes from the clip")
    transcript: str = Field(description="Spoken text of the clip")
    title_suggestion: str = Field(default="", description="Catchy alternative title suggestion. MUST NEVER use first-person pronouns ('I', 'me', 'my'). Attribute to speaker or objective topic.")
    caption_suggestion: str = Field(default="", description="Engaging social media caption suggestion attributing quotes or insights to the speaker.")
    hashtag_suggestion: str = Field(default="", description="Relevant hashtags suggestion (e.g. #hashtag1 #hashtag2)")

class ViralClipGemini(BaseModel):
    title: str = Field(description="Catchy clip title, max 8 words, in the EXACT SAME LANGUAGE as the video transcript (STRICT ZERO-TRANSLATION RULE: English is English, Indonesian is Indonesian, Spanish is Spanish). NEVER use first-person pronouns ('I', 'me', 'my', 'myself', 'aku', 'saya'). Attribute to the person speaking by name, host/guest title, or use third-person objective framing so it does not look like the user's opinion.")
    start_time: float = Field(description="Clip start in seconds, aligned to a sentence boundary")
    end_time: float = Field(description="Clip end in seconds, aligned to a sentence boundary")
    hook_time: float = Field(description="Absolute timestamp in seconds from video start where the potential hook occurs inside this clip range (must be >= start_time and <= end_time)")
    virality_score: int = Field(description="Virality score 1-100")
    key_quotes: List[str] = Field(description="1-2 verbatim quotes directly spoken in the clip, in the original language of the video without translation")
    title_suggestion: str = Field(default="", description="Catchy alternative title suggestion in the EXACT SAME LANGUAGE as the video transcript (DO NOT translate). STRICT RULE: NEVER use first-person ('I', 'me', 'my', 'saya', 'aku'). Attribute to the speaker/host/guest by name or topic.")
    caption_suggestion: str = Field(default="", description="Engaging social media caption suggestion written in the EXACT SAME LANGUAGE as the video transcript (DO NOT translate to any other language), attributing insights or story to the speaker.")
    hashtag_suggestion: str = Field(default="", description="Relevant hashtags suggestion in the SAME LANGUAGE as the video transcript (e.g. #hashtag1 #hashtag2)")

class VideoAnalysis(BaseModel):
    summary: str = Field(description="1-2 sentence video summary in the EXACT SAME LANGUAGE as the video transcript (STRICT ZERO-TRANSLATION RULE: English stays English, Indonesian stays Indonesian, Spanish stays Spanish), followed by 2-4 relevant hashtags")
    clips: List[ViralClipGemini] = Field(description="List of viral clip candidates, sorted by virality_score desc")

# ----------------------------------------------------------------
# API Request/Response Schemas
# ----------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    url: str = Field(..., description="YouTube video URL")
    duration: str = Field("30s", description="Target clip duration: '15s', '30s', or '60s'")
    api_key: Optional[str] = Field(None, description="Optional custom Gemini API key provided by the user")
    model: Optional[str] = Field("gemini-2.5-flash", description="Preferred Gemini model name")
    custom_prompt: Optional[str] = Field(None, description="Optional custom focus prompt for clips search")
    range_start: Optional[float] = Field(None, description="Search range start in seconds")
    range_end: Optional[float] = Field(None, description="Search range end in seconds")
    subtitles: Optional[str] = Field(None, description="Optional manual subtitles text (SRT or TXT)")
    subtitles_filename: Optional[str] = Field(None, description="Optional manual subtitles filename")
    target_clip_count: Optional[int] = Field(None, description="Optional target number of clips (1-50)")
    proxy: Optional[str] = Field(None, description="Optional custom proxy URL")

class HeatmapPoint(BaseModel):
    start_time: float
    end_time: float
    value: float

class TranscriptLine(BaseModel):
    start: float
    end: float
    text: str
    engagement: Optional[float] = None

class AnalyzeResponse(BaseModel):
    video_id: str
    title: str
    channel: Optional[str] = None
    duration: float
    heatmap: List[HeatmapPoint]
    summary: str
    clips: List[ViralClip]
    transcript: Optional[List[TranscriptLine]] = None
    model: Optional[str] = None

# ----------------------------------------------------------------
# Helper Functions
# ----------------------------------------------------------------

def parse_time_str(time_str: str) -> float:
    """Parses time string in formats like HH:MM:SS,mmm or MM:SS,mmm or HH:MM:SS or MM:SS to seconds."""
    time_str = time_str.strip().replace(',', '.')
    # Extract millisecond if present
    ms = 0.0
    if '.' in time_str:
        parts = time_str.split('.')
        time_str = parts[0]
        try:
            ms = float('0.' + parts[1])
        except ValueError:
            pass
            
    time_parts = time_str.split(':')
    try:
        if len(time_parts) == 3:
            return int(time_parts[0]) * 3600 + int(time_parts[1]) * 60 + int(time_parts[2]) + ms
        elif len(time_parts) == 2:
            return int(time_parts[0]) * 60 + int(time_parts[1]) + ms
        elif len(time_parts) == 1:
            return float(time_parts[0]) + ms
    except ValueError:
        return 0.0

def parse_manual_subtitles(content: str, default_duration: float = 0.0) -> List[dict]:
    # Normalize line endings
    content = content.replace('\r\n', '\n').strip()
    
    # 1. Try standard SRT parsing first
    # SRT block regex: index (optional), time range, text
    # e.g.,
    # 1
    # 00:00:01,000 --> 00:00:04,500
    # Hello
    srt_regex = r'(?:\d+\n)?(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\n(.*?)(?=\n\n|\n\d+\n|\Z)'
    srt_matches = re.findall(srt_regex, content, re.DOTALL)
    
    if srt_matches:
        results = []
        for start_str, end_str, text in srt_matches:
            start = parse_time_str(start_str)
            end = parse_time_str(end_str)
            cleaned_text = text.replace('\n', ' ').strip()
            results.append({
                "text": cleaned_text,
                "start": start,
                "duration": max(0.1, end - start)
            })
        if results:
            return results

    # 2. Try parsing line-by-line for timestamped lines
    # Patterns:
    # [00:12] Hello or 00:12 Hello
    # [01:02:15] Hello or 01:02:15 Hello
    # [00:12 - 00:15] Hello or 00:12 - 00:15 Hello
    # Let's match timestamp patterns at the start of the line or enclosed in brackets/parens
    line_time_range_regex = r'^[\[\(]?(\d{1,2}:\d{2}(?::\d{2})?(?:[,.]\d{1,3})?)\s*(?:-|-->|\s)\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[,.]\d{1,3})?)[\]\)]?\s*(.*)'
    line_single_time_regex = r'^[\[\(]?(\d{1,2}:\d{2}(?::\d{2})?(?:[,.]\d{1,3})?)[\]\)]?\s*(.*)'
    
    lines = content.split('\n')
    results = []
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Match range first (e.g. 00:12 - 00:15 Text)
        m_range = re.match(line_time_range_regex, line)
        if m_range:
            start_str, end_str, text = m_range.groups()
            start = parse_time_str(start_str)
            end = parse_time_str(end_str)
            results.append({
                "text": text.strip(),
                "start": start,
                "duration": max(0.1, end - start)
            })
            continue
            
        # Match single timestamp (e.g. 00:12 Text)
        m_single = re.match(line_single_time_regex, line)
        if m_single:
            start_str, text = m_single.groups()
            start = parse_time_str(start_str)
            results.append({
                "text": text.strip(),
                "start": start,
                "duration": -1.0  # Will fill in later
            })
            continue

    if results:
        # Resolve duration for single timestamps
        # Set duration to the difference between next start and current start, or a default 3.0s
        for i in range(len(results)):
            if results[i]["duration"] == -1.0:
                if i < len(results) - 1:
                    next_start = results[i+1]["start"]
                    diff = next_start - results[i]["start"]
                    results[i]["duration"] = max(0.5, diff)
                else:
                    results[i]["duration"] = 3.0  # default for the last line
        return results

    # 3. Fallback: split text into paragraphs or sentences and distribute evenly across video duration
    duration_to_use = default_duration if default_duration > 0 else 60.0
    # Clean multiple newlines and split by sentences
    sentences = re.split(r'(?<=[.!?])\s+|\n+', content)
    sentences = [s.strip() for s in sentences if s.strip()]
    
    if sentences:
        num_sentences = len(sentences)
        sec_per_sentence = duration_to_use / num_sentences
        results = []
        for i, text in enumerate(sentences):
            start = i * sec_per_sentence
            results.append({
                "text": text,
                "start": round(start, 2),
                "duration": round(sec_per_sentence, 2)
            })
        return results
        
    return []


def extract_video_id(url: str) -> Optional[str]:
    """Extracts the 11-character YouTube video ID from various URL formats including live streams, shorts, embed, watch?v=, youtu.be, etc."""
    if not url:
        return None
    trimmed = url.strip()
    # Direct 11-char ID
    if re.match(r"^[a-zA-Z0-9_-]{11}$", trimmed):
        return trimmed

    patterns = [
        # Standard query parameter: ?v=VIDEO_ID or &v=VIDEO_ID
        r"(?:[?&]v=)([a-zA-Z0-9_-]{11})",
        # Path-based formats: /live/VIDEO_ID, /shorts/VIDEO_ID, /embed/VIDEO_ID, /v/VIDEO_ID, youtu.be/VIDEO_ID
        r"(?:youtu\.be\/|(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:embed|v|shorts|live)\/)([a-zA-Z0-9_-]{11})",
        # General fallback matching any path or query prefix
        r"(?:v=|\/v\/|embed\/|shorts\/|live\/|youtu\.be\/|\/embed\/|\/watch\?v=|\/watch\?.+&v=)([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, trimmed)
        if match:
            return match.group(1)

    return None

class TimeoutSession(requests.Session):
    """requests.Session that enforces a default timeout to avoid hanging indefinitely on slow proxies."""
    def __init__(self, timeout: float = 12.0):
        super().__init__()
        self._default_timeout = timeout

    def request(self, *args, **kwargs):
        kwargs.setdefault("timeout", self._default_timeout)
        return super().request(*args, **kwargs)

def get_proxy_url() -> Optional[str]:
    """Retrieves proxy URL from environment variables or synthesizes from Webshare credentials."""
    proxy = (
        os.environ.get("PROXY_URL")
        or os.environ.get("WEBSHARE_PROXY")
        or os.environ.get("HTTPS_PROXY")
        or os.environ.get("HTTP_PROXY")
        or os.environ.get("ALL_PROXY")
        or ""
    ).strip()
    if proxy:
        return proxy

    # Synthesize URL from explicit Webshare credentials if provided
    ws_user = os.environ.get("WEBSHARE_USERNAME", "").strip()
    ws_pass = os.environ.get("WEBSHARE_PASSWORD", "").strip()
    if ws_user and ws_pass:
        ws_locations_raw = os.environ.get("WEBSHARE_LOCATIONS", "").strip()
        loc_suffix = "".join(f"-{loc.strip().upper()}" for loc in ws_locations_raw.split(",") if loc.strip())
        user_clean = ws_user[:-7] if ws_user.endswith("-rotate") else ws_user
        return f"http://{user_clean}{loc_suffix}-rotate:{ws_pass}@p.webshare.io:80"

    return None

def get_youtube_transcript_proxy_config(custom_proxy: Optional[str] = None):
    """
    Constructs a ProxyConfig (WebshareProxyConfig or GenericProxyConfig)
    for YouTubeTranscriptApi per official recommendations:
    https://github.com/jdepoix/youtube-transcript-api#working-around-ip-bans-requestblocked-or-ipblocked-exception
    """
    ws_locations_raw = os.environ.get("WEBSHARE_LOCATIONS", "").strip()
    ws_locations = [loc.strip() for loc in ws_locations_raw.split(",") if loc.strip()] if ws_locations_raw else None
    try:
        ws_retries = int(os.environ.get("WEBSHARE_RETRIES", "5"))
    except ValueError:
        ws_retries = 5

    # 1. Explicit Webshare credentials from environment
    ws_user = os.environ.get("WEBSHARE_USERNAME", "").strip()
    ws_pass = os.environ.get("WEBSHARE_PASSWORD", "").strip()
    if not custom_proxy and ws_user and ws_pass:
        return WebshareProxyConfig(
            proxy_username=ws_user,
            proxy_password=ws_pass,
            filter_ip_locations=ws_locations,
            retries_when_blocked=ws_retries
        )

    # 2. Check full proxy URL (custom_proxy or from get_proxy_url())
    proxy_url = (custom_proxy or get_proxy_url() or "").strip()
    if not proxy_url:
        return None

    # Check if this proxy URL points to Webshare
    if "webshare.io" in proxy_url.lower():
        try:
            parsed = urlsplit(proxy_url)
            if parsed.username and parsed.password:
                domain = parsed.hostname or "p.webshare.io"
                port = parsed.port or 80
                return WebshareProxyConfig(
                    proxy_username=parsed.username,
                    proxy_password=parsed.password,
                    domain_name=domain,
                    proxy_port=port,
                    filter_ip_locations=ws_locations,
                    retries_when_blocked=ws_retries
                )
        except Exception as e:
            logger.warning(f"Failed parsing Webshare URL for WebshareProxyConfig: {e}")

    # 3. GenericProxyConfig fallback for non-Webshare proxies
    try:
        return GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
    except Exception as e:
        logger.warning(f"Failed creating GenericProxyConfig: {e}")
        return None

# ── Shared Cookie Jar & HTTP Session Factory ──────────────────────────────────
# Per https://github.com/jdepoix/youtube-transcript-api#overwriting-request-defaults
# Caching cookies across requests (consent screens, visitor tokens) and setting
# realistic browser headers minimizes automated bot blocks on YouTube.
_shared_cookie_jar = requests.cookies.RequestsCookieJar()

def create_http_client(timeout: float = 15.0) -> TimeoutSession:
    """Creates a requests.Session pre-configured with realistic browser headers,
    shared YouTube cookies (consent/tokens), and optional CA bundle per documentation:
    https://github.com/jdepoix/youtube-transcript-api#overwriting-request-defaults
    """
    session = TimeoutSession(timeout=timeout)
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1"
    })
    # Inherit verified session cookies across requests
    session.cookies.update(_shared_cookie_jar)

    # SSL verification certificate override if defined
    ca_bundle = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
    if ca_bundle and os.path.exists(ca_bundle):
        session.verify = ca_bundle

    return session

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

def fetch_transcript_cli(
    video_id: str,
    priority_langs: List[str],
    proxy_url: Optional[str] = None,
    custom_proxy: Optional[str] = None,
    timeout: int = 20
) -> List[dict]:
    """Attempts subtitle extraction using youtube_transcript_api CLI subprocess.
    Provides an isolated process environment with independent network & proxy stack.
    Handles hyphenated video IDs (e.g. \"\\-abc\") per documentation:
    https://github.com/jdepoix/youtube-transcript-api#cli
    """
    escaped_id = f"\\{video_id}" if video_id.startswith("-") else video_id
    cmd = [sys.executable, "-m", "youtube_transcript_api", escaped_id, "--format", "json"]

    if priority_langs:
        cmd.extend(["--languages"] + priority_langs)

    ws_user = os.environ.get("WEBSHARE_USERNAME", "").strip()
    ws_pass = os.environ.get("WEBSHARE_PASSWORD", "").strip()
    effective_proxy = custom_proxy or proxy_url or get_proxy_url()

    if ws_user and ws_pass and not custom_proxy:
        cmd.extend(["--webshare-proxy-username", ws_user, "--webshare-proxy-password", ws_pass])
    elif effective_proxy:
        cmd.extend(["--http-proxy", effective_proxy, "--https-proxy", effective_proxy])

    logger.info(f"Executing CLI transcript extraction for {video_id}...")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if proc.returncode == 0 and proc.stdout.strip():
            raw = json.loads(proc.stdout)
            items = raw[0] if isinstance(raw, list) and len(raw) > 0 and isinstance(raw[0], list) else raw
            result = normalize_transcript(items)
            if result:
                logger.info(f"Transcript fetched via CLI fallback: {len(result)} lines")
                return result
        stderr_snippet = (proc.stderr or proc.stdout or "").strip()
        first_err_line = stderr_snippet.split("\n")[0] if stderr_snippet else f"exit code {proc.returncode}"
        raise Exception(f"CLI returned {proc.returncode}: {first_err_line}")
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

def fetch_video_metadata(url: str, custom_proxy: Optional[str] = None):
    """Fetches video title, duration, and viewer retention heatmap using yt-dlp with oEmbed title fallback."""
    is_vercel = bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
    proxy = custom_proxy or get_proxy_url()
    video_id = extract_video_id(url)
    target_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else url
    
    attempts = [proxy, None] if (is_vercel and proxy) else [None, proxy] if proxy else [None]
    
    for attempt_proxy in attempts:
        ydl_opts = {
            'skip_download': True,
            'youtube_include_dash_manifest': False,
            'quiet': True,
            'no_warnings': True,
            'nocheckcertificate': True,
            'proxy': attempt_proxy,
            'socket_timeout': 10
        }
        eff_cookies = get_effective_cookies_path()
        if eff_cookies:
            ydl_opts['cookiefile'] = str(eff_cookies)
        ydl_opts['extractor_args'] = {'youtube': {'player_client': ['default', 'web_embedded', 'ios']}}

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(target_url, download=False)
                if not info:
                    raise Exception("yt-dlp returned empty info dict")
                title = info.get('title')
                if not title or title.lower() == 'unknown youtube video':
                    if video_id:
                        title = get_youtube_oembed_title(video_id) or title
                return {
                    "title": title or 'Unknown YouTube Video',
                    "channel": info.get('channel') or info.get('uploader') or info.get('creator') or '',
                    "duration": float(info.get('duration') or 0.0),
                    "heatmap": info.get('heatmap') or [],
                    "is_live": bool(info.get('is_live') or False),
                    "live_status": info.get('live_status') or 'not_live'
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
            "live_status": "not_live"
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

def fetch_transcript_supadata(video_id: str, error_collector: Optional[List[str]] = None) -> List[dict]:
    """Fetches transcript from Supadata API, rotating through available keys if rate limits/quotas occur."""
    global _supadata_key_index
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
            logger.info(f"Attempting Supadata transcript fetch with key {masked_key}")
            response = requests.get(
                "https://api.supadata.ai/v1/youtube/transcript",
                headers={"x-api-key": key},
                params={"videoId": video_id},
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
                        logger.info(f"Successfully retrieved {len(result)} transcript lines via Supadata ({masked_key})")
                        global _supadata_usage_cache
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

_supadata_usage_cache = {
    "data": None,
    "timestamp": 0
}
_CACHE_TTL_SECONDS = 30

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

def fetch_transcript_ytdlp(video_id: str, proxy: Optional[str] = None) -> List[dict]:
    """Attempts to extract captions using yt-dlp's player response directly (free, no quota used).
    Can be run direct (proxy=None) or routed through a proxy."""
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
        'proxy': proxy,
        'socket_timeout': 10
    }
    eff_cookies = get_effective_cookies_path()
    if eff_cookies:
        ydl_opts['cookiefile'] = str(eff_cookies)
    ydl_opts['extractor_args'] = {'youtube': {'player_client': ['default', 'web_embedded', 'ios']}}

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            if not info:
                return []
            
            subtitles = info.get('subtitles') or {}
            auto_subtitles = info.get('automatic_captions') or {}
            
            priority_langs = ['id', 'en', 'es', 'pt', 'fr', 'de', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'ar', 'hi', 'ru']
            for lang_dict, is_auto in [(subtitles, False), (auto_subtitles, True)]:
                langs_to_try = [l for l in priority_langs if l in lang_dict] + [l for l in lang_dict if l not in priority_langs]
                for lang in langs_to_try:
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
                                        logger.info(f"Transcript fetched via yt-dlp (lang={lang}, auto={is_auto}, proxy={'yes' if p else 'no'})")
                                        return result
                            except Exception:
                                continue
    except Exception as e:
        logger.warning(f"yt-dlp subtitle extraction failed (proxy={'yes' if proxy else 'no'}): {e}")
    return []

def fetch_transcript(
    video_id: str,
    custom_proxy: Optional[str] = None,
    on_progress: Optional[Callable[[str, str, int], None]] = None
) -> List[dict]:
    """Retrieves subtitles using a comprehensive multi-tier fallback pipeline:
      Tier 1: Supadata API (if keys configured) — cloud residential rotation
      Tier 2: YouTubeTranscriptApi Python API (Proxy + Shared Session + Browser Headers + Translation fallback)
      Tier 3: YouTubeTranscriptApi CLI Subprocess (Proxy)
      Tier 4: yt-dlp Native Extraction (Proxy)
      Tier 5: Direct YouTubeTranscriptApi Python API (Direct, Shared Session + Browser Headers)
      Tier 6: Direct YouTubeTranscriptApi CLI Subprocess (Direct)
      Tier 7: Direct yt-dlp Native Extraction (Direct)
    If all tiers fail, raises detailed HTTPException with full diagnostics and solutions.
    """
    def notify(stage: str, detail: str, pct: int):
        if on_progress:
            try:
                on_progress(stage, detail, pct)
            except Exception:
                pass

    priority_langs = ['id', 'en', 'es', 'pt', 'fr', 'de', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'ar', 'hi', 'ru']
    keys = get_supadata_keys()
    proxy_url = custom_proxy or get_proxy_url()
    proxy_cfg = get_youtube_transcript_proxy_config(custom_proxy)
    attempt_history: List[str] = []

    # ── Tier 1: Supadata API (if keys configured) ─────────────────────────────
    if keys:
        logger.info(f"[Tier 1] Attempting transcript retrieval via Supadata API ({len(keys)} keys configured)...")
        notify("Tier 1/7: Supadata Cloud API", f"Trying Method 1/7: Supadata Cloud API ({len(keys)} keys rotation)...", 30)
        supadata_data = fetch_transcript_supadata(video_id, error_collector=attempt_history)
        if supadata_data:
            return normalize_transcript(supadata_data)
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

            # 2a. Direct language match
            try:
                data = proxy_api.fetch(video_id, languages=priority_langs)
                res = normalize_transcript(data)
                if res:
                    _shared_cookie_jar.update(client.cookies)
                    logger.info(f"[Tier 2a] Transcript fetched via proxy Python API direct: {len(res)} lines")
                    return res
            except Exception as direct_err:
                logger.info(f"[Tier 2a] Proxy direct language fetch missed: {direct_err}")

            # 2b. List all transcripts & try fetching manual, then auto
            try:
                transcripts = list(proxy_api.list(video_id))
                manual = [t for t in transcripts if not getattr(t, 'is_generated', False)]
                generated = [t for t in transcripts if getattr(t, 'is_generated', False)]
                for t in (manual + generated):
                    try:
                        data = t.fetch()
                        res = normalize_transcript(data)
                        if res:
                            _shared_cookie_jar.update(client.cookies)
                            logger.info(f"[Tier 2b] Transcript fetched via proxy Python API list ({t.language}): {len(res)} lines")
                            return res
                    except Exception:
                        continue

                # 2c. Translation fallback: translate any translatable track to 'id' or 'en'
                for t in transcripts:
                    if getattr(t, 'is_translatable', False):
                        for target_lang in ['id', 'en']:
                            try:
                                notify("Tier 2/7: Translating Captions", f"Translating available {t.language} track to {target_lang} via proxy...", 52)
                                translated = t.translate(target_lang)
                                data = translated.fetch()
                                res = normalize_transcript(data)
                                if res:
                                    _shared_cookie_jar.update(client.cookies)
                                    logger.info(f"[Tier 2c] Transcript translated via proxy Python API ({t.language} -> {target_lang}): {len(res)} lines")
                                    return res
                            except Exception:
                                continue

                attempt_history.append(f"Tier 2 (Proxy Python API): No accessible track in {len(transcripts)} tracks")
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
                priority_langs,
                proxy_url=proxy_url,
                custom_proxy=custom_proxy,
                timeout=20
            )
            if cli_data:
                logger.info(f"[Tier 3] Transcript fetched via proxy CLI subprocess: {len(cli_data)} lines")
                return cli_data
        except Exception as cli_err:
            attempt_history.append(f"Tier 3 (Proxy CLI Subprocess): {type(cli_err).__name__} ({str(cli_err)[:150]})")

        # ── Tier 4: yt-dlp Native Extraction with Proxy ──────────────────────────
        notify("Tier 4/7: Proxy yt-dlp Native", "Trying Method 4/7: yt-dlp native caption extraction via proxy...", 70)
        try:
            ytdlp_proxy_data = fetch_transcript_ytdlp(video_id, proxy=proxy_url)
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
            data = direct_api.fetch(video_id, languages=priority_langs)
            res = normalize_transcript(data)
            if res:
                _shared_cookie_jar.update(direct_client.cookies)
                logger.info(f"[Tier 5a] Transcript fetched via direct Python API: {len(res)} lines")
                return res
        except Exception:
            pass

        try:
            all_transcripts = list(direct_api.list(video_id))
            manual = [t for t in all_transcripts if not getattr(t, 'is_generated', False)]
            generated = [t for t in all_transcripts if getattr(t, 'is_generated', False)]
            for transcript in (manual + generated):
                try:
                    data = transcript.fetch()
                    res = normalize_transcript(data)
                    if res:
                        _shared_cookie_jar.update(direct_client.cookies)
                        logger.info(f"[Tier 5b] Transcript fetched via direct list ({transcript.language}): {len(res)} lines")
                        return res
                except Exception:
                    continue

            # Direct translation fallback
            for t in all_transcripts:
                if getattr(t, 'is_translatable', False):
                    for target_lang in ['id', 'en']:
                        try:
                            notify("Tier 5/7: Translating Captions", f"Translating available {t.language} track to {target_lang} directly...", 84)
                            translated = t.translate(target_lang)
                            data = translated.fetch()
                            res = normalize_transcript(data)
                            if res:
                                _shared_cookie_jar.update(direct_client.cookies)
                                logger.info(f"[Tier 5c] Transcript translated via direct list ({t.language} -> {target_lang}): {len(res)} lines")
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
        direct_cli_data = fetch_transcript_cli(video_id, priority_langs, proxy_url=None, timeout=15)
        if direct_cli_data:
            logger.info(f"[Tier 6] Transcript fetched via direct CLI subprocess: {len(direct_cli_data)} lines")
            return direct_cli_data
    except Exception as cli_err:
        attempt_history.append(f"Tier 6 (Direct CLI Subprocess): {type(cli_err).__name__} ({str(cli_err)[:150]})")

    # ── Tier 7: Direct yt-dlp Native Extraction ──────────────────────────────
    notify("Tier 7/7: Direct yt-dlp Native", "Trying Method 7/7: Direct yt-dlp native caption extraction...", 94)
    try:
        direct_ytdlp_data = fetch_transcript_ytdlp(video_id, proxy=None)
        if direct_ytdlp_data:
            res = normalize_transcript(direct_ytdlp_data)
            if res:
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





def lowercase_hashtags_in_string(text: str) -> str:
    """Finds all hashtags (#word) in a string and converts them to lowercase."""
    if not text:
        return text
    return re.sub(r'#\w+', lambda m: m.group(0).lower(), text)

LANGUAGE_NAMES = {
    'id': 'Indonesian (Bahasa Indonesia)',
    'en': 'English',
    'es': 'Spanish (Español)',
    'pt': 'Portuguese (Português)',
    'fr': 'French (Français)',
    'de': 'German (Deutsch)',
    'ja': 'Japanese (日本語)',
    'ko': 'Korean (한국어)',
    'zh': 'Chinese (中文)',
    'ar': 'Arabic (العربية)',
    'ru': 'Russian (Русский)',
}

ID_STOPWORDS = {
    'yang', 'dan', 'di', 'ini', 'itu', 'dengan', 'untuk', 'tidak', 'dari', 'dalam',
    'akan', 'pada', 'juga', 'ke', 'karena', 'bisa', 'ada', 'mereka', 'sudah', 'kita',
    'saya', 'kamu', 'orang', 'jadi', 'lagi', 'kalo', 'kalau', 'ya', 'banget', 'bukan',
    'tapi', 'sama', 'tau', 'tahu', 'gimana', 'kenapa', 'seperti', 'apa', 'nah', 'udah',
    'nih', 'dong', 'kan', 'lah', 'bang', 'mas', 'mbak', 'kak', 'nggak', 'gak', 'aja',
    'bener', 'gitu', 'adalah', 'oleh', 'secara', 'tersebut', 'pun', 'kok', 'deh', 'sih',
    'gue', 'lu', 'lo', 'luar', 'biasa', 'hanya', 'sangat', 'bagi', 'antara', 'tentang',
    'banyak', 'kurang', 'harus', 'mau', 'maupun', 'saat', 'ketika', 'terus', 'pasti',
    'masih', 'punya', 'makanya', 'ngomong', 'bikin'
}

EN_STOPWORDS = {
    'the', 'and', 'to', 'of', 'a', 'in', 'that', 'is', 'it', 'you', 'for', 'on',
    'are', 'as', 'with', 'they', 'at', 'be', 'this', 'have', 'from', 'or', 'one',
    'had', 'by', 'but', 'not', 'what', 'all', 'were', 'we', 'when', 'your', 'can',
    'there', 'an', 'which', 'she', 'do', 'how', 'their', 'if', 'will', 'up', 'about',
    'out', 'so', 'would', 'like', 'just', 'know', 'people', 'think', 'going', 'been',
    'them', 'some', 'could', 'him', 'into', 'other', 'than', 'then', 'now', 'look',
    'only', 'come', 'its', 'over', 'also', 'back', 'after', 'use', 'two', 'our',
    'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
    'give', 'day', 'most', 'us', 'time', 'really', 'something', 'good', 'make'
}

ES_STOPWORDS = {
    'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por',
    'un', 'para', 'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'más', 'pero',
    'sus', 'le', 'ya', 'o', 'este', 'sí', 'porque', 'esta', 'son', 'entre',
    'está', 'cuando', 'muy', 'sin', 'sobre', 'ser', 'tiene', 'también', 'me',
    'hasta', 'hay', 'donde', 'quien', 'desde', 'todo', 'nos', 'durante', 'todos',
    'uno', 'les', 'ni', 'contra', 'otros', 'ese', 'eso', 'ante', 'ellos', 'esto'
}

PT_STOPWORDS = {
    'de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'é', 'com',
    'não', 'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como',
    'mas', 'foi', 'ao', 'ele', 'das', 'tem', 'à', 'seu', 'sua', 'ou', 'ser',
    'quando', 'muito', 'há', 'nos', 'já', 'está', 'eu', 'também', 'só', 'pelo',
    'pela', 'você', 'isso', 'ela', 'entre', 'depois'
}

FR_STOPWORDS = {
    'de', 'la', 'le', 'et', 'les', 'des', 'en', 'un', 'du', 'une', 'que', 'est',
    'pour', 'qui', 'dans', 'a', 'par', 'plus', 'pas', 'au', 'sur', 'ne', 'se',
    'ce', 'il', 'sont', 'avec', 'son', 'cette', 'aux', 'ses', 'mais', 'ou',
    'ont', 'tout', 'comme', 'nous', 'sa', 'vous'
}

DE_STOPWORDS = {
    'der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich', 'des',
    'auf', 'für', 'ist', 'im', 'dem', 'nicht', 'ein', 'eine', 'als', 'auch',
    'es', 'an', 'werden', 'aus', 'er', 'hat', 'dass', 'sie', 'nach', 'wird',
    'bei', 'einer', 'um', 'am', 'sind', 'noch', 'wie', 'einem', 'über'
}

def detect_transcript_language(transcript_lines: List[dict], title: str = "") -> dict:
    """
    Detects the primary spoken language of the video transcript using character script inspection
    and stopword analysis across Indonesian, English, Spanish, Portuguese, French, German, and others.
    Returns dict: {'code': 'id', 'name': 'Indonesian (Bahasa Indonesia)', 'confidence': float}
    """
    if not transcript_lines and not title:
        return {'code': 'en', 'name': 'English', 'confidence': 0.5}

    sample_texts = [title] if title else []
    for line in (transcript_lines[:150] if transcript_lines else []):
        t = line.get("text", "")
        if t:
            sample_texts.append(t)
    
    full_sample = " ".join(sample_texts).strip()
    if not full_sample:
        return {'code': 'en', 'name': 'English', 'confidence': 0.5}

    # 1. Non-Latin script checks
    if re.search(r'[\u3040-\u309F\u30A0-\u30FF]', full_sample):
        return {'code': 'ja', 'name': LANGUAGE_NAMES['ja'], 'confidence': 0.98}
    if re.search(r'[\uAC00-\uD7AF\u1100-\u11FF]', full_sample):
        return {'code': 'ko', 'name': LANGUAGE_NAMES['ko'], 'confidence': 0.98}
    if re.search(r'[\u4E00-\u9FFF]', full_sample):
        return {'code': 'zh', 'name': LANGUAGE_NAMES['zh'], 'confidence': 0.95}
    if re.search(r'[\u0600-\u06FF]', full_sample):
        return {'code': 'ar', 'name': LANGUAGE_NAMES['ar'], 'confidence': 0.98}
    if re.search(r'[\u0400-\u04FF]', full_sample):
        return {'code': 'ru', 'name': LANGUAGE_NAMES['ru'], 'confidence': 0.98}

    # 2. Latin word tokenization
    tokens = re.findall(r'\b[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]+\b', full_sample.lower())
    if not tokens:
        return {'code': 'en', 'name': 'English', 'confidence': 0.5}

    counts = {
        'id': sum(1 for w in tokens if w in ID_STOPWORDS),
        'en': sum(1 for w in tokens if w in EN_STOPWORDS),
        'es': sum(1 for w in tokens if w in ES_STOPWORDS),
        'pt': sum(1 for w in tokens if w in PT_STOPWORDS),
        'fr': sum(1 for w in tokens if w in FR_STOPWORDS),
        'de': sum(1 for w in tokens if w in DE_STOPWORDS),
    }

    best_lang, best_score = max(counts.items(), key=lambda item: item[1])
    total_matches = sum(counts.values())
    confidence = round(best_score / total_matches, 2) if total_matches > 0 else 0.5

    # If match count is very small, cross-check with title words
    if best_score < 2:
        title_tokens = set(re.findall(r'\b[a-zA-Z]+\b', title.lower()))
        if title_tokens.intersection(ID_STOPWORDS):
            return {'code': 'id', 'name': LANGUAGE_NAMES['id'], 'confidence': 0.75}
        if title_tokens.intersection(ES_STOPWORDS):
            return {'code': 'es', 'name': LANGUAGE_NAMES['es'], 'confidence': 0.75}
        return {'code': 'en', 'name': 'English', 'confidence': 0.5}

    return {
        'code': best_lang,
        'name': LANGUAGE_NAMES.get(best_lang, best_lang.upper()),
        'confidence': confidence
    }

def sanitize_first_person_title(title: str, speaker_or_channel: str = "", lang: str = "en") -> str:
    """
    Sanitizes accidental first-person perspective ('I', 'Me', 'My', 'Saya', 'Aku', 'Gue')
    from generated clip titles and title suggestions, replacing them with speaker or channel attribution,
    or objective framing so titles never appear as the user's personal opinion.
    Preserves the target language (Indonesian, English, Spanish, etc.).
    """
    if not title:
        return title
    t = title.strip()
    speaker = speaker_or_channel.strip() if speaker_or_channel else ""
    if lang == "id":
        subject = speaker if speaker else "Host"
    elif lang == "es":
        subject = speaker if speaker else "El Presentador"
    else:
        subject = speaker if speaker else "The Speaker"

    # 1. English Why / How / What / When / Where
    t = re.sub(r"^why\s+i\s+think\b", f"{subject} Explains Why", t, flags=re.IGNORECASE)
    t = re.sub(r"^why\s+i\s+believe\b", f"{subject} Explains Why", t, flags=re.IGNORECASE)
    t = re.sub(r"^why\s+i\s+", f"Why {subject} ", t, flags=re.IGNORECASE)
    t = re.sub(r"^how\s+i\s+", f"How {subject} ", t, flags=re.IGNORECASE)
    t = re.sub(r"^what\s+i\s+think\b", f"{subject}'s Thoughts On", t, flags=re.IGNORECASE)
    t = re.sub(r"^what\s+i\s+learned\b", f"What {subject} Learned", t, flags=re.IGNORECASE)
    t = re.sub(r"^what\s+i\s+", f"What {subject} ", t, flags=re.IGNORECASE)
    t = re.sub(r"^when\s+i\s+", f"When {subject} ", t, flags=re.IGNORECASE)
    t = re.sub(r"^where\s+i\s+", f"Where {subject} ", t, flags=re.IGNORECASE)

    # 2. English My [Noun] (e.g. My Opinion, My Story, My Regret)
    t = re.sub(r"^my\s+([a-zA-Z]+)", lambda m: f"{subject}'s {m.group(1)}" if speaker else f"The {m.group(1)}", t, flags=re.IGNORECASE)

    # 3. English First-person action verbs (e.g. I Tried, I Discovered, I Built)
    t = re.sub(r"^i\s+(tried|found|made|discovered|bought|quit|lost|learned|realized|spent|built|saw|went|started|joined|left|hate|love)\b", rf"{subject} \1", t, flags=re.IGNORECASE)
    t = re.sub(r"^i\s+was\b", f"{subject} Was", t, flags=re.IGNORECASE)
    t = re.sub(r"^i\s+am\b", f"{subject} Is", t, flags=re.IGNORECASE)
    t = re.sub(r"^i\s+have\b", f"{subject} Has", t, flags=re.IGNORECASE)
    t = re.sub(r"^i\s+had\b", f"{subject} Had", t, flags=re.IGNORECASE)
    t = re.sub(r"^i\s+got\b", f"{subject} Got", t, flags=re.IGNORECASE)
    t = re.sub(r"^i\s+think\b", f"{subject} Thinks", t, flags=re.IGNORECASE)
    t = re.sub(r"^i\s+believe\b", f"{subject} Believes", t, flags=re.IGNORECASE)

    # 4. Indonesian / Malay first-person replacements (Saya, Aku, Gue, Gw)
    indo_subject = speaker if speaker else "Host"
    t = re.sub(r"^(kenapa|mengapa)\s+(saya|aku|gue|gw)\s+", rf"\1 {indo_subject} ", t, flags=re.IGNORECASE)
    t = re.sub(r"^(cara|bagaimana)\s+(saya|aku|gue|gw)\s+", rf"Cara {indo_subject} ", t, flags=re.IGNORECASE)
    t = re.sub(r"^(alasan)\s+(saya|aku|gue|gw)\s+", rf"Alasan {indo_subject} ", t, flags=re.IGNORECASE)
    t = re.sub(r"^(saya|aku|gue|gw)\s+(mencoba|menemukan|membuat|yakin|berpikir|menyesal|kehilangan|belajar|mulai|berhenti)\b", rf"{indo_subject} \2", t, flags=re.IGNORECASE)
    t = re.sub(r"^(pendapat|opini)\s+(saya|aku|gue|gw)\b", rf"Opini {indo_subject}", t, flags=re.IGNORECASE)

    return t.strip()

def get_average_heatmap_value(start: float, end: float, heatmap: List[dict]) -> float:
    """Calculates the average retention score from the heatmap for a transcript time segment."""
    if not heatmap:
        return 0.0
    
    overlaps = []
    for point in heatmap:
        p_start = point.get('start_time', 0.0)
        p_end = point.get('end_time', 0.0)
        p_val = point.get('value', 0.0)
        
        # Check if heatmap point overlaps with transcript segment
        if max(start, p_start) < min(end, p_end):
            overlaps.append(p_val)
            
    if overlaps:
        return sum(overlaps) / len(overlaps)
        
    # Fallback to closest point if no direct overlap matches
    closest_val = 0.0
    min_dist = float('inf')
    mid_time = (start + end) / 2.0
    for point in heatmap:
        p_mid = (point.get('start_time', 0.0) + point.get('end_time', 0.0)) / 2.0
        dist = abs(p_mid - mid_time)
        if dist < min_dist:
            min_dist = dist
            closest_val = point.get('value', 0.0)
    return closest_val

# ----------------------------------------------------------------
# Routes
# ----------------------------------------------------------------

def _sse(data: dict) -> str:
    """Format a dict as a Server-Sent Event string."""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

@app.get("/api/health")
def health_check(refresh: bool = False):
    is_vercel = bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
    keys = get_supadata_keys()
    proxy = get_proxy_url()
    has_gemini = bool(os.environ.get("GEMINI_API_KEY"))
    supadata_info = get_supadata_usage_data(force=refresh) if keys else {
        "total_keys": 0,
        "total_limit": 0,
        "total_used": 0,
        "total_remaining": 0,
        "usage_percent": 0.0,
        "active_keys": 0,
        "exhausted_keys": 0,
        "keys_detail": [],
        "status": "not_configured"
    }
    return {
        "status": "ok",
        "message": "CHEAT CLIP PRO API is active",
        "is_vercel": is_vercel,
        "proxy_configured": bool(proxy),
        "gemini_env_configured": has_gemini,
        "supadata_keys_count": len(keys),
        "supadata": supadata_info
    }

@app.get("/api/supadata-usage")
def supadata_usage_endpoint(refresh: bool = False):
    """Returns real-time usage and remaining credit quota across all configured Supadata API keys."""
    return get_supadata_usage_data(force=refresh)



def parse_gemini_model_sort_key(name: str):
    """Sort key for Gemini models: parses major and minor versions (e.g. 3.7, 3.6, 3.5, 2.5, 2.0, 1.5),
    tier (standard > lite/8b > preview/exp), so newest and most capable models come first."""
    name_clean = (name or "").split('/')[-1].lower()
    m = re.search(r'(\d+)(?:\.(\d+))?', name_clean)
    if m:
        major = int(m.group(1))
        minor = int(m.group(2)) if m.group(2) is not None else 0
    else:
        major, minor = 0, 0

    if 'lite' in name_clean or '8b' in name_clean:
        tier = 2
    elif 'exp' in name_clean or 'preview' in name_clean:
        tier = 1
    else:
        tier = 3

    return (major, minor, tier, name_clean)


KNOWN_FLASH_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
]

def get_flash_models_for_key(client: genai.Client) -> List[str]:
    """Dynamically query all available flash models for the given API key.
    Discovers newer versions (e.g., 3.7, 3.6, 3.5) and earlier versions (2.5, 2.0, 1.5),
    merging with known fallback models and sorting in descending order of version/capability."""
    discovered = []
    try:
        models_page = client.models.list()
        for m in models_page:
            name = m.name or ""
            short_name = name.split('/')[-1]
            if "gemini" in short_name.lower() and "flash" in short_name.lower():
                if m.supported_actions and "generateContent" not in m.supported_actions:
                    continue
                # Exclude non-text, specialized, or non-generative tasks
                exclude_keywords = [
                    'tuning', 'thinking', 'vision', 'image', 'tts',
                    'omni', 'customtools', 'embed', 'realtime', 'robotics'
                ]
                if not any(x in short_name.lower() for x in exclude_keywords):
                    if short_name not in discovered:
                        discovered.append(short_name)
    except Exception as e:
        logger.warning(f"Could not dynamically list models: {e}")

    # Combine discovered with known flash models, preserving uniqueness
    combined_pool = list(dict.fromkeys(discovered + KNOWN_FLASH_MODELS))
    # Sort descending so newest versions (3.7, 3.6, 3.5, 2.5, 2.0, 1.5) are prioritized
    ordered = sorted(combined_pool, key=parse_gemini_model_sort_key, reverse=True)
    return ordered


@app.get("/api/models")
def list_available_models(api_key: str = ""):
    """Fetches list of available Gemini models using the user's API key, prioritizing Flash models (newest first)."""
    default_models = [
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-flash',
        'gemini-2.5-pro'
    ]
    key_to_use = (api_key or os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key_to_use or key_to_use.lower() == "mock":
        return {"models": default_models}
    try:
        client = genai.Client(api_key=key_to_use)
        models_page = client.models.list()
        
        flash_models = []
        pro_models = []
        other_models = []
        
        for m in models_page:
            name = m.name or ""
            if "gemini" in name.lower():
                if m.supported_actions and "generateContent" not in m.supported_actions:
                    continue
                
                short_name = name.split('/')[-1]
                exclude_keywords = [
                    'tuning', 'thinking', 'vision', 'image', 'tts',
                    'omni', 'customtools', 'embed', 'realtime', 'robotics'
                ]
                if any(x in short_name.lower() for x in exclude_keywords):
                    continue
                
                if "flash" in short_name.lower():
                    if short_name not in flash_models:
                        flash_models.append(short_name)
                elif "pro" in short_name.lower():
                    if short_name not in pro_models:
                        pro_models.append(short_name)
                elif any(x in short_name.lower() for x in ['lite', 'exp']):
                    if short_name not in other_models:
                        other_models.append(short_name)
        
        # Sort flash models by version descending (e.g. 3.7, 3.6, 3.5, 2.5, 2.0, 1.5)
        ordered_flash = sorted(
            list(dict.fromkeys(flash_models + KNOWN_FLASH_MODELS)),
            key=parse_gemini_model_sort_key,
            reverse=True
        )
        ordered_pro = sorted(pro_models, key=parse_gemini_model_sort_key, reverse=True)
        ordered_other = sorted(other_models, key=parse_gemini_model_sort_key, reverse=True)
        
        final_list = ordered_flash + ordered_pro + ordered_other
        if not final_list:
            final_list = default_models
            
        return {"models": final_list}
    except Exception as e:
        logger.error(f"Error listing models: {e}")
        return {"models": default_models}

@app.post("/api/analyze")
async def analyze_video(request: AnalyzeRequest):
    """Stream real-time progress via Server-Sent Events, then deliver the final result."""

    async def stream():
        gemini_key = (request.api_key or os.environ.get("GEMINI_API_KEY") or '').strip()
        is_mock = gemini_key.lower() == "mock"

        if not gemini_key:
            yield _sse({"error": "Gemini API Key is required. Enter it in the web interface.", "status": 400})
            return

        # ── Step 1: Extract video ID & metadata ─────────────────────────────
        video_id = extract_video_id(request.url)
        if not video_id:
            if not is_mock:
                yield _sse({"error": "Invalid YouTube URL. Please check the link and try again.", "status": 400})
                return
            video_id = "dQw4w9WgXcQ"

        canonical_url = f"https://www.youtube.com/watch?v={video_id}"

        yield _sse({
            "step": 1,
            "step_progress": 30,
            "overall_progress": 8,
            "stage": "Connecting to YouTube",
            "detail": "Connecting to YouTube & fetching video metadata...",
            "message": "Connecting to YouTube — fetching video title and duration..."
        })

        channel = ""
        try:
            metadata = await asyncio.to_thread(fetch_video_metadata, canonical_url, request.proxy)
            title    = metadata["title"]
            channel  = metadata.get("channel", "")
            duration = metadata["duration"]
            heatmap  = metadata.get("heatmap") or []
            is_live  = metadata.get("is_live", False)
            live_status = metadata.get("live_status", "not_live")
            yield _sse({
                "step": 1,
                "step_progress": 100,
                "overall_progress": 25,
                "stage": "Video Verified",
                "detail": f"Loaded metadata for \"{title[:45]}\" ({int(duration)}s)",
                "message": f"Connected — \"{title[:45]}\" ({int(duration)}s)"
            })
        except Exception as e:
            if is_mock:
                title = "Mock YouTube Video"
                channel = "Cheat Clip Pro"
                duration = 212.0
                heatmap = []
                is_live = False
                live_status = "not_live"
                yield _sse({
                    "step": 1,
                    "step_progress": 100,
                    "overall_progress": 25,
                    "stage": "Video Verified",
                    "detail": "Loaded mock video metadata (212s)",
                    "message": "Mock video metadata loaded"
                })
            else:
                msg = e.detail if isinstance(e, HTTPException) else str(e)
                yield _sse({"error": f"Failed to fetch video details: {msg}", "status": 500})
                return

        logger.info(f"Metadata fetched: title='{title}', duration={duration}s, heatmap_pts={len(heatmap)}")

        # ── Step 2: Heatmap ──────────────────────────────────────────────────
        yield _sse({
            "step": 2,
            "step_progress": 40,
            "overall_progress": 35,
            "stage": "Scraping Retention",
            "detail": "Extracting viewer replay telemetry and retention curve...",
            "message": "Scraping player viewer retention curve..."
        })
        if heatmap:
            yield _sse({
                "step": 2,
                "step_progress": 100,
                "overall_progress": 50,
                "stage": "Retention Decoded",
                "detail": f"Viewer retention heatmap loaded — {len(heatmap)} audience interest data points parsed.",
                "message": f"Viewer retention heatmap loaded — {len(heatmap)} data points scraped."
            })
        else:
            yield _sse({
                "step": 2,
                "step_progress": 100,
                "overall_progress": 50,
                "stage": "Dialogue Fallback",
                "detail": "No heatmap curve available — relying on full transcript dialogue analysis.",
                "message": "No heatmap available for this video — will rely on transcript content analysis."
            })

        # ── Step 3: Transcript ───────────────────────────────────────────────
        if request.subtitles:
            yield _sse({
                "step": 3,
                "step_progress": 30,
                "overall_progress": 55,
                "stage": "Parsing Subtitles",
                "detail": "Parsing custom SRT/TXT subtitle timestamps...",
                "message": "Parsing manual subtitles..."
            })
            try:
                transcript_lines = parse_manual_subtitles(request.subtitles, duration)
                if not transcript_lines:
                    raise Exception("Custom subtitles parsed into empty array.")
                yield _sse({
                    "step": 3,
                    "step_progress": 100,
                    "overall_progress": 70,
                    "stage": "Subtitles Ready",
                    "detail": f"Custom subtitles parsed — {len(transcript_lines)} timestamped lines loaded.",
                    "message": f"Custom subtitles parsed — {len(transcript_lines)} lines loaded successfully."
                })
            except Exception as e:
                yield _sse({"error": f"Failed to parse manual subtitles: {str(e)}", "status": 400})
                return
        else:
            loop = asyncio.get_running_loop()
            progress_queue = asyncio.Queue()

            def progress_callback(stage: str, detail: str, step_pct: int = 30):
                loop.call_soon_threadsafe(progress_queue.put_nowait, {
                    "step": 3,
                    "step_progress": step_pct,
                    "overall_progress": min(68, 50 + int(step_pct * 0.2)),
                    "stage": stage,
                    "detail": detail,
                    "message": detail
                })

            # Initial stage event
            yield _sse({
                "step": 3,
                "step_progress": 25,
                "overall_progress": 55,
                "stage": "Fetching Subtitles",
                "detail": "Initializing multi-tier subtitle extraction pipeline...",
                "message": "Initializing multi-tier subtitle extraction pipeline..."
            })

            try:
                task = asyncio.create_task(
                    asyncio.to_thread(fetch_transcript, video_id, request.proxy, progress_callback)
                )

                while not task.done():
                    try:
                        evt = await asyncio.wait_for(progress_queue.get(), timeout=0.2)
                        yield _sse(evt)
                    except asyncio.TimeoutError:
                        pass

                while not progress_queue.empty():
                    yield _sse(progress_queue.get_nowait())

                transcript_lines = await task
                yield _sse({
                    "step": 3,
                    "step_progress": 100,
                    "overall_progress": 70,
                    "stage": "Subtitles Ready",
                    "detail": f"Subtitles loaded — {len(transcript_lines)} dialogue sentences with timestamps ready.",
                    "message": f"Subtitles loaded — {len(transcript_lines)} lines parsed successfully."
                })
            except Exception as e:
                if is_mock:
                    transcript_lines = [
                        {"text": "Hello and welcome to this video.",            "start":  0.0, "duration": 3.0},
                        {"text": "Today we are looking at how this app works.",  "start":  3.0, "duration": 4.0},
                        {"text": "It finds viral hotspots and highlights them.",  "start":  7.0, "duration": 4.0},
                        {"text": "Most people think it's magic.",               "start": 11.0, "duration": 3.0},
                        {"text": "But it uses YouTube player heatmaps.",         "start": 14.0, "duration": 4.0},
                        {"text": "And processes them with Gemini AI models.",    "start": 18.0, "duration": 4.0},
                        {"text": "This is changing how editors crop videos.",    "start": 22.0, "duration": 5.0},
                        {"text": "If you want to grow on TikTok, try it.",      "start": 27.0, "duration": 5.0},
                        {"text": "We will explore the code next.",               "start": 32.0, "duration": 3.0},
                    ]
                    yield _sse({
                        "step": 3,
                        "step_progress": 100,
                        "overall_progress": 70,
                        "stage": "Subtitles Ready",
                        "detail": "Mock mode — 9 sample dialogue lines loaded.",
                        "message": "Mock mode — using sample transcript."
                    })
                else:
                    # Provide a helpful error message if the video is live or recently completed
                    if is_live or live_status in ('is_live', 'is_upcoming', 'post_live'):
                        yield _sse({
                            "error": (
                                "No subtitles could be retrieved because this video is currently live, "
                                "upcoming, or recently completed (post-live processing). Subtitles are only "
                                "available once the live stream ends and YouTube finishes processing the video. "
                                "You can upload custom subtitles manually to analyze this video."
                            ),
                            "status": 400
                        })
                    else:
                        msg = e.detail if isinstance(e, HTTPException) else str(e)
                        yield _sse({"error": msg, "status": 400})
                    return

        # Estimate duration from transcript if missing
        if duration == 0.0 and transcript_lines:
            last = transcript_lines[-1]
            duration = last.get("start", 0.0) + last.get("duration", 0.0)


        # Slice transcript based on custom search range if provided
        start_bound = 0.0
        end_bound = duration
        if request.range_start is not None or request.range_end is not None:
            start_bound = request.range_start if request.range_start is not None else 0.0
            end_bound = request.range_end if request.range_end is not None else duration

            if start_bound < 0.0:
                start_bound = 0.0
            if end_bound > duration:
                end_bound = duration

            if start_bound >= end_bound:
                yield _sse({"error": "Invalid search range: start time must be less than end time.", "status": 400})
                return

            filtered_lines = []
            for line in transcript_lines:
                ls = line.get("start", 0.0)
                le = ls + line.get("duration", 0.0)
                if max(ls, start_bound) < min(le, end_bound):
                    filtered_lines.append(line)
            
            transcript_lines = filtered_lines
            if not transcript_lines:
                yield _sse({"error": f"No subtitles found in the specified range {start_bound}s to {end_bound}s.", "status": 400})
                return
            
            duration = end_bound - start_bound
            logger.info(f"Filtered transcript to custom range: {start_bound}s to {end_bound}s (duration: {duration}s)")

        # Enrich transcript with heatmap engagement scores
        enriched_transcript = []
        for line in transcript_lines:
            ls   = line.get("start", 0.0)
            ld   = line.get("duration", 0.0)
            le   = ls + ld
            score = get_average_heatmap_value(ls, le, heatmap)
            enriched_transcript.append({
                "start":      round(ls, 2),
                "end":        round(le, 2),
                "text":       line.get("text", ""),
                "engagement": round(score, 3)
            })

        # ── Mock short-circuit ───────────────────────────────────────────────
        if is_mock:
            mock_stages = [
                ("Context Assembly", "Aligning 9 transcript dialogue lines with retention telemetry...", 30, 78),
                ("Viral Hook & Curiosity Detection", "Scanning transcript dialogue for viral hooks & curiosity gaps...", 65, 88),
                ("Virality Scoring & Selection", "Calculating virality coefficients and formatting clip candidates...", 92, 95),
            ]
            for s_name, s_detail, s_prog, o_prog in mock_stages:
                yield _sse({
                    "step": 4,
                    "step_progress": s_prog,
                    "overall_progress": o_prog,
                    "stage": s_name,
                    "detail": s_detail,
                    "model": "gemini-2.5-flash (Mock)",
                    "message": f"Mock AI ({s_name}): {s_detail}"
                })
                await asyncio.sleep(0.7)

            mock_clips = [
                ViralClip(title="Finding hotspots using heatmaps",  start_time=11.0, end_time=22.0, hook_time=14.0, virality_score=95,
                          key_quotes=["Uses YouTube player heatmaps.", "Processes using Gemini AI."],
                          transcript="Most people think it's magic. But it uses YouTube player heatmaps.",
                          title_suggestion="Unlock Video Virality Secrets",
                          caption_suggestion="Stop guessing what works! Here's how to use heatmaps to find viral hotspots in seconds. 🔥",
                          hashtag_suggestion="#viralclips #videoediting #heatmaps #aitools"),
                ViralClip(title="Grow on TikTok or Reels",          start_time=22.0, end_time=32.0, hook_time=27.0, virality_score=88,
                          key_quotes=["Changing how editors crop videos.", "If you want to grow on TikTok, try it."],
                          transcript="This is changing how editors crop videos. If you want to grow on TikTok, try it.",
                          title_suggestion="The Ultimate TikTok Growth Hack",
                          caption_suggestion="Want to scale your TikTok views? This tool will revolutionize your workflow. 🚀",
                          hashtag_suggestion="#tiktokgrowth #reels #shorts #editingtips"),
                ViralClip(title="Introductory overview of the tool", start_time=0.0,  end_time=11.0, hook_time=3.0, virality_score=72,
                          key_quotes=["Hello and welcome.", "Finds viral hotspots."],
                          transcript="Hello and welcome. It finds viral hotspots and highlights them.",
                          title_suggestion="Meet Cheat Clip Pro AI",
                          caption_suggestion="Say hello to your new AI co-editor. Find the absolute best parts of any video instantly.",
                          hashtag_suggestion="#cheatclippro #aiediting #growthmindset"),
            ]
            mock_heatmap = [
                HeatmapPoint(start_time=i*10.0, end_time=(i+1)*10.0,
                             value=0.2 + (0.6 if i in [2,5,8,12,16] else 0.1))
                for i in range(20)
            ] if not heatmap else [
                HeatmapPoint(start_time=float(pt.get('start_time',0.0)),
                             end_time=float(pt.get('end_time',0.0)),
                             value=float(pt.get('value',0.0)))
                for pt in heatmap
            ]
            result = AnalyzeResponse(
                video_id=video_id, title=title, channel=channel, duration=duration or 200.0,
                heatmap=mock_heatmap,
                summary="Mock analysis: this video explains how CHEAT CLIP PRO works. #aitools #videoediting #productivity",
                clips=mock_clips,
                model="Mock Gemini"
            )
            yield _sse({
                "step": 4,
                "step_progress": 100,
                "overall_progress": 100,
                "stage": "Analysis Complete",
                "detail": "Generated 3 viral clip candidates successfully.",
                "done": True,
                "result": result.model_dump()
            })
            return

        is_long_video = duration > 3600
        if request.target_clip_count:
            N = request.target_clip_count
            if N <= 5:
                min_clips = max(1, N - 1)
                max_clips = N + 2
            elif N <= 10:
                min_clips = max(1, N - 2)
                max_clips = N + 3
            else:
                min_clips = N - 5
                max_clips = N + 5
            clip_range = f"{min_clips}-{max_clips}"
        else:
            clip_range = "15-60" if is_long_video else "10-30"

        # ── Step 4: Build prompt & Detect Language ─────────────────────────────
        detected_lang = detect_transcript_language(enriched_transcript, title)
        lang_code = detected_lang.get('code', 'en')
        lang_name = detected_lang.get('name', 'English')
        logger.info(f"Detected video language: {lang_name} ({lang_code}) - confidence {detected_lang.get('confidence', 0.0)}")

        transcript_dump = []
        for line in enriched_transcript:
            eng = f"|{line['engagement']:.2f}" if heatmap and line['engagement'] > 0 else ""
            transcript_dump.append(f"{line['start']:.1f}|{line['end']:.1f}{eng} {line['text']}")

        MAX_LINES = 2500 if is_long_video else 800
        if len(transcript_dump) > MAX_LINES:
            logger.warning(f"Transcript {len(transcript_dump)} lines — truncating to {MAX_LINES}.")
            transcript_dump = transcript_dump[:MAX_LINES]

        transcript_text = "\n".join(transcript_dump)
        dur_range   = {"15s": "10-20s", "30s": "20-40s", "60s": "45-75s"}.get(request.duration, "20-40s")
        heatmap_note = (
            "Columns: start|end|audience_interest(0-1). Prioritise high-interest peaks."
            if heatmap else
            "No audience interest data. Use content hooks, energy, and story arcs."
        )
        focus_instruction = ""
        if request.custom_prompt and request.custom_prompt.strip():
            focus_instruction = (
                f"CRITICAL USER SEARCH FOCUS:\n"
                f"The user specifically wants you to find clips matching the following query/theme: \"{request.custom_prompt.strip()}\".\n"
                f"Prioritize and tailor your selection of viral clips to fit this request, while still ensuring they make good standalone clips.\n"
                f"IMPORTANT: Regardless of the language this query was typed in, your generated titles, summaries, quotes, and captions MUST REMAIN IN THE VIDEO'S SPOKEN LANGUAGE ({lang_name}). DO NOT translate the video's content to match the language of the search query.\n\n"
            )

        channel_context = f"- Channel / Host / Creator: {channel}\n" if channel else ""

        prompt = (
            f"You are an expert viral video clip editor finding top clip candidates for TikTok, Instagram Reels, and YouTube Shorts.\n"
            f"Analyze this YouTube video transcript and find {clip_range} high-performing, standalone clip candidates.\n\n"
            f"VIDEO CONTEXT:\n"
            f"- Video Title: {title}\n"
            f"{channel_context}"
            f"- Video Duration: {int(start_bound)}s to {int(end_bound)}s (Total: {int(duration)}s) | Target clip length: {dur_range}\n"
            f"- Heatmap: {heatmap_note}\n"
            f"- DETECTED VIDEO SPOKEN LANGUAGE: {lang_name} (Code: '{lang_code}')\n\n"
            f"================================================================================\n"
            f"CRITICAL ZERO-TRANSLATION & LANGUAGE FIDELITY RULE (MANDATORY):\n"
            f"================================================================================\n"
            f"1. NEVER TRANSLATE THE CONTENT INTO ANOTHER LANGUAGE!\n"
            f"   - If the input video is in English -> ALL generated recommendations, titles, title suggestions, summaries, captions, hashtags, and quotes MUST BE 100% IN ENGLISH. Do NOT translate to Indonesian, Spanish, or any other language!\n"
            f"   - If the input video is in Indonesian (Bahasa Indonesia) -> ALL generated recommendations, titles, title suggestions, summaries, captions, hashtags, and quotes MUST BE 100% IN INDONESIAN. Do NOT translate to English, Spanish, or any other language!\n"
            f"   - If the input video is in Spanish (Español) -> ALL generated output MUST BE 100% IN SPANISH. Do NOT translate to English or any other language!\n"
            f"   - General Rule: English is English, Indonesia is Indonesia, Spain is Spain. Every clip recommendation must strictly stay in the exact language used in that video.\n"
            f"2. DO NOT translate because there is NO NEED to translate. The clips and social metadata must naturally match the speaker's spoken words so viewers hear and read the exact same language.\n"
            f"3. Strict field requirements in the video's original language ({lang_name}):\n"
            f"   - `summary`: In the original video language ({lang_name}).\n"
            f"   - `title`: Catchy title in the original video language ({lang_name}), max 8 words.\n"
            f"   - `title_suggestion`: Alternative title in the original video language ({lang_name}).\n"
            f"   - `caption_suggestion`: Engaging social caption in the original video language ({lang_name}).\n"
            f"   - `hashtag_suggestion`: Relevant hashtags in the original video language ({lang_name}).\n"
            f"   - `key_quotes`: MUST be verbatim spoken quotes directly from the transcript in the original language.\n"
            f"================================================================================\n\n"
            f"{focus_instruction}"
            f"CRITICAL TITLE & ATTRIBUTION RULES (NO FIRST-PERSON 'I' OR 'ME'):\n"
            f"1. NEVER write clip titles or title suggestions using first-person pronouns ('I', 'me', 'my', 'mine', 'myself', or equivalents in other languages such as 'saya', 'aku', 'gue')!\n"
            f"2. The user posting or curating these clips is a third-party editor, NOT the person speaking in the video. Titles must NEVER make it look like the clip is expressing the user's personal opinion, story, or reaction (e.g. NEVER write 'Why I think this is bad', 'How I made $100K', 'My biggest mistake', or 'I was shocked' / in Indonesian: NEVER 'Kenapa saya...', 'Cara aku...', 'Opini gue...').\n"
            f"3. ALWAYS attribute statements to the context of the video and the actual person speaking:\n"
            f"   - Use the actual name of the speaker, host, or guest from the video title, channel name ({channel or 'Host'}), or transcript dialogue (e.g. '{channel or 'Speaker'} Explains...', 'Why {channel or 'Host'} Shocked Fans', '[Name] Reveals The Truth' / in Indonesian: '{channel or 'Host'} Menjelaskan...', 'Alasan {channel or 'Host'} Mengungkapkan...').\n"
            f"   - If the speaker's name is not explicitly stated, use their role or descriptive title (e.g. 'Host Reacts...', 'CEO Reveals...', 'Expert Explains...', 'Guest Breaks Down...' / in Indonesian: 'Host Menjelaskan...', 'Pakar Membongkar...').\n"
            f"   - Or use objective, curiosity-driven framing (e.g. 'The Real Truth About...', 'How To Master...', 'Why Most People Fail At...', 'The Harsh Reality of...' / in Indonesian: 'Fakta Sebenarnya Tentang...', 'Cara Menguasai...').\n"
            f"4. Keep titles snappy, viral, engaging, and under 8 words.\n\n"
            f"Transcript (start|end[|interest] text):\n---\n{transcript_text}\n---\n\n"
            f"Rules: use exact seconds from transcript; clips must start/end at sentence boundaries; do not overlap.\n"
            f"Return {clip_range} clips sorted by virality_score desc."
        )

        requested_model = (request.model or 'gemini-2.5-flash').strip()
        if any(dep in requested_model.lower() for dep in ['gemini-1.0', 'gemini-pro-vision']):
            logger.info(f"Requested model '{requested_model}' is outdated. Upgrading to gemini-2.5-flash.")
            requested_model = 'gemini-2.5-flash'

        yield _sse({
            "step": 4,
            "step_progress": 10,
            "overall_progress": 72,
            "stage": "Language & Context Assembly",
            "detail": f"Source language: {lang_name} ({lang_code}). Aligning {len(transcript_dump)} dialogue segments for {requested_model}...",
            "model": requested_model,
            "message": f"Verified language: {lang_name}. Zero-translation rule enforced for {requested_model}."
        })

        # ── Step 4: Gemini API call with dynamic Flash fallback models and retry ───────────
        client = genai.Client(api_key=gemini_key)
        
        # Discover all available Flash models for the user's API key
        discovered_flash = await asyncio.to_thread(get_flash_models_for_key, client)
        
        # Build models_to_try:
        # 1. Start with the requested model
        # 2. Append all discovered and known flash models in version descending order (e.g. 3.7, 3.6, 3.5, 2.5, 2.0, 1.5)
        #    so all available flash models are tried before giving up
        models_to_try = [requested_model]
        for fm in discovered_flash:
            if fm not in models_to_try:
                models_to_try.append(fm)
        for km in KNOWN_FLASH_MODELS:
            if km not in models_to_try:
                models_to_try.append(km)

        logger.info(f"Flash fallback chain prepared: {models_to_try}")

        response = None
        last_error = None
        encountered_quota_error = None
        analysis_data = None
        successful_model = None

        for idx, model_name in enumerate(models_to_try):
            next_model_hint = models_to_try[idx + 1] if idx + 1 < len(models_to_try) else None

            MAX_RETRIES = 2
            
            for attempt in range(MAX_RETRIES):
                if attempt > 0:
                    wait = 2
                    yield _sse({
                        "step": 4,
                        "step_progress": 25,
                        "overall_progress": 75,
                        "stage": "Transient Retry",
                        "detail": f"{model_name} busy — waiting {wait}s before retry ({attempt + 1}/{MAX_RETRIES})...",
                        "model": model_name,
                        "message": f"{model_name} is busy — waiting {wait}s before retry {attempt + 1}/{MAX_RETRIES}..."
                    })
                    await asyncio.sleep(wait)
                
                yield _sse({
                    "step": 4,
                    "step_progress": 18,
                    "overall_progress": 74,
                    "stage": "Neural Model Dispatch",
                    "detail": f"Dispatched {len(transcript_dump)} lines to {model_name} (attempt {attempt + 1})...",
                    "model": model_name,
                    "message": f"Calling {model_name} (attempt {attempt + 1}/{MAX_RETRIES})..."
                })
                
                # Execute Gemini call with heartbeat to keep mobile connection alive and show live stages
                task = asyncio.create_task(asyncio.to_thread(
                    client.models.generate_content,
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=VideoAnalysis,
                        temperature=0.2,
                    )
                ))
                
                call_start = asyncio.get_event_loop().time()
                while not task.done():
                    done, _ = await asyncio.wait([task], timeout=2.0)
                    if not done:
                        elapsed = int(asyncio.get_event_loop().time() - call_start)
                        
                        if elapsed < 5:
                            stage = "Neural Context Loading"
                            detail = f"Transmitting {len(transcript_dump)} timestamped dialogue segments to {model_name}..."
                            step_prog = min(35, 12 + elapsed * 4)
                        elif elapsed < 12:
                            stage = "Retention Spike Cross-Analysis"
                            detail = f"Correlating viewer retention peaks against speaker dialogue to isolate viral moments..."
                            step_prog = min(55, 35 + int((elapsed - 5) * 3))
                        elif elapsed < 20:
                            stage = "Viral Hook & Curiosity Detection"
                            detail = f"Scanning transcript dialogue for opening hooks, punchlines, controversial takes & emotional peaks..."
                            step_prog = min(72, 55 + int((elapsed - 12) * 2.2))
                        elif elapsed < 30:
                            stage = "Coherence & Sentence Boundary Snapping"
                            detail = f"Ensuring clip candidates start and end naturally on sentence boundaries without mid-word cuts..."
                            step_prog = min(85, 72 + int((elapsed - 20) * 1.3))
                        elif elapsed < 42:
                            stage = "Virality Scoring & Selection"
                            detail = f"Calculating virality coefficients (1-100) and selecting the top {clip_range} highest potential clips..."
                            step_prog = min(92, 85 + int((elapsed - 30) * 0.7))
                        else:
                            stage = "Social Media Metadata Synthesis"
                            detail = f"Drafting attention-grabbing titles, social captions, and targeted hashtags ({elapsed}s)..."
                            step_prog = min(95, 92 + min(3, int((elapsed - 42) * 0.3)))

                        overall_prog = 70 + int(step_prog * 0.28)
                        yield _sse({
                            "step": 4,
                            "keepalive": True,
                            "step_progress": step_prog,
                            "overall_progress": overall_prog,
                            "stage": stage,
                            "detail": detail,
                            "model": model_name,
                            "elapsed": elapsed,
                            "message": f"[{model_name} | {elapsed}s] {stage}: {detail}"
                        })
                
                try:
                    resp_candidate = await task
                    last_error = None
                    
                    # Parse structured response
                    parsed_data = None
                    if hasattr(resp_candidate, 'parsed') and resp_candidate.parsed is not None:
                        parsed = resp_candidate.parsed
                        parsed_data = {
                            "summary": getattr(parsed, 'summary', ''),
                            "clips": [
                                {
                                    "title": sanitize_first_person_title(getattr(c, 'title', ''), channel, lang=lang_code),
                                    "start_time": getattr(c, 'start_time', 0.0),
                                    "end_time": getattr(c, 'end_time', 0.0),
                                    "hook_time": getattr(c, 'hook_time', None),
                                    "virality_score": getattr(c, 'virality_score', 0),
                                    "key_quotes": getattr(c, 'key_quotes', []),
                                    "title_suggestion": sanitize_first_person_title(getattr(c, 'title_suggestion', ''), channel, lang=lang_code),
                                    "caption_suggestion": getattr(c, 'caption_suggestion', ''),
                                    "hashtag_suggestion": getattr(c, 'hashtag_suggestion', ''),
                                }
                                for c in (getattr(parsed, 'clips', []) or [])
                            ]
                        }
                    elif resp_candidate.text:
                        raw_text = resp_candidate.text.strip()
                        if raw_text.startswith("```"):
                            raw_text = re.sub(r"^```[a-zA-Z]*\n?", "", raw_text)
                            raw_text = re.sub(r"\n?```$", "", raw_text)
                        try:
                            parsed_data = json.loads(raw_text)
                        except Exception as json_err:
                            logger.warning(f"JSON parsing error from {model_name}: {json_err}")
                            parsed_data = None

                    if parsed_data is not None:
                        clips_found = len(parsed_data.get('clips', []))
                        if clips_found == 0 and next_model_hint is not None:
                            logger.warning(f"{model_name} returned 0 clips. Will try next flash model {next_model_hint}...")
                            yield _sse({
                                "step": 4,
                                "step_progress": 40,
                                "overall_progress": 78,
                                "stage": "Flash Model Fallback",
                                "detail": f"{model_name} returned 0 clips — switching to {next_model_hint} for deeper extraction...",
                                "model": next_model_hint,
                                "message": f"{model_name} returned 0 clips — switching to {next_model_hint}..."
                            })
                            last_error = Exception(f"{model_name} returned 0 clips")
                            break
                        
                        response = resp_candidate
                        analysis_data = parsed_data
                        successful_model = model_name
                        break
                    else:
                        last_error = Exception(f"{model_name} returned empty or unparseable response")
                        break
                        
                except Exception as e:
                    last_error = e
                    err_str = str(e).lower()
                    logger.warning(f"Error from {model_name} (attempt {attempt + 1}): {e}")
                    
                    if any(x in err_str for x in ('429', 'quota', 'resource exhausted', 'rate limit')):
                        encountered_quota_error = e
                        break

                    if any(x in err_str for x in ('404', 'not found', 'not supported')):
                        break
                    
                    is_server_busy = any(x in err_str for x in ('503', 'unavailable', 'overloaded', '500', 'internal'))
                    if not is_server_busy:
                        break
            
            if analysis_data is not None and response is not None:
                break
                
            if next_model_hint is not None:
                err_summary = "quota reached" if any(x in str(last_error).lower() for x in ('429', 'quota', 'rate limit')) else \
                              "not available or deprecated" if "404" in str(last_error) else \
                              "temporarily busy"
                yield _sse({
                    "step": 4,
                    "step_progress": 35,
                    "overall_progress": 76,
                    "stage": "Flash Fallback",
                    "detail": f"{model_name} {err_summary} — switching to fallback {next_model_hint}...",
                    "model": next_model_hint,
                    "message": f"{model_name} {err_summary} — switching to flash fallback model {next_model_hint}..."
                })

        if analysis_data is None:
            # If any model in the fallback chain suffered quota exhaustion, prioritize showing the quota explanation
            error_to_report = encountered_quota_error or last_error
            if error_to_report is not None:
                err_str = str(error_to_report).lower()
                if any(x in err_str for x in ('429', 'quota', 'resource exhausted', 'rate limit')):
                    yield _sse({
                        "error": "Quota limit reached across all available Gemini Flash models for this API key. Free keys have a request limit per minute. Please change your API key, generate a fresh free key at aistudio.google.com, or wait 30–60 seconds before trying again.",
                        "status": 429
                    })
                elif any(x in err_str for x in ('503', 'unavailable', 'overloaded')):
                    yield _sse({
                        "error": "Google Gemini servers are currently experiencing high demand across all Flash models. Please change to a different Gemini API key or wait a few moments and try again.",
                        "status": 503
                    })
                elif any(x in err_str for x in ('401', '403', 'api_key', 'invalid', 'permission')):
                    yield _sse({
                        "error": "Invalid or restricted Gemini API key. Please change your API key or generate a new free key at aistudio.google.com.",
                        "status": 401
                    })
                elif any(x in err_str for x in ('404', 'not found', 'not supported')):
                    models_preview = ', '.join(models_to_try[:3])
                    yield _sse({
                        "error": f"All tested Gemini Flash models ({models_preview}...) were unavailable or not supported for this API key. Please change your Gemini API key or generate a new one at aistudio.google.com.",
                        "status": 404
                    })
                else:
                    logger.error(f"Gemini error after all fallback models: {error_to_report}")
                    yield _sse({
                        "error": f"AI analysis failed across all available Flash models ({str(error_to_report)}). Please change your Gemini API key or try again in a few moments.",
                        "status": 500
                    })
            else:
                yield _sse({
                    "error": "No response received after trying all available Gemini Flash models. Please change your Gemini API key or try again in a few moments.",
                    "status": 500
                })
            return

        # Fallback clip synthesis if 0 clips were returned after all models
        if len(analysis_data.get('clips', [])) == 0 and enriched_transcript:
            logger.info("Generating fallback clips from heatmap and transcript segments...")
            sorted_lines = sorted(enriched_transcript, key=lambda l: l.get('engagement', 0.0), reverse=True)
            candidate_starts = []
            for l in sorted_lines:
                s = l['start']
                if not any(abs(s - existing) < 25.0 for existing in candidate_starts):
                    candidate_starts.append(s)
                if len(candidate_starts) >= 5:
                    break
            
            fallback_clips_list = []
            for i, st in enumerate(candidate_starts):
                target_len = 30.0 if request.duration == "30s" else 15.0 if request.duration == "15s" else 60.0
                et = min(duration, st + target_len)
                seg_lines = [l['text'] for l in enriched_transcript if max(l['start'], st) < min(l['end'], et)]
                seg_text = " ".join(seg_lines).strip()
                preview = seg_text[:60] + "..." if len(seg_text) > 60 else seg_text or f"Viral Highlight #{i+1}"
                if lang_code == 'id':
                    fallback_clips_list.append({
                        "title": f"Momen Menarik #{i+1}",
                        "start_time": st,
                        "end_time": et,
                        "hook_time": st,
                        "virality_score": max(70, int(95 - i * 5)),
                        "key_quotes": [seg_text[:80]] if seg_text else [],
                        "title_suggestion": f"Cuplikan Pilihan #{i+1}",
                        "caption_suggestion": f"Momen terbaik dari video: {preview} #viral #trending",
                        "hashtag_suggestion": "#viral #shorts #trending"
                    })
                elif lang_code == 'es':
                    fallback_clips_list.append({
                        "title": f"Momento Destacado #{i+1}",
                        "start_time": st,
                        "end_time": et,
                        "hook_time": st,
                        "virality_score": max(70, int(95 - i * 5)),
                        "key_quotes": [seg_text[:80]] if seg_text else [],
                        "title_suggestion": f"Momento Imperdible #{i+1}",
                        "caption_suggestion": f"Momento clave del video: {preview} #viral #trending",
                        "hashtag_suggestion": "#viral #shorts #trending"
                    })
                else:
                    fallback_clips_list.append({
                        "title": f"Key Highlight #{i+1}",
                        "start_time": st,
                        "end_time": et,
                        "hook_time": st,
                        "virality_score": max(70, int(95 - i * 5)),
                        "key_quotes": [seg_text[:80]] if seg_text else [],
                        "title_suggestion": f"Must Watch Moment #{i+1}",
                        "caption_suggestion": f"Key highlight from video: {preview} #viral #trending",
                        "hashtag_suggestion": "#viral #shorts #trending"
                    })
            analysis_data['clips'] = fallback_clips_list
            if not analysis_data.get('summary'):
                if lang_code == 'id':
                    analysis_data['summary'] = f"Analisis video \"{title}\" menemukan {len(fallback_clips_list)} segmen cuplikan pilihan. #viral #highlights"
                elif lang_code == 'es':
                    analysis_data['summary'] = f"Análisis de \"{title}\" identificando {len(fallback_clips_list)} segmentos clave. #viral #highlights"
                else:
                    analysis_data['summary'] = f"Analysis of \"{title}\" identifying {len(fallback_clips_list)} key segments. #viral #highlights"

        clip_count = len(analysis_data.get('clips', []))
        yield _sse({
            "step": 4,
            "step_progress": 98,
            "overall_progress": 98,
            "stage": "Clip Verification & Alignment",
            "detail": f"Verified {clip_count} clip segments with precise video timestamps and key quotes in {lang_name}.",
            "model": successful_model or requested_model,
            "message": f"Found {clip_count} viral clip candidates ({lang_name}) with {successful_model or requested_model} — reconstructing transcripts..."
        })
        logger.info(f"Gemini analysis complete with {successful_model or requested_model}. Found {clip_count} clips in {lang_name}.")

        # Reconstruct clip transcripts from enriched_transcript
        final_clips = []
        for raw_clip in analysis_data.get('clips', []):
            start = raw_clip.get('start_time', 0.0)
            end   = raw_clip.get('end_time', 0.0)
            hook  = raw_clip.get('hook_time')
            if hook is None or not (start <= hook <= end):
                hook = start
            
            clip_lines = [
                line.get("text", "")
                for line in enriched_transcript
                if max(line.get("start", 0.0), start) < min(line.get("end", 0.0), end)
            ]
            
            # Ensure hashtags are always lowercase
            caption_sug = lowercase_hashtags_in_string(raw_clip.get('caption_suggestion', ''))
            hashtag_sug = lowercase_hashtags_in_string(raw_clip.get('hashtag_suggestion', ''))
            
            final_clips.append(ViralClip(
                title=sanitize_first_person_title(raw_clip.get('title', ''), channel, lang=lang_code),
                start_time=start,
                end_time=end,
                hook_time=hook,
                virality_score=raw_clip.get('virality_score', 0),
                key_quotes=raw_clip.get('key_quotes') or [],
                transcript=" ".join(clip_lines),
                title_suggestion=sanitize_first_person_title(raw_clip.get('title_suggestion', ''), channel, lang=lang_code),
                caption_suggestion=caption_sug,
                hashtag_suggestion=hashtag_sug
            ))

        response_heatmap = [
            HeatmapPoint(
                start_time=float(pt.get('start_time', 0.0)),
                end_time=float(pt.get('end_time', 0.0)),
                value=float(pt.get('value', 0.0))
            )
            for pt in (heatmap or [])
        ]

        response_transcript = [
            TranscriptLine(
                start=float(line["start"]),
                end=float(line["end"]),
                text=line["text"],
                engagement=line.get("engagement")
            )
            for line in enriched_transcript
        ]

        # Ensure hashtags are lowercase in the overall summary
        clean_summary = lowercase_hashtags_in_string(analysis_data.get("summary", ""))

        final_result = AnalyzeResponse(
            video_id=video_id,
            title=title,
            channel=channel,
            duration=duration,
            heatmap=response_heatmap,
            summary=clean_summary,
            clips=final_clips,
            transcript=response_transcript,
            model=successful_model or requested_model
        )

        yield _sse({"done": True, "result": final_result.model_dump()})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection":    "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ----------------------------------------------------------------
# Batch Auto-Clipper & Video Studio Endpoints
# ----------------------------------------------------------------

class RenderSettingsModel(BaseModel):
    aspect_ratio: str = "9:16"
    background_style: str = "black"
    enable_face_tracking: bool = True
    streamer_preset: str = "none"
    facecam_position: Optional[str] = "auto"
    title_text: Optional[str] = None
    title_prefix: Optional[str] = ""
    title_suffix: Optional[str] = ""
    file_name_prefix: Optional[str] = ""
    file_name_suffix: Optional[str] = ""
    title_position: str = "auto"
    title_duration: Optional[str] = "entire"
    subtitles_enabled: Optional[bool] = True
    caption_style: str = "viral_pop"
    caption_font: str = "Outfit"
    font_size: str = "medium"
    title_font_size: Optional[str] = "medium"
    text_case: str = "uppercase"
    title_y_percent: Optional[float] = None
    subtitle_y_percent: Optional[float] = None
    subtitle_position_mode: Optional[str] = "bottom"
    subtitle_center_y_percent: Optional[float] = 50.0
    # Background Music
    bgm_enabled: Optional[bool] = False
    bgm_file_path: Optional[str] = None
    bgm_volume: Optional[float] = 25.0
    bgm_start_offset: Optional[float] = 0.0
    # Hook SFX
    hook_sfx_enabled: Optional[bool] = False
    hook_sfx_file_path: Optional[str] = None
    hook_sfx_volume: Optional[float] = 100.0
    # Raw Audio / Voice Boost
    original_audio_volume: Optional[float] = 100.0
    # Watermark
    watermark_enabled: Optional[bool] = False
    watermark_type: Optional[str] = "image"
    watermark_file_path: Optional[str] = None
    watermark_text: Optional[str] = None
    watermark_size: Optional[float] = 20.0
    watermark_opacity: Optional[float] = 80.0
    watermark_x: Optional[float] = 90.0
    watermark_y: Optional[float] = 8.0
    hardware_accel: Optional[str] = "auto"


class RenderBatchRequest(BaseModel):
    video_url: str
    video_id: str
    clips: List[Dict[str, Any]]
    settings: RenderSettingsModel
    transcript: Optional[List[Dict[str, Any]]] = None


RENDER_BATCHES: Dict[str, Dict[str, Any]] = {}
BATCH_REQUESTS: Dict[str, RenderBatchRequest] = {}


class RetryBatchRequest(BaseModel):
    clip_indices: Optional[List[int]] = None


async def render_single_batch_clip(
    batch_id: str,
    idx: int,
    clip: Dict[str, Any],
    settings: RenderSettingsModel,
    target_url: str,
    transcript: Optional[List[Dict[str, Any]]] = None,
    total_clips: int = 1
):
    batch = RENDER_BATCHES.get(batch_id)
    if not batch:
        return

    clip_status = batch["clips"][idx]
    clip_status["status"] = "downloading"
    clip_status["progress_percent"] = 15
    clip_status["error_message"] = None
    clip_status["error"] = None

    raw_path = None
    ass_path = None
    title_overlay_path = None

    try:
        # 1. Download
        start_t = float(clip.get("start_time", 0.0))
        end_t = float(clip.get("end_time", start_t + 30.0))
        seg_filename = f"{batch_id}_clip_{idx}_raw.mp4"

        raw_path = await asyncio.to_thread(
            download_clip_segment,
            target_url,
            start_t,
            end_t,
            seg_filename
        )

        if not raw_path or not os.path.exists(raw_path) or not is_valid_mp4(raw_path):
            raise RuntimeError(
                "Source video segment is incomplete or corrupted ('moov atom not found'). "
                "Network lag interrupted the download. Please retry rendering this clip."
            )

        # 2. Transcribe & Generate Subtitles / Title (.ass)
        clip_status["status"] = "transcribing"
        clip_status["progress_percent"] = 40

        display_title = None
        base_title = (
            clip.get("custom_title")
            or clip.get("title_suggestion")
            or clip.get("title")
            or f"Clip {idx+1}"
        ).strip()

        if settings.title_position != "none":
            pfx = settings.title_prefix or ""
            sfx = settings.title_suffix or ""
            if pfx or sfx:
                display_title = f"{pfx}{base_title}{sfx}".strip()
            elif total_clips == 1 and settings.title_text and settings.title_text.strip() and not (clip.get("custom_title") or clip.get("title_suggestion")):
                display_title = settings.title_text.strip()
            else:
                display_title = base_title

        clip_status["title"] = display_title or base_title
        clip_status["base_title"] = base_title

        skip_ass_title = False
        duration_sec = max(1.0, end_t - start_t)

        # Check if title has emoji -> render transparent color emoji PNG overlay
        if display_title and settings.title_position != "none" and has_emoji(display_title):
            title_png_filename = f"{batch_id}_clip_{idx}_title.png"
            title_png_path = str(TEMP_DIR / title_png_filename)
            try:
                rendered_overlay = await asyncio.to_thread(
                    render_title_overlay_png,
                    title_text=display_title,
                    output_png_path=title_png_path,
                    font_name=settings.caption_font or "Montserrat",
                    target_aspect_ratio=settings.aspect_ratio or "9:16",
                    font_size_preset=settings.font_size or "medium",
                    text_case=settings.text_case or "uppercase",
                    title_position=settings.title_position or "auto",
                    title_y_percent=settings.title_y_percent,
                    title_font_size_preset=settings.title_font_size or settings.font_size or "medium",
                    streamer_preset=settings.streamer_preset or "none"
                )
                if rendered_overlay and os.path.exists(rendered_overlay):
                    title_overlay_path = rendered_overlay
                    skip_ass_title = True
                    logger.info(f"Rendered full-color emoji title overlay: {title_overlay_path}")
            except Exception as ex:
                logger.warning(f"Could not render color emoji title overlay: {ex}")
                skip_ass_title = False

        if settings.caption_style != "none" or (display_title and settings.title_position != "none" and not skip_ass_title):
            words = []
            if settings.caption_style != "none":
                words = await asyncio.to_thread(
                    transcribe_clip_words,
                    raw_path,
                    transcript,
                    start_t,
                    end_t
                )
            ass_filename = f"{batch_id}_clip_{idx}.ass"
            ass_path = str(TEMP_DIR / ass_filename)
            await asyncio.to_thread(
                generate_ass_file,
                words=words,
                style_preset=settings.caption_style,
                font_name=settings.caption_font,
                output_ass_path=ass_path,
                target_aspect_ratio=settings.aspect_ratio,
                font_size_preset=settings.font_size,
                text_case=settings.text_case,
                title_text=display_title if not skip_ass_title else None,
                title_position=settings.title_position,
                title_duration=settings.title_duration if settings.title_duration else "entire",
                duration_seconds=duration_sec,
                title_y_percent=settings.title_y_percent,
                subtitle_y_percent=settings.subtitle_y_percent,
                subtitle_position_mode=settings.subtitle_position_mode if settings.subtitle_position_mode else "bottom",
                subtitle_center_y_percent=settings.subtitle_center_y_percent if settings.subtitle_center_y_percent is not None else 50.0,
                skip_title=skip_ass_title,
                title_font_size_preset=settings.title_font_size or settings.font_size or "medium",
                streamer_preset=settings.streamer_preset or "none"
            )

        # 3. Render Final Vertical MP4
        clip_status["status"] = "rendering"
        clip_status["progress_percent"] = 70

        out_filename = f"clip_{idx+1}_{batch_id}.mp4"
        out_path = str(EXPORTS_DIR / out_filename)

        await asyncio.to_thread(
            render_clip_to_mp4,
            video_path=raw_path,
            output_mp4_path=out_path,
            aspect_ratio=settings.aspect_ratio,
            background_style=settings.background_style,
            enable_face_tracking=settings.enable_face_tracking,
            streamer_preset=settings.streamer_preset,
            facecam_position=getattr(settings, "facecam_position", "auto") or "auto",
            title_text=display_title if not skip_ass_title else None,
            title_position=settings.title_position,
            ass_subtitles_path=ass_path,
            clip_duration=duration_sec,
            title_overlay_path=title_overlay_path,
            title_duration=settings.title_duration if settings.title_duration else "entire",
            watermark_enabled=bool(settings.watermark_enabled),
            watermark_type=settings.watermark_type or "image",
            watermark_image_path=settings.watermark_file_path,
            watermark_text=settings.watermark_text,
            watermark_size=float(settings.watermark_size if settings.watermark_size is not None else 20.0),
            watermark_opacity=float((settings.watermark_opacity if settings.watermark_opacity is not None else 80.0) / 100.0),
            watermark_x_percent=float(settings.watermark_x if settings.watermark_x is not None else 90.0),
            watermark_y_percent=float(settings.watermark_y if settings.watermark_y is not None else 8.0),
            bgm_enabled=bool(settings.bgm_enabled),
            bgm_path=settings.bgm_file_path,
            bgm_volume=float((settings.bgm_volume if settings.bgm_volume is not None else 25.0) / 100.0),
            bgm_start_offset=float(settings.bgm_start_offset or 0.0),
            hook_sfx_enabled=bool(settings.hook_sfx_enabled),
            hook_sfx_path=settings.hook_sfx_file_path,
            hook_sfx_volume=float((settings.hook_sfx_volume if settings.hook_sfx_volume is not None else 100.0) / 100.0),
            original_audio_volume=float((settings.original_audio_volume if settings.original_audio_volume is not None else 100.0) / 100.0),
            hardware_accel=settings.hardware_accel or "auto",
            title_y_percent=settings.title_y_percent
        )

        if not os.path.exists(out_path) or not is_valid_mp4(out_path):
            raise RuntimeError("Rendered MP4 file is incomplete or missing. Please retry rendering.")

        clip_status["status"] = "completed"
        clip_status["progress_percent"] = 100
        clip_status["download_url"] = f"/api/download-rendered/{out_filename}"
        clip_status["output_path"] = out_path

    except Exception as e:
        logger.error(f"Error rendering clip {idx} in batch {batch_id}: {e}")
        clip_status["status"] = "error"
        err_msg = str(e)
        if "moov atom not found" in err_msg.lower():
            err_msg = "Download interrupted by internet lag ('moov atom not found'). Click Retry to re-download."
        elif "timed out" in err_msg.lower() or "timeout" in err_msg.lower():
            err_msg = "Download timed out due to slow/laggy internet connection. Click Retry to try again."
        clip_status["error_message"] = err_msg
        clip_status["error"] = err_msg

        # Clean up any partial raw video
        if raw_path and os.path.exists(raw_path):
            try:
                os.unlink(raw_path)
            except Exception:
                pass


def update_batch_summary_and_zip(batch_id: str, settings: RenderSettingsModel):
    """
    Updates the batch ZIP archive and computes overall status and friendly messages.
    """
    batch = RENDER_BATCHES.get(batch_id)
    if not batch:
        return

    # Generate/update ZIP bundle for the batch with title-based filenames and duplicate handling
    try:
        completed_clips = [c for c in batch["clips"] if c.get("status") == "completed" and c.get("download_url")]
        if completed_clips:
            zip_filename = f"cheat_clip_pro_{batch_id}.zip"
            zip_path = EXPORTS_DIR / zip_filename
            title_counts: Dict[str, int] = {}
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
                for c in completed_clips:
                    fname = c["download_url"].split("?")[0].split("/")[-1]
                    fpath = EXPORTS_DIR / fname
                    if fpath.exists():
                        raw_title = (c.get("base_title") or c.get("title") or "").strip()
                        clean_title = re.sub(r'[\\/*?:"<>|]', "", raw_title) or f"clip_{c.get('clip_index', 1)}"
                        fn_pfx = re.sub(r'[\\/*?:"<>|]', "", settings.file_name_prefix or "")
                        fn_sfx = re.sub(r'[\\/*?:"<>|]', "", settings.file_name_suffix or "")
                        formatted_name = f"{fn_pfx}{clean_title}{fn_sfx}".strip() or clean_title
                        count = title_counts.get(formatted_name, 0)
                        title_counts[formatted_name] = count + 1
                        arc_name = f"{formatted_name}.mp4" if count == 0 else f"{formatted_name} ({count}).mp4"
                        zipf.write(fpath, arcname=arc_name)
            batch["zip_url"] = f"/api/download-batch-zip/{batch_id}"
        else:
            batch["zip_url"] = None
    except Exception as e:
        logger.warning(f"Failed to create batch zip: {e}")

    # Determine overall status and error messaging
    failed_clips = [c for c in batch["clips"] if c.get("status") == "error"]
    running_clips = [c for c in batch["clips"] if c.get("status") in ["downloading", "transcribing", "rendering", "pending"]]

    if running_clips:
        batch["overall_status"] = "running"
    elif len(failed_clips) == len(batch["clips"]):
        batch["overall_status"] = "error"
        batch["error_message"] = f"All {len(batch['clips'])} clip(s) failed. You can click 'Retry' to try again."
    elif len(failed_clips) > 0:
        batch["overall_status"] = "completed"
        batch["warning_message"] = f"{len(failed_clips)} of {len(batch['clips'])} clips encountered errors. You can retry failed clips anytime."
    else:
        batch["overall_status"] = "completed"
        batch["warning_message"] = None


async def process_batch_rendering(batch_id: str, request: RenderBatchRequest):
    batch = RENDER_BATCHES.get(batch_id)
    if not batch:
        return

    clips = request.clips
    settings = request.settings

    # Normalize video URL for history or direct URL
    target_url = (request.video_url or "").strip()
    if not target_url.startswith("http"):
        target_url = f"https://www.youtube.com/watch?v={request.video_id or target_url}"

    for idx, clip in enumerate(clips):
        batch["current_clip_index"] = idx
        await render_single_batch_clip(
            batch_id=batch_id,
            idx=idx,
            clip=clip,
            settings=settings,
            target_url=target_url,
            transcript=request.transcript,
            total_clips=len(clips)
        )
        # Fallback continuation: regardless of whether clip succeeded or failed, proceed to next clip!
        batch["current_clip_index"] = idx + 1

    update_batch_summary_and_zip(batch_id, settings)


async def process_batch_retry(batch_id: str, clip_indices: List[int]):
    batch = RENDER_BATCHES.get(batch_id)
    request = BATCH_REQUESTS.get(batch_id)
    if not batch or not request:
        logger.error(f"Cannot retry batch {batch_id}: batch or request data not found")
        return

    batch["overall_status"] = "running"
    clips = request.clips
    settings = request.settings
    target_url = (request.video_url or "").strip()
    if not target_url.startswith("http"):
        target_url = f"https://www.youtube.com/watch?v={request.video_id or target_url}"

    for idx in clip_indices:
        if 0 <= idx < len(clips):
            batch["current_clip_index"] = idx
            await render_single_batch_clip(
                batch_id=batch_id,
                idx=idx,
                clip=clips[idx],
                settings=settings,
                target_url=target_url,
                transcript=request.transcript,
                total_clips=len(clips)
            )

    update_batch_summary_and_zip(batch_id, settings)


@app.post("/api/render-batch")
async def start_batch_render(request: RenderBatchRequest, background_tasks: BackgroundTasks):
    if not request.clips:
        raise HTTPException(status_code=400, detail="No clips provided for rendering")

    batch_id = f"batch_{int(time.time())}_{uuid.uuid4().hex[:6]}"

    pfx = (request.settings.title_prefix or "") if request.settings else ""
    sfx = (request.settings.title_suffix or "") if request.settings else ""

    clips_status = []
    for idx, c in enumerate(request.clips):
        base_t = (c.get("custom_title") or c.get("title_suggestion") or c.get("title") or f"Clip {idx+1}").strip()
        full_t = f"{pfx}{base_t}{sfx}".strip() if (pfx or sfx) else base_t
        clips_status.append({
            "clip_index": idx,
            "title": full_t,
            "base_title": base_t,
            "status": "pending",
            "progress_percent": 0
        })

    RENDER_BATCHES[batch_id] = {
        "batch_id": batch_id,
        "total_clips": len(request.clips),
        "current_clip_index": 0,
        "overall_status": "running",
        "clips": clips_status,
        "zip_url": None
    }
    BATCH_REQUESTS[batch_id] = request

    background_tasks.add_task(process_batch_rendering, batch_id, request)
    return {"batch_id": batch_id, "total_clips": len(request.clips)}


@app.post("/api/render-batch/{batch_id}/retry")
async def retry_batch_rendering(
    batch_id: str,
    background_tasks: BackgroundTasks,
    body: Optional[RetryBatchRequest] = None
):
    if batch_id not in RENDER_BATCHES:
        raise HTTPException(status_code=404, detail="Batch not found")
    batch = RENDER_BATCHES[batch_id]
    if batch_id not in BATCH_REQUESTS:
        raise HTTPException(status_code=400, detail="Batch configuration expired. Please start a new render.")

    if batch.get("overall_status") == "running":
        # Check if any clip is actively running
        running = any(c.get("status") in ["downloading", "transcribing", "rendering"] for c in batch.get("clips", []))
        if running:
            raise HTTPException(status_code=400, detail="Batch is currently rendering. Please wait for the current clip to finish.")

    req = BATCH_REQUESTS[batch_id]
    indices_to_retry: List[int] = []
    if body and body.clip_indices:
        indices_to_retry = [i for i in body.clip_indices if 0 <= i < len(batch["clips"])]
    else:
        indices_to_retry = [i for i, c in enumerate(batch["clips"]) if c.get("status") == "error"]

    if not indices_to_retry:
        raise HTTPException(status_code=400, detail="No failed clips to retry in this batch.")

    for idx in indices_to_retry:
        batch["clips"][idx]["status"] = "pending"
        batch["clips"][idx]["progress_percent"] = 0
        batch["clips"][idx]["error_message"] = None
        batch["clips"][idx]["error"] = None

    batch["overall_status"] = "running"
    batch["error_message"] = None
    batch["warning_message"] = None

    background_tasks.add_task(process_batch_retry, batch_id, indices_to_retry)
    return {
        "status": "started",
        "batch_id": batch_id,
        "retrying_clips": indices_to_retry
    }


@app.get("/api/render-progress/{batch_id}")
async def get_render_progress(batch_id: str):
    if batch_id not in RENDER_BATCHES:
        raise HTTPException(status_code=404, detail="Batch not found")

    async def stream():
        last_sent_json = None
        idle_count = 0
        while True:
            batch = RENDER_BATCHES.get(batch_id)
            if not batch:
                break
            batch_json = json.dumps(batch)
            if batch_json != last_sent_json:
                yield f"data: {batch_json}\n\n"
                last_sent_json = batch_json
                idle_count = 0
            else:
                idle_count += 1
                # Send SSE keep-alive comment every 5 iterations (~2.5s) to prevent client/proxy timeout during lag
                if idle_count % 5 == 0:
                    yield ": keep-alive\n\n"
            if batch.get("overall_status") in ["completed", "error"]:
                # Yield final state once and break
                yield f"data: {batch_json}\n\n"
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.get("/api/download-rendered/{file_name}")
def download_rendered_file(file_name: str, title: Optional[str] = None):
    safe_name = os.path.basename(file_name)
    file_path = EXPORTS_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Rendered clip not found")

    # If title provided, sanitize and use as download filename
    dl_filename = safe_name
    if title and title.strip():
        clean_title = re.sub(r'[\\/*?:"<>|]', "", title.strip())
        if clean_title:
            dl_filename = f"{clean_title}.mp4" if not clean_title.lower().endswith(".mp4") else clean_title

    return FileResponse(file_path, media_type="video/mp4", filename=dl_filename)


@app.get("/api/download-batch-zip/{batch_id}")
def download_batch_zip(batch_id: str):
    clean_id = os.path.basename(batch_id)
    safe_name = f"cheat_clip_pro_{clean_id}.zip"
    file_path = EXPORTS_DIR / safe_name
    if not file_path.exists():
        # Attempt to package any completed clips for this batch on the fly
        job = RENDER_BATCHES.get(batch_id)
        if job and job.get("clips"):
            try:
                title_counts: Dict[str, int] = {}
                with zipfile.ZipFile(file_path, "w", zipfile.ZIP_DEFLATED) as zipf:
                    for c in job["clips"]:
                        c_out = c.get("output_path")
                        if not c_out and c.get("download_url"):
                            fname = c["download_url"].split("/")[-1]
                            c_out = str(EXPORTS_DIR / fname)
                        if c_out and os.path.exists(c_out):
                            raw_title = (c.get("title") or "").strip()
                            clean_title = re.sub(r'[\\/*?:"<>|]', "", raw_title) or os.path.splitext(os.path.basename(c_out))[0]
                            count = title_counts.get(clean_title, 0)
                            title_counts[clean_title] = count + 1
                            arc_name = f"{clean_title}.mp4" if count == 0 else f"{clean_title} ({count}).mp4"
                            zipf.write(c_out, arcname=arc_name)
            except Exception as e:
                logger.error(f"Error packaging batch zip on the fly: {e}")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Batch zip file not found")
    return FileResponse(file_path, media_type="application/zip", filename=safe_name)


@app.get("/api/hardware-accel")
def get_hardware_acceleration_status():
    """Returns detected GPU/CPU hardware acceleration options and recommendations."""
    support = detect_hardware_support()
    rec = support.get("recommended", "cpu")
    return {
        "status": "success",
        "active_default": ACTIVE_ENCODER_NAME,
        "recommended": rec,
        "support": support,
        "options": [
            {
                "id": "auto",
                "label": "Auto Detect",
                "sub": f"Recommended ({rec.upper()})",
                "available": True,
            },
            {
                "id": "nvenc",
                "label": "NVIDIA NVENC",
                "sub": "GeForce & RTX Hardware Acceleration",
                "available": support.get("nvenc", False),
            },
            {
                "id": "amf",
                "label": "AMD AMF",
                "sub": "Radeon RX & APU Hardware Acceleration",
                "available": support.get("amf", False),
            },
            {
                "id": "qsv",
                "label": "Intel QuickSync",
                "sub": "Intel Arc & UHD Hardware Acceleration",
                "available": support.get("qsv", False),
            },
            {
                "id": "cpu",
                "label": "CPU Software (libx264)",
                "sub": "Multi-threaded CPU (100% Universal)",
                "available": True,
            },
        ],
    }


@app.post("/api/upload-bgm")
async def upload_bgm(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    ext = os.path.splitext(file.filename)[1].lower()
    allowed = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported audio format. Allowed: {', '.join(allowed)}")
    
    clean_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', file.filename)
    unique_name = f"bgm_{uuid.uuid4().hex[:8]}_{clean_name}"
    save_path = UPLOADS_DIR / unique_name
    
    try:
        content = await file.read()
        with open(save_path, "wb") as f:
            f.write(content)
        return {
            "success": True,
            "filename": file.filename,
            "saved_name": unique_name,
            "file_path": str(save_path),
            "url": f"/api/audio/{unique_name}",
            "size_bytes": len(content)
        }
    except Exception as e:
        logger.error(f"Failed to upload BGM: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/audio/{file_name}")
def get_audio_file(file_name: str):
    clean_name = os.path.basename(file_name)
    file_path = UPLOADS_DIR / clean_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    media_type = "audio/mpeg" if clean_name.endswith(".mp3") else "audio/wav" if clean_name.endswith(".wav") else "application/octet-stream"
    return FileResponse(file_path, media_type=media_type, filename=clean_name)


@app.post("/api/upload-sfx")
async def upload_hook_sfx(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    ext = os.path.splitext(file.filename)[1].lower()
    allowed = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported audio format. Allowed: {', '.join(allowed)}")

    clean_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', file.filename)
    unique_name = f"sfx_{uuid.uuid4().hex[:8]}_{clean_name}"
    save_path = UPLOADS_DIR / unique_name

    try:
        content = await file.read()
        with open(save_path, "wb") as f:
            f.write(content)
        return {
            "success": True,
            "filename": file.filename,
            "saved_name": unique_name,
            "file_path": str(save_path),
            "url": f"/api/audio/{unique_name}",
            "size_bytes": len(content)
        }
    except Exception as e:
        logger.error(f"Failed to upload Hook SFX: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload-watermark")
async def upload_watermark(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    ext = os.path.splitext(file.filename)[1].lower()
    allowed = [".png", ".jpg", ".jpeg", ".webp", ".svg"]
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported image format. Allowed: {', '.join(allowed)}")
    
    clean_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', file.filename)
    unique_name = f"wm_{uuid.uuid4().hex[:8]}_{clean_name}"
    save_path = UPLOADS_DIR / unique_name
    
    try:
        content = await file.read()
        with open(save_path, "wb") as f:
            f.write(content)
        return {
            "success": True,
            "filename": file.filename,
            "saved_name": unique_name,
            "file_path": str(save_path),
            "url": f"/api/watermark/{unique_name}",
            "size_bytes": len(content)
        }
    except Exception as e:
        logger.error(f"Failed to upload watermark: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/watermark/{file_name}")
def get_watermark_file(file_name: str):
    clean_name = os.path.basename(file_name)
    file_path = UPLOADS_DIR / clean_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Watermark file not found")
    media_type = "image/png" if clean_name.endswith(".png") else "image/jpeg" if (clean_name.endswith(".jpg") or clean_name.endswith(".jpeg")) else "image/webp"
    return FileResponse(file_path, media_type=media_type, filename=clean_name)


# ----------------------------------------------------------------
# Cookies Management & Raw Full Video Download Endpoints
# ----------------------------------------------------------------

class CookiesSaveRequest(BaseModel):
    cookies: Optional[str] = None
    cookies_content: Optional[str] = None


@app.post("/api/cookies")
def save_youtube_cookies(req: CookiesSaveRequest):
    content = (req.cookies_content or req.cookies or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Cookies content cannot be empty")
    try:
        with open(COOKIES_PATH, "w", encoding="utf-8") as f:
            f.write(content)
        try:
            with open(ROOT_COOKIES_PATH, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception:
            pass
        return {
            "success": True,
            "status": "saved",
            "exists": True,
            "has_cookies": True,
            "size": len(content)
        }
    except Exception as e:
        logger.error(f"Failed to save cookies: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cookies")
def get_youtube_cookies_status():
    eff = get_effective_cookies_path()
    if eff:
        sample_lines = []
        cookies_content = ""
        try:
            with open(eff, "r", encoding="utf-8", errors="ignore") as f:
                cookies_content = f.read()
                for line in cookies_content.splitlines():
                    line = line.strip()
                    if line and not line.startswith("#"):
                        parts = line.split("\t")
                        if parts and len(parts) > 0:
                            domain = parts[0]
                            if domain not in sample_lines:
                                sample_lines.append(domain)
                            if len(sample_lines) >= 6:
                                break
        except Exception:
            pass
        return {
            "exists": True,
            "has_cookies": True,
            "size": eff.stat().st_size,
            "sample_lines": sample_lines,
            "cookies_content": cookies_content
        }
    return {"exists": False, "has_cookies": False, "size": 0, "sample_lines": [], "cookies_content": ""}


@app.delete("/api/cookies")
def delete_youtube_cookies():
    for p in [COOKIES_PATH, ROOT_COOKIES_PATH]:
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass
    return {"success": True, "status": "deleted", "exists": False, "has_cookies": False}


class RawVideoDownloadRequest(BaseModel):
    video_url: str
    video_id: str
    title: Optional[str] = None


raw_download_jobs: Dict[str, dict] = {}


async def run_raw_download_job(job_id: str, v_url: str, out_path: str, filename: str, download_title: Optional[str] = None):
    def on_progress(p: dict):
        if job_id in raw_download_jobs:
            raw_download_jobs[job_id]["progress_percent"] = p.get("percent", 0.0)
            raw_download_jobs[job_id]["downloaded"] = p.get("downloaded", "")
            raw_download_jobs[job_id]["total"] = p.get("total", "")
            raw_download_jobs[job_id]["speed"] = p.get("speed", "")
            raw_download_jobs[job_id]["eta"] = p.get("eta", "")

    try:
        raw_download_jobs[job_id]["status"] = "downloading"
        await asyncio.to_thread(download_full_raw_video, v_url, out_path, on_progress)
        raw_download_jobs[job_id]["status"] = "ready"
        raw_download_jobs[job_id]["progress_percent"] = 100.0
        dl_name = download_title or filename
        raw_download_jobs[job_id]["download_url"] = f"/api/download-rendered/{filename}?title={quote(dl_name)}"
        raw_download_jobs[job_id]["filename"] = f"{dl_name}.mp4" if not dl_name.endswith(".mp4") else dl_name
    except Exception as e:
        logger.error(f"Raw video download job {job_id} failed: {e}")
        raw_download_jobs[job_id]["status"] = "failed"
        raw_download_jobs[job_id]["error"] = str(e)


@app.post("/api/download-raw-video")
async def handle_download_raw_video(req: RawVideoDownloadRequest, background_tasks: BackgroundTasks):
    v_url = req.video_url.strip() if req.video_url else ""
    if not v_url.startswith("http"):
        v_url = f"https://www.youtube.com/watch?v={req.video_id or v_url}"

    job_id = str(uuid.uuid4())[:8]
    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '_', req.video_id or "youtube_video")
    filename = f"{safe_id}_raw_{int(time.time())}.mp4"
    out_path = str(EXPORTS_DIR / filename)

    clean_title = re.sub(r'[\\/*?:"<>|]', "", (req.title or "").strip())
    download_title = f"{clean_title} (Full Video)" if clean_title else f"{safe_id} (Full Video)"

    raw_download_jobs[job_id] = {
        "job_id": job_id,
        "status": "starting",
        "progress_percent": 0.0,
        "downloaded": "",
        "total": "",
        "speed": "",
        "eta": "",
        "download_url": None,
        "filename": f"{download_title}.mp4",
        "error": None
    }

    background_tasks.add_task(run_raw_download_job, job_id, v_url, out_path, filename, download_title)
    return {"job_id": job_id, "status": "starting"}


@app.get("/api/download-raw-status/{job_id}")
async def get_raw_download_status(job_id: str):
    job = raw_download_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Download job not found")
    return job


class RawClipDownloadRequest(BaseModel):
    video_url: str
    video_id: str
    start_time: float
    end_time: float
    title: str


raw_clip_download_jobs: Dict[str, dict] = {}


async def run_raw_clip_download_job(
    job_id: str,
    v_url: str,
    video_id: str,
    start_time: float,
    end_time: float,
    title: str
):
    clean_title = re.sub(r'[\\/*?:"<>|]', "", (title or "clip").strip())
    if not clean_title:
        clean_title = f"clip_{int(start_time)}_{int(end_time)}"
    download_title = f"{clean_title} (raw)"
    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '_', video_id or "clip")
    seg_filename = f"{safe_id}_clip_{int(start_time)}_{int(end_time)}_{int(time.time())}_raw.mp4"
    out_path = EXPORTS_DIR / seg_filename

    try:
        raw_clip_download_jobs[job_id]["status"] = "downloading"
        raw_clip_download_jobs[job_id]["progress_percent"] = 25.0

        # Optimization: Check if a full raw video already exists locally in EXPORTS_DIR or TEMP_DIR
        local_candidates = list(EXPORTS_DIR.glob(f"*{safe_id}*.mp4")) + list(TEMP_DIR.glob(f"*{safe_id}*.mp4"))
        source_video = None
        for candidate in local_candidates:
            if candidate.exists() and candidate.stat().st_size > 5 * 1024 * 1024 and is_valid_mp4(candidate):
                # Avoid using a small trimmed clip segment as source
                if "_clip_" not in candidate.name and candidate.name != seg_filename:
                    source_video = str(candidate)
                    break

        duration_sec = max(1.0, end_time - start_time)

        success = False
        if source_video and os.path.exists(source_video):
            try:
                logger.info(f"Trimming local video with {ACTIVE_ENCODER_NAME} for clip {download_title} ({start_time}-{end_time})")
                trim_cmd = [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-ss", str(start_time),
                    "-i", source_video,
                    "-t", str(duration_sec),
                    *ACTIVE_ENCODER_ARGS,
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-avoid_negative_ts", "make_zero",
                    "-movflags", "+faststart",
                    str(out_path)
                ]
                await asyncio.to_thread(subprocess.run, trim_cmd, check=True, timeout=90)
                if out_path.exists() and out_path.stat().st_size > 1000:
                    success = True
            except Exception as trim_err:
                logger.warning(f"Hardware trimming failed ({trim_err}), retrying with CPU libx264...")
                try:
                    cpu_trim_cmd = [
                        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                        "-ss", str(start_time),
                        "-i", source_video,
                        "-t", str(duration_sec),
                        "-c:v", "libx264",
                        "-preset", "veryfast",
                        "-crf", "20",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-avoid_negative_ts", "make_zero",
                        "-movflags", "+faststart",
                        str(out_path)
                    ]
                    await asyncio.to_thread(subprocess.run, cpu_trim_cmd, check=True, timeout=90)
                    if out_path.exists() and out_path.stat().st_size > 1000:
                        success = True
                except Exception as cpu_err:
                    logger.warning(f"CPU trimming also failed ({cpu_err}), falling back to direct stream download...")

        if not success:
            logger.info(f"Downloading clip segment from YouTube for {download_title} ({start_time}-{end_time})")
            temp_name = f"temp_{seg_filename}"
            downloaded_temp = await asyncio.to_thread(
                download_clip_segment,
                v_url,
                start_time,
                end_time,
                temp_name
            )
            if downloaded_temp and os.path.exists(downloaded_temp):
                if out_path.exists():
                    try:
                        out_path.unlink()
                    except Exception:
                        pass
                # Fast timestamp and keyframe normalization to eliminate any playback stutter
                fix_cmd = [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-i", downloaded_temp,
                    "-c", "copy",
                    "-avoid_negative_ts", "make_zero",
                    "-movflags", "+faststart",
                    str(out_path)
                ]
                try:
                    await asyncio.to_thread(subprocess.run, fix_cmd, check=True, timeout=45)
                    if out_path.exists() and out_path.stat().st_size > 1000:
                        success = True
                        try:
                            os.unlink(downloaded_temp)
                        except Exception:
                            pass
                except Exception:
                    shutil.move(downloaded_temp, str(out_path))
                    if out_path.exists() and out_path.stat().st_size > 1000:
                        success = True

        if success and out_path.exists() and is_valid_mp4(out_path):
            raw_clip_download_jobs[job_id]["status"] = "ready"
            raw_clip_download_jobs[job_id]["progress_percent"] = 100.0
            raw_clip_download_jobs[job_id]["download_url"] = f"/api/download-rendered/{seg_filename}?title={quote(download_title)}"
            raw_clip_download_jobs[job_id]["filename"] = f"{download_title}.mp4"
            logger.info(f"Raw clip '{download_title}' ready at {out_path}")
        else:
            raise RuntimeError("Generated clip file is missing or invalid.")

    except Exception as e:
        logger.error(f"Raw clip download job {job_id} failed: {e}")
        raw_clip_download_jobs[job_id]["status"] = "failed"
        raw_clip_download_jobs[job_id]["error"] = str(e)


@app.post("/api/download-raw-clip")
async def handle_download_raw_clip(req: RawClipDownloadRequest, background_tasks: BackgroundTasks):
    v_url = req.video_url.strip() if req.video_url else ""
    if not v_url.startswith("http"):
        v_url = f"https://www.youtube.com/watch?v={req.video_id or v_url}"

    job_id = str(uuid.uuid4())[:8]
    clean_title = re.sub(r'[\\/*?:"<>|]', "", (req.title or "clip").strip()) or "clip"
    download_title = f"{clean_title} (raw)"

    raw_clip_download_jobs[job_id] = {
        "job_id": job_id,
        "status": "starting",
        "progress_percent": 0.0,
        "title": download_title,
        "download_url": None,
        "filename": f"{download_title}.mp4",
        "error": None
    }

    background_tasks.add_task(
        run_raw_clip_download_job,
        job_id,
        v_url,
        req.video_id,
        req.start_time,
        req.end_time,
        req.title
    )
    return {"job_id": job_id, "status": "starting"}


@app.get("/api/download-raw-clip-status/{job_id}")
async def get_raw_clip_download_status(job_id: str):
    job = raw_clip_download_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Clip download job not found")
    return job


@app.get("/api/clip-frame")
async def get_clip_frame(video_id: str, timestamp: float = 0.0, video_url: Optional[str] = None):
    """
    Returns an extracted real video frame at timestamp for the real video preview.
    Guarantees returning a real video frame, never a promotional thumbnail.
    """
    try:
        frame_path = await asyncio.to_thread(extract_clip_frame, video_url or "", video_id, timestamp)
        if frame_path and os.path.exists(frame_path):
            return FileResponse(frame_path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
    except Exception as e:
        logger.warning(f"Failed to serve extracted frame for {video_id}: {e}")

    raise HTTPException(status_code=404, detail="Real video frame could not be extracted yet")


@app.get("/api/detect-face")
async def detect_face(
    video_id: str,
    timestamp: float = 0.0,
    video_url: Optional[str] = None,
    facecam_position: Optional[str] = "auto",
    streamer_preset: Optional[str] = "none"
):
    """
    Detects speaker face coordinates (cx, cy, w, h) on the video at timestamp.
    Returns normalized coordinates and the frame URL.
    """
    is_streamer = (streamer_preset or "none") in ["split_top_cam", "pip_corner"]
    default_cx = 0.85 if is_streamer else 0.5
    default_cy = 0.78 if is_streamer else 0.35
    default_res = {
        "found": False,
        "cx": default_cx,
        "cy": default_cy,
        "w": 0.22,
        "h": 0.25,
        "frame_url": f"/api/clip-frame?video_id={video_id}&timestamp={timestamp}"
    }
    try:
        # First try to extract or get the cached frame
        frame_path = await asyncio.to_thread(extract_clip_frame, video_url or "", video_id, timestamp)
        if frame_path and os.path.exists(frame_path):
            box = await asyncio.to_thread(
                detect_speaker_face_box,
                frame_path,
                facecam_position or "auto",
                streamer_preset or "none"
            )
            box["frame_url"] = f"/api/clip-frame?video_id={video_id}&timestamp={timestamp}"
            return box

        # If frame extract didn't complete, check local candidates
        safe_id = re.sub(r'[^a-zA-Z0-9_-]', '_', video_id)
        local_candidates = list(TEMP_DIR.glob(f"*{safe_id}*.mp4")) + list(EXPORTS_DIR.glob(f"*{safe_id}*.mp4"))
        for candidate in local_candidates:
            if candidate.exists() and candidate.stat().st_size > 10000 and "slice_" not in candidate.name and is_valid_mp4(candidate):
                box = await asyncio.to_thread(
                    detect_speaker_face_box,
                    str(candidate),
                    facecam_position or "auto",
                    streamer_preset or "none"
                )
                box["frame_url"] = f"/api/clip-frame?video_id={video_id}&timestamp={timestamp}"
                return box
    except Exception as e:
        logger.warning(f"Face detection API error: {e}")

    return default_res


def _get_dir_size_and_count(dir_path) -> tuple[int, int]:
    from pathlib import Path
    p = Path(dir_path)
    total_bytes = 0
    total_files = 0
    if p.exists() and p.is_dir():
        for item in p.rglob("*"):
            if item.is_file():
                try:
                    total_bytes += item.stat().st_size
                    total_files += 1
                except Exception:
                    pass
    return total_files, total_bytes


@app.get("/api/temp-storage-info")
async def get_temp_storage_info():
    """Returns total files, bytes, and formatted size of temp download storage."""
    from pathlib import Path
    base_dir = Path(_base_dir)
    f1, b1 = _get_dir_size_and_count(TEMP_DIR)
    f2, b2 = _get_dir_size_and_count(base_dir / "temp")
    tot_files = f1 + f2
    tot_bytes = b1 + b2
    tot_mb = round(tot_bytes / (1024 * 1024), 2)
    formatted = f"{tot_mb} MB" if tot_mb < 1024 else f"{round(tot_mb / 1024, 2)} GB"
    return {
        "total_files": tot_files,
        "total_bytes": tot_bytes,
        "total_mb": tot_mb,
        "formatted_size": formatted
    }


@app.post("/api/clear-temp")
async def clear_temp_folder():
    """
    Clears all temporary downloaded video clips, audio slices, ASS files, and frames
    from TEMP_DIR and backend/temp. Re-creates empty directories.
    PROTECTED: cookies.txt and any cookie files are strictly PRESERVED and NEVER deleted.
    """
    import shutil
    from pathlib import Path
    base_dir = Path(_base_dir)
    cleared_files = 0
    cleared_bytes = 0

    PROTECTED_COOKIE_NAMES = {"cookies.txt", ".cookies", "youtube_cookies.txt", "cookie.txt"}

    def is_protected_cookie(p: Path) -> bool:
        if p.name.lower() in PROTECTED_COOKIE_NAMES:
            return True
        try:
            if COOKIES_PATH.exists() and p.resolve() == COOKIES_PATH.resolve():
                return True
        except Exception:
            pass
        return False

    target_dirs = [TEMP_DIR, base_dir / "temp"]
    for d in target_dirs:
        if d.exists() and d.is_dir():
            for item in list(d.iterdir()):
                try:
                    if is_protected_cookie(item):
                        logger.info(f"Preserving protected cookie file: {item}")
                        continue

                    if item.is_file() or item.is_symlink():
                        sz = item.stat().st_size
                        item.unlink()
                        cleared_files += 1
                        cleared_bytes += sz
                    elif item.is_dir():
                        has_cookie = False
                        for sub in list(item.rglob("*")):
                            if is_protected_cookie(sub):
                                has_cookie = True
                                logger.info(f"Preserving protected cookie file inside folder: {sub}")
                                continue
                            if sub.is_file() or sub.is_symlink():
                                try:
                                    cleared_files += 1
                                    cleared_bytes += sub.stat().st_size
                                    sub.unlink()
                                except Exception:
                                    pass
                        if not has_cookie:
                            shutil.rmtree(item, ignore_errors=True)
                except Exception as e:
                    logger.warning(f"Could not delete temp item {item}: {e}")
        d.mkdir(parents=True, exist_ok=True)

    # Ensure frames directory inside TEMP_DIR exists
    (TEMP_DIR / "frames").mkdir(parents=True, exist_ok=True)

    cleared_mb = round(cleared_bytes / (1024 * 1024), 2)
    formatted = f"{cleared_mb} MB" if cleared_mb < 1024 else f"{round(cleared_mb / 1024, 2)} GB"
    cookies_present = bool(COOKIES_PATH.exists() and COOKIES_PATH.stat().st_size > 0)
    logger.info(f"Cleared temp folder: {cleared_files} files, {formatted} (Cookies preserved: {cookies_present})")
    return {
        "success": True,
        "cleared_files": cleared_files,
        "cleared_bytes": cleared_bytes,
        "cleared_mb": cleared_mb,
        "cookies_preserved": True,
        "has_cookies": cookies_present,
        "message": f"Successfully cleared {cleared_files} temporary files ({formatted}). Stored YouTube cookies preserved."
    }


# ----------------------------------------------------------------
# System Version, Update, and Auto-Restart Endpoints (Option B)
# ----------------------------------------------------------------

def run_git_command(args: List[str], cwd: Optional[Path] = None, timeout: int = 15) -> Tuple[int, str, str]:
    """Runs a git command safely and returns (returncode, stdout, stderr)."""
    target_cwd = cwd or Path(_base_dir).parent
    try:
        proc = subprocess.run(
            ["git"] + args,
            cwd=str(target_cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout
        )
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except Exception as e:
        return -1, "", str(e)

def get_current_git_info() -> dict:
    """Retrieves current commit, branch, and remote URL information."""
    root_dir = Path(_base_dir).parent
    rc, commit_info, _ = run_git_command(["log", "-1", "--pretty=format:%h|%H|%s|%cd", "--date=short"], cwd=root_dir)
    rc_branch, branch, _ = run_git_command(["branch", "--show-current"], cwd=root_dir)
    rc_remote, remote_url, _ = run_git_command(["remote", "get-url", "origin"], cwd=root_dir)

    commit_hash = "unknown"
    commit_full = ""
    commit_msg = "Unknown commit"
    commit_date = ""
    if rc == 0 and commit_info:
        parts = commit_info.split("|")
        if len(parts) >= 4:
            commit_hash = parts[0]
            commit_full = parts[1]
            commit_msg = parts[2]
            commit_date = parts[3]

    return {
        "current_commit": commit_hash,
        "current_commit_full": commit_full,
        "commit_message": commit_msg,
        "commit_date": commit_date,
        "branch": branch if rc_branch == 0 and branch else "master",
        "remote_url": remote_url if rc_remote == 0 and remote_url else "https://github.com/galihjuansaputra/cheat-clip-pro.git"
    }

def trigger_detached_restart(delay: float = 2.5):
    """Launches backend/restart_runner.py in a fully detached background process."""
    root_dir = Path(_base_dir).parent
    runner_script = root_dir / "backend" / "restart_runner.py"
    
    flags = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS) if os.name == 'nt' else 0
    subprocess.Popen(
        [sys.executable, str(runner_script), "--delay", str(delay), "--cwd", str(root_dir)],
        cwd=str(root_dir),
        creationflags=flags,
        start_new_session=True if os.name != 'nt' else False,
        close_fds=True
    )
    logger.info(f"Detached restart runner spawned with delay={delay}s")

@app.get("/api/system/version")
def api_system_version():
    """Returns local git version information."""
    return get_current_git_info()

@app.get("/api/system/check-update")
def api_check_update():
    """Fetches origin and checks if updates are available."""
    root_dir = Path(_base_dir).parent
    info = get_current_git_info()
    branch = info.get("branch", "master") or "master"

    # Fetch origin
    rc_fetch, _, err_fetch = run_git_command(["fetch", "origin", branch], cwd=root_dir, timeout=20)
    if rc_fetch != 0:
        return {
            **info,
            "update_available": False,
            "behind_count": 0,
            "changelog": [],
            "error": f"Failed to fetch updates from remote: {err_fetch or 'Network or remote error'}"
        }

    # Count commits behind
    rc_count, count_str, _ = run_git_command(["rev-list", "--count", "HEAD..FETCH_HEAD"], cwd=root_dir)
    behind_count = int(count_str) if rc_count == 0 and count_str.isdigit() else 0

    # Get changelog of new commits
    changelog = []
    if behind_count > 0:
        rc_log, log_str, _ = run_git_command(["log", "HEAD..FETCH_HEAD", "--pretty=format:%h|%s|%cd", "--date=short"], cwd=root_dir)
        if rc_log == 0 and log_str:
            for line in log_str.splitlines():
                p = line.strip().split("|")
                if len(p) >= 3:
                    changelog.append({"hash": p[0], "message": p[1], "date": p[2]})

    rc_remote_commit, remote_commit, _ = run_git_command(["rev-parse", "--short", "FETCH_HEAD"], cwd=root_dir)

    return {
        **info,
        "update_available": behind_count > 0,
        "behind_count": behind_count,
        "remote_commit": remote_commit if rc_remote_commit == 0 else info["current_commit"],
        "changelog": changelog
    }

@app.post("/api/system/update")
async def api_perform_update():
    """Pulls latest code, syncs dependencies if modified, and triggers background restart."""
    root_dir = Path(_base_dir).parent
    info = get_current_git_info()
    branch = info.get("branch", "master") or "master"
    old_head = info.get("current_commit_full", "HEAD")

    # 1. Fetch latest
    rc_fetch, _, err_fetch = run_git_command(["fetch", "origin", branch], cwd=root_dir, timeout=25)
    if rc_fetch != 0:
        raise HTTPException(status_code=500, detail=f"Failed to fetch updates: {err_fetch}")

    # 2. Check if working tree has tracked changes
    rc_status, status_out, _ = run_git_command(["status", "--porcelain"], cwd=root_dir)
    has_local_changes = False
    if rc_status == 0 and status_out:
        for line in status_out.splitlines():
            if not line.startswith("??"):
                has_local_changes = True
                break

    if has_local_changes:
        logger.info("Local changes detected. Stashing before update...")
        run_git_command(["stash", "save", "Auto-stash before Cheat Clip PRO update"], cwd=root_dir)

    # 3. Pull latest changes
    rc_pull, pull_out, err_pull = run_git_command(["pull", "origin", branch], cwd=root_dir, timeout=40)
    if rc_pull != 0:
        if has_local_changes:
            run_git_command(["stash", "pop"], cwd=root_dir)
        raise HTTPException(status_code=500, detail=f"Git pull failed: {err_pull or pull_out}")

    if has_local_changes:
        logger.info("Reapplying stashed local changes...")
        run_git_command(["stash", "pop"], cwd=root_dir)

    # 4. Check what files changed between old_head and new HEAD
    rc_diff, diff_files, _ = run_git_command(["diff", f"{old_head}..HEAD", "--name-only"], cwd=root_dir)
    changed_files = diff_files.splitlines() if rc_diff == 0 and diff_files else []

    updated_deps = []
    # If package.json changed, run npm install
    if "package.json" in changed_files:
        logger.info("package.json changed. Running npm install...")
        try:
            cmd = "npm.cmd install" if os.name == "nt" else "npm install"
            subprocess.run(cmd, shell=True, cwd=str(root_dir), timeout=120)
            updated_deps.append("Node modules (npm install)")
        except Exception as e:
            logger.warning(f"npm install warning: {e}")

    # If requirements.txt changed, run pip install
    if any("requirements.txt" in f for f in changed_files):
        logger.info("requirements.txt changed. Running pip install...")
        try:
            pip_cmd = f'"{sys.executable}" -m pip install -r backend/requirements.txt'
            subprocess.run(pip_cmd, shell=True, cwd=str(root_dir), timeout=180)
            updated_deps.append("Python dependencies (pip install)")
        except Exception as e:
            logger.warning(f"pip install warning: {e}")

    # 5. Trigger detached restart runner
    trigger_detached_restart(delay=2.5)

    new_info = get_current_git_info()
    return {
        "success": True,
        "status": "restarting",
        "previous_commit": info["current_commit"],
        "new_commit": new_info["current_commit"],
        "updated_deps": updated_deps,
        "message": "Cheat Clip PRO has been updated successfully. Server is restarting in background..."
    }

@app.post("/api/system/restart")
async def api_restart_app():
    """Triggers an immediate background restart without pulling code."""
    trigger_detached_restart(delay=2.5)
    return {
        "success": True,
        "status": "restarting",
        "message": "Cheat Clip PRO is restarting..."
    }



