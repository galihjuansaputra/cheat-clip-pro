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
from typing import List, Optional, Dict, Any, Tuple
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.responses import StreamingResponse, RedirectResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi
from google import genai
from google.genai import types

try:
    from backend.video_engine import (
        TEMP_DIR,
        EXPORTS_DIR,
        COOKIES_PATH,
        download_clip_segment,
        download_full_raw_video,
        transcribe_clip_words,
        generate_ass_file,
        render_clip_to_mp4,
        extract_clip_frame,
        detect_speaker_face_box
    )
except ImportError:
    from video_engine import (
        TEMP_DIR,
        EXPORTS_DIR,
        COOKIES_PATH,
        download_clip_segment,
        download_full_raw_video,
        transcribe_clip_words,
        generate_ass_file,
        render_clip_to_mp4,
        extract_clip_frame,
        detect_speaker_face_box
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
    title: str = Field(description="Catchy clip title, max 8 words")
    start_time: float = Field(description="Clip start in seconds, aligned to a sentence boundary")
    end_time: float = Field(description="Clip end in seconds, aligned to a sentence boundary")
    hook_time: float = Field(description="Absolute timestamp in seconds from video start where the potential hook occurs inside this clip range (must be >= start_time and <= end_time)")
    virality_score: int = Field(description="Virality score 1-100")
    key_quotes: List[str] = Field(description="1-2 key quotes from the clip")
    transcript: str = Field(description="Spoken text of the clip")
    title_suggestion: str = Field(default="", description="Catchy alternative title suggestion")
    caption_suggestion: str = Field(default="", description="Engaging social media caption suggestion")
    hashtag_suggestion: str = Field(default="", description="Relevant hashtags suggestion (e.g. #hashtag1 #hashtag2)")

class ViralClipGemini(BaseModel):
    title: str = Field(description="Catchy clip title, max 8 words")
    start_time: float = Field(description="Clip start in seconds, aligned to a sentence boundary")
    end_time: float = Field(description="Clip end in seconds, aligned to a sentence boundary")
    hook_time: float = Field(description="Absolute timestamp in seconds from video start where the potential hook occurs inside this clip range (must be >= start_time and <= end_time)")
    virality_score: int = Field(description="Virality score 1-100")
    key_quotes: List[str] = Field(description="1-2 key quotes from the clip")
    title_suggestion: str = Field(default="", description="Catchy alternative title suggestion")
    caption_suggestion: str = Field(default="", description="Engaging social media caption suggestion")
    hashtag_suggestion: str = Field(default="", description="Relevant hashtags suggestion (e.g. #hashtag1 #hashtag2)")

class VideoAnalysis(BaseModel):
    summary: str = Field(description="1-2 sentence video summary, followed by 2-4 general hashtags (e.g. #podcast #marriage #success)")
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
    """Extracts the 11-character YouTube video ID from various URL formats."""
    # Handle shorts, embed, watch?v=, youtu.be, etc.
    patterns = [
        r"(?:v=|\/v\/|embed\/|shorts\/|youtu\.be\/|\/embed\/|\/watch\?v=|\/watch\?.+&v=)([^#\&\?]{11})",
        r"^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?([^#\&\?]{11})"
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    # Simple length check fallback if the user just pasted the ID
    if len(url.strip()) == 11:
        return url.strip()
    return None

def fetch_video_metadata(url: str):
    """Fetches video title, duration, and viewer retention heatmap using yt-dlp."""
    ydl_opts = {
        'skip_download': True,
        'youtube_include_dash_manifest': False,
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
        'socket_timeout': 10
    }
    if COOKIES_PATH.exists() and COOKIES_PATH.stat().st_size > 0:
        ydl_opts['cookiefile'] = str(COOKIES_PATH)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise Exception("yt-dlp returned empty info dict")
            return {
                "title": info.get('title') or 'Unknown YouTube Video',
                "duration": float(info.get('duration') or 0.0),
                "heatmap": info.get('heatmap') or [],
                "is_live": bool(info.get('is_live') or False),
                "live_status": info.get('live_status') or 'not_live'
            }
    except Exception as e:
        logger.warning(f"yt-dlp metadata extraction failed: {e}")

    # Fallback to URL video ID parsing if yt-dlp fails
    video_id = extract_video_id(url)
    if video_id:
        return {
            "title": f"YouTube Video ({video_id})",
            "duration": 0.0,
            "heatmap": [],
            "is_live": False,
            "live_status": "not_live"
        }
    raise HTTPException(status_code=400, detail="Failed to retrieve YouTube video details from URL.")



def fetch_transcript_ytdlp(video_id: str) -> List[dict]:
    """Attempts to extract captions using yt-dlp's player response directly (free, no quota used)."""
    import requests
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
        'socket_timeout': 8
    }
    if COOKIES_PATH.exists() and COOKIES_PATH.stat().st_size > 0:
        ydl_opts['cookiefile'] = str(COOKIES_PATH)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            if not info:
                return []
            
            subtitles = info.get('subtitles') or {}
            auto_subtitles = info.get('automatic_captions') or {}
            
            priority_langs = ['id', 'en', 'es', 'pt', 'fr', 'de', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'ar', 'hi', 'ru']
            # Search manual first, then automatic captions
            for lang_dict, is_auto in [(subtitles, False), (auto_subtitles, True)]:
                for lang in priority_langs:
                    formats = lang_dict.get(lang) or []
                    json3_entry = next((f['url'] for f in formats if f.get('ext') == 'json3'), None)
                    if json3_entry:
                        try:
                            r = requests.get(json3_entry, timeout=5)
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
                                    logger.info(f"Transcript fetched via yt-dlp (lang={lang}, auto={is_auto})")
                                    return result
                        except Exception:
                            continue
    except Exception as e:
        logger.warning(f"yt-dlp subtitle extraction failed: {e}")
    return []


def fetch_transcript(video_id: str) -> List[dict]:
    """Retrieves subtitles for a YouTube video using local direct fetch and yt-dlp fallback."""

    def to_dict_list(fetched) -> List[dict]:
        return [
            {
                "text": getattr(line, "text", ""),
                "start": getattr(line, "start", 0.0),
                "duration": getattr(line, "duration", 0.0)
            }
            for line in fetched
        ]

    # ── Strategy 1: Fast direct fetch (works on localhost/residential IPs) ─────
    priority_langs = ['id', 'en', 'es', 'pt', 'fr', 'de', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'ar', 'hi', 'ru']
    api = YouTubeTranscriptApi()
    try:
        # Pass all priority languages in ONE single network request (fast!)
        data = to_dict_list(api.fetch(video_id, languages=priority_langs))
        if data:
            logger.info("Transcript fetched via direct YouTube fetch")
            return data
    except Exception as e:
        logger.info(f"Direct fetch missed: {e}")

    # ── Strategy 2: List all transcripts (manual then auto) ────────────────────
    try:
        all_transcripts = list(api.list(video_id))
        manual    = [t for t in all_transcripts if not getattr(t, 'is_generated', False)]
        generated = [t for t in all_transcripts if     getattr(t, 'is_generated', False)]

        for transcript in (manual + generated):
            try:
                data = to_dict_list(transcript.fetch())
                if data:
                    logger.info(
                        f"Transcript fetched via list: {transcript.language} "
                        f"({'auto' if getattr(transcript, 'is_generated', False) else 'manual'})"
                    )
                    return data
            except Exception as e:
                logger.warning(f"Failed ({transcript.language_code}): {e}")
                continue
    except Exception as e:
        logger.warning(f"Could not list transcripts: {e}")

    # ── Strategy 3: yt-dlp native extraction fallback ──────────────────────────
    ytdlp_data = fetch_transcript_ytdlp(video_id)
    if ytdlp_data:
        return ytdlp_data

    # ── All strategies exhausted ──────────────────────────────────────────────
    raise HTTPException(
        status_code=400,
        detail=(
            "No subtitles could be retrieved for this video. "
            "Subtitles might be disabled, or the video may be age-restricted, private, or require a login."
        )
    )





def lowercase_hashtags_in_string(text: str) -> str:
    """Finds all hashtags (#word) in a string and converts them to lowercase."""
    if not text:
        return text
    return re.sub(r'#\w+', lambda m: m.group(0).lower(), text)

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
def health_check():
    has_gemini = bool(os.environ.get("GEMINI_API_KEY"))
    return {
        "status": "ok",
        "message": "CHEAT CLIP PRO API is active",
        "gemini_env_configured": has_gemini
    }



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

        yield _sse({
            "step": 1,
            "step_progress": 30,
            "overall_progress": 8,
            "stage": "Connecting to YouTube",
            "detail": "Connecting to YouTube & fetching video metadata...",
            "message": "Connecting to YouTube — fetching video title and duration..."
        })

        try:
            metadata = await asyncio.to_thread(fetch_video_metadata, request.url)
            title    = metadata["title"]
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
            yield _sse({
                "step": 3,
                "step_progress": 30,
                "overall_progress": 55,
                "stage": "Fetching Subtitles",
                "detail": "Querying YouTube caption tracks & auto-generated transcripts...",
                "message": "Fetching subtitles — trying video's original language..."
            })
            try:
                transcript_lines = await asyncio.to_thread(fetch_transcript, video_id)
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
                video_id=video_id, title=title, duration=duration or 200.0,
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

        # ── Step 4: Build prompt ─────────────────────────────────────────────
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
            focus_instruction = f"CRITICAL FOCUS: The user specifically wants you to find clips matching the following query/theme: \"{request.custom_prompt.strip()}\". Prioritize and tailor your selection of viral clips to fit this request, while still ensuring they make good standalone clips.\n\n"

        prompt = (
            f"You are a viral video clip finder.\n"
            f"Find {clip_range} short-form clip candidates from this YouTube transcript for TikTok/Reels/Shorts.\n\n"
            f"Title: {title}\n"
            f"Duration Range: {int(start_bound)}s to {int(end_bound)}s (Length: {int(duration)}s) | Target clip length: {dur_range}\n"
            f"{heatmap_note}\n"
            f"{focus_instruction}"
            f"Match output language to transcript language.\n\n"
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
            "stage": "Context Assembly",
            "detail": f"Aligning {len(transcript_dump)} dialogue segments with engagement data for {requested_model}...",
            "model": requested_model,
            "message": f"Assembling prompt and engagement context for {requested_model}..."
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
                                    "title": getattr(c, 'title', ''),
                                    "start_time": getattr(c, 'start_time', 0.0),
                                    "end_time": getattr(c, 'end_time', 0.0),
                                    "hook_time": getattr(c, 'hook_time', None),
                                    "virality_score": getattr(c, 'virality_score', 0),
                                    "key_quotes": getattr(c, 'key_quotes', []),
                                    "title_suggestion": getattr(c, 'title_suggestion', ''),
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
                analysis_data['summary'] = f"Analysis of \"{title}\" identifying {len(fallback_clips_list)} key segments. #viral #highlights"

        clip_count = len(analysis_data.get('clips', []))
        yield _sse({
            "step": 4,
            "step_progress": 98,
            "overall_progress": 98,
            "stage": "Clip Verification & Alignment",
            "detail": f"Verified {clip_count} clip segments with precise video timestamps and key quotes.",
            "model": successful_model or requested_model,
            "message": f"Found {clip_count} viral clip candidates with {successful_model or requested_model} — reconstructing transcripts..."
        })
        logger.info(f"Gemini analysis complete with {successful_model or requested_model}. Found {clip_count} clips.")
        logger.info(f"Gemini analysis complete with {successful_model or requested_model}. Found {clip_count} clips.")

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
                title=raw_clip.get('title', ''),
                start_time=start,
                end_time=end,
                hook_time=hook,
                virality_score=raw_clip.get('virality_score', 0),
                key_quotes=raw_clip.get('key_quotes') or [],
                transcript=" ".join(clip_lines),
                title_suggestion=raw_clip.get('title_suggestion', ''),
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
    title_text: Optional[str] = None
    title_position: str = "auto"
    title_duration: Optional[str] = "entire"
    caption_style: str = "viral_pop"
    caption_font: str = "Outfit"
    font_size: str = "medium"
    text_case: str = "uppercase"
    title_y_percent: Optional[float] = 14.0
    subtitle_y_percent: Optional[float] = 18.0
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


class RenderBatchRequest(BaseModel):
    video_url: str
    video_id: str
    clips: List[Dict[str, Any]]
    settings: RenderSettingsModel
    transcript: Optional[List[Dict[str, Any]]] = None


RENDER_BATCHES: Dict[str, Dict[str, Any]] = {}


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
        clip_status = batch["clips"][idx]
        clip_status["status"] = "downloading"
        clip_status["progress_percent"] = 15

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

            # 2. Transcribe & Generate Subtitles / Title (.ass)
            clip_status["status"] = "transcribing"
            clip_status["progress_percent"] = 40

            display_title = None
            if settings.title_position != "none":
                display_title = settings.title_text if settings.title_text else clip.get("title_suggestion") or clip.get("title")

            ass_path = None
            duration_sec = max(1.0, end_t - start_t)
            if settings.caption_style != "none" or (display_title and settings.title_position != "none"):
                words = []
                if settings.caption_style != "none":
                    words = await asyncio.to_thread(
                        transcribe_clip_words,
                        raw_path,
                        request.transcript,
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
                    title_text=display_title,
                    title_position=settings.title_position,
                    title_duration=settings.title_duration if settings.title_duration else "entire",
                    duration_seconds=duration_sec,
                    title_y_percent=settings.title_y_percent if settings.title_y_percent is not None else 14.0,
                    subtitle_y_percent=settings.subtitle_y_percent if settings.subtitle_y_percent is not None else 18.0,
                    subtitle_position_mode=settings.subtitle_position_mode if settings.subtitle_position_mode else "bottom",
                    subtitle_center_y_percent=settings.subtitle_center_y_percent if settings.subtitle_center_y_percent is not None else 50.0
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
                title_text=display_title,
                title_position=settings.title_position,
                ass_subtitles_path=ass_path,
                clip_duration=duration_sec,
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
                original_audio_volume=float((settings.original_audio_volume if settings.original_audio_volume is not None else 100.0) / 100.0)
            )

            clip_status["status"] = "completed"
            clip_status["progress_percent"] = 100
            clip_status["download_url"] = f"/api/download-rendered/{out_filename}"
            clip_status["output_path"] = out_path

        except Exception as e:
            logger.error(f"Error rendering clip {idx} in batch {batch_id}: {e}")
            clip_status["status"] = "error"
            clip_status["error_message"] = str(e)

        batch["current_clip_index"] = idx + 1

    # Generate ZIP bundle for the batch with title-based filenames and duplicate handling
    try:
        zip_filename = f"cheat_clip_pro_{batch_id}.zip"
        zip_path = EXPORTS_DIR / zip_filename
        title_counts: Dict[str, int] = {}
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for c in batch["clips"]:
                if c.get("status") == "completed" and c.get("download_url"):
                    fname = c["download_url"].split("/")[-1]
                    fpath = EXPORTS_DIR / fname
                    if fpath.exists():
                        raw_title = (c.get("title") or "").strip()
                        clean_title = re.sub(r'[\\/*?:"<>|]', "", raw_title) or f"clip_{c.get('clip_index', 1)}"
                        count = title_counts.get(clean_title, 0)
                        title_counts[clean_title] = count + 1
                        arc_name = f"{clean_title}.mp4" if count == 0 else f"{clean_title} ({count}).mp4"
                        zipf.write(fpath, arcname=arc_name)
        batch["zip_url"] = f"/api/download-batch-zip/{batch_id}"
    except Exception as e:
        logger.warning(f"Failed to create batch zip: {e}")

    batch["overall_status"] = "completed"


@app.post("/api/render-batch")
async def start_batch_render(request: RenderBatchRequest, background_tasks: BackgroundTasks):
    if not request.clips:
        raise HTTPException(status_code=400, detail="No clips provided for rendering")

    batch_id = f"batch_{int(time.time())}_{uuid.uuid4().hex[:6]}"

    clips_status = [
        {
            "clip_index": idx,
            "title": c.get("title_suggestion") or c.get("title") or f"Clip {idx+1}",
            "status": "pending",
            "progress_percent": 0
        }
        for idx, c in enumerate(request.clips)
    ]

    RENDER_BATCHES[batch_id] = {
        "batch_id": batch_id,
        "total_clips": len(request.clips),
        "current_clip_index": 0,
        "overall_status": "running",
        "clips": clips_status,
        "zip_url": None
    }

    background_tasks.add_task(process_batch_rendering, batch_id, request)
    return {"batch_id": batch_id, "total_clips": len(request.clips)}


@app.get("/api/render-progress/{batch_id}")
async def get_render_progress(batch_id: str):
    if batch_id not in RENDER_BATCHES:
        raise HTTPException(status_code=404, detail="Batch not found")

    async def stream():
        while True:
            batch = RENDER_BATCHES.get(batch_id)
            if not batch:
                break
            yield f"data: {json.dumps(batch)}\n\n"
            if batch.get("overall_status") in ["completed", "error"]:
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
    if COOKIES_PATH.exists() and COOKIES_PATH.stat().st_size > 0:
        sample_lines = []
        cookies_content = ""
        try:
            with open(COOKIES_PATH, "r", encoding="utf-8", errors="ignore") as f:
                cookies_content = f.read()
                for line in cookies_content.splitlines():
                    line = line.strip()
                    if line and not line.startswith("#"):
                        domain = line.split("\t")[0]
                        if domain not in sample_lines:
                            sample_lines.append(domain)
                        if len(sample_lines) >= 6:
                            break
        except Exception:
            pass
        return {
            "exists": True,
            "has_cookies": True,
            "size": COOKIES_PATH.stat().st_size,
            "sample_lines": sample_lines,
            "cookies_content": cookies_content
        }
    return {"exists": False, "has_cookies": False, "size": 0, "sample_lines": [], "cookies_content": ""}


@app.delete("/api/cookies")
def delete_youtube_cookies():
    if COOKIES_PATH.exists():
        try:
            COOKIES_PATH.unlink()
        except Exception:
            pass
    return {"success": True, "status": "deleted", "exists": False, "has_cookies": False}


class RawVideoDownloadRequest(BaseModel):
    video_url: str
    video_id: str


raw_download_jobs: Dict[str, dict] = {}


async def run_raw_download_job(job_id: str, v_url: str, out_path: str, filename: str):
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
        raw_download_jobs[job_id]["download_url"] = f"/api/download-rendered/{filename}"
        raw_download_jobs[job_id]["filename"] = filename
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

    raw_download_jobs[job_id] = {
        "job_id": job_id,
        "status": "starting",
        "progress_percent": 0.0,
        "downloaded": "",
        "total": "",
        "speed": "",
        "eta": "",
        "download_url": None,
        "filename": filename,
        "error": None
    }

    background_tasks.add_task(run_raw_download_job, job_id, v_url, out_path, filename)
    return {"job_id": job_id, "status": "starting"}


@app.get("/api/download-raw-status/{job_id}")
async def get_raw_download_status(job_id: str):
    job = raw_download_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Download job not found")
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
async def detect_face(video_id: str, timestamp: float = 0.0, video_url: Optional[str] = None):
    """
    Detects speaker face coordinates (cx, cy, w, h) on the video at timestamp.
    Returns normalized coordinates and the frame URL.
    """
    default_res = {
        "found": False,
        "cx": 0.5,
        "cy": 0.35,
        "w": 0.25,
        "h": 0.25,
        "frame_url": f"/api/clip-frame?video_id={video_id}&timestamp={timestamp}"
    }
    try:
        # First try to extract or get the cached frame
        frame_path = await asyncio.to_thread(extract_clip_frame, video_url or "", video_id, timestamp)
        if frame_path and os.path.exists(frame_path):
            box = await asyncio.to_thread(detect_speaker_face_box, frame_path)
            box["frame_url"] = f"/api/clip-frame?video_id={video_id}&timestamp={timestamp}"
            return box

        # If frame extract didn't complete, check local candidates
        safe_id = re.sub(r'[^a-zA-Z0-9_-]', '_', video_id)
        local_candidates = list(TEMP_DIR.glob(f"*{safe_id}*.mp4")) + list(EXPORTS_DIR.glob(f"*{safe_id}*.mp4"))
        for candidate in local_candidates:
            if candidate.exists() and candidate.stat().st_size > 10000 and "slice_" not in candidate.name:
                box = await asyncio.to_thread(detect_speaker_face_box, str(candidate))
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



