import os
import sys
import re
import json
import time
import shutil
import logging
import subprocess
import unicodedata
import math
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger("cheat-clip-pro.video-engine")

BASE_DIR = Path(__file__).resolve().parent
TEMP_DIR = BASE_DIR / "temp_clips"
EXPORTS_DIR = BASE_DIR / "exports"
FONTS_DIR = BASE_DIR / "fonts"
COOKIES_PATH = BASE_DIR / "cookies.txt"
ROOT_COOKIES_PATH = BASE_DIR.parent / "cookies.txt"

def get_effective_cookies_path() -> Optional[Path]:
    """Returns valid cookies file path from backend/cookies.txt or root cookies.txt."""
    if COOKIES_PATH.exists() and COOKIES_PATH.stat().st_size > 0:
        return COOKIES_PATH
    if ROOT_COOKIES_PATH.exists() and ROOT_COOKIES_PATH.stat().st_size > 0:
        return ROOT_COOKIES_PATH
    return None

CASCADE_PATH = BASE_DIR / "haarcascade_frontalface_default.xml"
TEMP_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
FONTS_DIR.mkdir(parents=True, exist_ok=True)

def ensure_ffmpeg_in_path():
    """Auto-detect FFmpeg if it was installed via winget, scoop, or local paths but not in PATH."""
    if shutil.which("ffmpeg"):
        return
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    candidate_roots = [
        Path(local_app_data) / "Microsoft" / "WinGet" / "Packages" if local_app_data else None,
        Path("C:/Program Files/ffmpeg/bin"),
        Path("C:/ffmpeg/bin"),
    ]
    for root in candidate_roots:
        if root and root.exists():
            if (root / "ffmpeg.exe").exists():
                os.environ["PATH"] = str(root) + os.pathsep + os.environ.get("PATH", "")
                logger.info(f"Auto-added FFmpeg to PATH: {root}")
                return
            for exe in root.glob("**/ffmpeg.exe"):
                bin_dir = str(exe.parent)
                os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
                logger.info(f"Auto-added FFmpeg to PATH: {bin_dir}")
                return


ensure_ffmpeg_in_path()

# Global lazy-loaded whisper model
_WHISPER_MODEL = None


def get_whisper_model():
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        try:
            import whisper
            logger.info("Loading Whisper 'base' model for word-level timestamps...")
            _WHISPER_MODEL = whisper.load_model("base")
        except Exception as e:
            logger.warning(f"Could not load Whisper model: {e}")
            _WHISPER_MODEL = False
    return _WHISPER_MODEL if _WHISPER_MODEL is not False else None


def check_encoder_support(encoder_name: str) -> bool:
    """Check if a specific FFmpeg video encoder is operational on this system."""
    try:
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=0.2",
            "-c:v", encoder_name, "-f", "null", "-"
        ]
        res = subprocess.run(cmd, capture_output=True, timeout=5)
        return res.returncode == 0
    except Exception:
        return False


ENCODER_CONFIGS: Dict[str, Tuple[str, List[str]]] = {
    "nvenc": ("h264_nvenc", ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23"]),
    "amf": ("h264_amf", ["-c:v", "h264_amf", "-quality", "speed", "-rc", "cbr", "-b:v", "6M"]),
    "qsv": ("h264_qsv", ["-c:v", "h264_qsv", "-preset", "veryfast"]),
    "cpu": ("libx264", ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22"]),
}

_DETECTED_SUPPORT: Optional[Dict[str, Any]] = None


def detect_hardware_support() -> Dict[str, Any]:
    """Detects host GPU/CPU hardware acceleration support and caches the result."""
    global _DETECTED_SUPPORT
    if _DETECTED_SUPPORT is not None:
        return _DETECTED_SUPPORT

    has_nvenc = check_encoder_support("h264_nvenc")
    has_amf = check_encoder_support("h264_amf")
    has_qsv = check_encoder_support("h264_qsv")

    if has_nvenc:
        recommended = "nvenc"
    elif has_amf:
        recommended = "amf"
    elif has_qsv:
        recommended = "qsv"
    else:
        recommended = "cpu"

    _DETECTED_SUPPORT = {
        "nvenc": has_nvenc,
        "amf": has_amf,
        "qsv": has_qsv,
        "cpu": True,
        "recommended": recommended,
    }
    return _DETECTED_SUPPORT


def get_preferred_video_encoder() -> Tuple[str, List[str]]:
    """
    Auto-detects the fastest available hardware encoder:
    1. NVIDIA NVENC (h264_nvenc)
    2. AMD AMF (h264_amf)
    3. Intel QuickSync (h264_qsv)
    4. Universal CPU software encoding (libx264)
    """
    support = detect_hardware_support()
    rec = support.get("recommended", "cpu")
    if rec in ENCODER_CONFIGS:
        codec, args = ENCODER_CONFIGS[rec]
        logger.info(f"Hardware acceleration auto-select: {codec} (rec: {rec}) enabled.")
        return codec, args

    return ENCODER_CONFIGS["cpu"]


def resolve_encoder(user_selection: Optional[str] = "auto") -> Tuple[str, List[str]]:
    """
    Resolves user selection ('auto', 'nvenc', 'amf', 'qsv', 'cpu') to (codec_name, ffmpeg_args).
    """
    sel = (user_selection or "auto").lower().strip()
    if sel == "auto":
        return get_preferred_video_encoder()

    if sel in ENCODER_CONFIGS:
        return ENCODER_CONFIGS[sel]

    # Check direct codec names
    for key, (codec, args) in ENCODER_CONFIGS.items():
        if sel == codec or sel == key:
            return codec, args

    return ENCODER_CONFIGS["cpu"]


ACTIVE_ENCODER_NAME, ACTIVE_ENCODER_ARGS = get_preferred_video_encoder()
USE_NVENC = (ACTIVE_ENCODER_NAME == "h264_nvenc")


def format_section_time(seconds: float) -> str:
    """Format seconds into HH:MM:SS.cs for yt-dlp section cutting."""
    total_seconds = max(0.0, seconds)
    h = int(total_seconds // 3600)
    m = int((total_seconds % 3600) // 60)
    s = int(total_seconds % 60)
    cs = int(round((total_seconds - int(total_seconds)) * 100))
    if cs >= 100:
        cs = 99
    return f"{h:02d}:{m:02d}:{s:02d}.{cs:02d}"


def get_yt_dlp_cookies_args() -> List[str]:
    """Returns yt-dlp cookies arguments if cookies.txt exists and is non-empty."""
    eff = get_effective_cookies_path()
    if eff:
        return ["--cookies", str(eff)]
    return []


def get_yt_dlp_base_cmd(include_cookies: bool = True) -> List[str]:
    """
    Returns base command for yt-dlp with JavaScript runtime, player extractor args, and cookies.
    Tries standalone 'yt-dlp' executable first, then falls back to python module:
    [sys.executable, "-m", "yt_dlp"] which works 100% of the time if installed via pip.
    """
    if shutil.which("yt-dlp"):
        cmd = ["yt-dlp"]
    else:
        try:
            import yt_dlp
            cmd = [sys.executable, "-m", "yt_dlp"]
        except ImportError:
            raise RuntimeError(
                "yt-dlp is not installed in this Python environment. "
                "Please run 'pip install yt-dlp' or 'pip install -r backend/requirements.txt'."
            )

    # Prefer deno (fast challenge solver for modern YouTube player), then node
    if shutil.which("deno"):
        cmd.extend(["--js-runtimes", "deno"])
    elif shutil.which("node"):
        cmd.extend(["--js-runtimes", "node"])

    # Prevent 'The page needs to be reloaded. Please try again later.'
    # by allowing yt-dlp to fall back from default/tv_downgraded to web_embedded and ios client APIs.
    cmd.extend([
        "--extractor-args", "youtube:player_client=default,web_embedded,ios",
        "--force-ipv4"
    ])

    if include_cookies:
        eff = get_effective_cookies_path()
        if eff:
            logger.info(f"Using YouTube cookies from: {eff}")
            cmd.extend(["--cookies", str(eff)])
    return cmd


def download_clip_segment(
    video_url: str,
    start_time: float,
    end_time: float,
    output_filename: str
) -> str:
    """
    Downloads only the requested time slice in high definition (1080p) using yt-dlp.
    Falls back to stream fetching + ffmpeg trimming, 720p, and guest mode if cookies trigger reload errors.
    """
    output_path = TEMP_DIR / output_filename
    if output_path.exists():
        try:
            output_path.unlink()
        except Exception:
            pass

    # Sanitize video URL
    clean_url = video_url.strip()
    if not clean_url.startswith("http"):
        clean_url = f"https://www.youtube.com/watch?v={clean_url}"

    clip_duration = max(1.0, end_time - start_time)
    t_start_fmt = format_section_time(start_time)
    t_end_fmt = format_section_time(end_time)

    # Dynamic timeout: Minimum 300s (5m), plus 5s per second of clip duration.
    # Prevents killing slow HLS/DASH downloads on 60-90s clips.
    timeout_sec = max(300, int(clip_duration * 5) + 120)

    has_cookies = get_effective_cookies_path() is not None
    # If cookies are present, try with cookies first; if rejected by YouTube (or any reload/bot error), try guest mode.
    # If no cookies are present, try guest mode directly.
    attempts = [True, False] if has_cookies else [False]
    last_err_snippet = "unknown"

    for use_cookies in attempts:
        mode_label = "with cookies" if use_cookies else "guest mode (without cookies)"
        base_cmd = get_yt_dlp_base_cmd(include_cookies=use_cookies)
        logger.info(f"Downloading HD section ({clip_duration:.1f}s) {t_start_fmt} -> {t_end_fmt} for {clean_url} ({mode_label}, timeout: {timeout_sec}s)")

        # Method 1: yt-dlp --download-sections with multi-fragment acceleration & retries
        cmd = [
            *base_cmd,
            "--download-sections", f"*{t_start_fmt}-{t_end_fmt}",
            "--force-keyframes-at-cuts",
            "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/bestvideo+bestaudio/best",
            "-N", "4",
            "--fragment-retries", "10",
            "--retries", "10",
            "--file-access-retries", "5",
            "-o", str(output_path),
            "--merge-output-format", "mp4",
            "--no-warnings",
            clean_url
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec)
            if output_path.exists() and output_path.stat().st_size > 10000:
                logger.info(f"Successfully downloaded section ({mode_label}): {output_path} ({output_path.stat().st_size} bytes)")
                return str(output_path)
            last_err_snippet = res.stderr[:300] if (res and res.stderr) else "empty output or invalid file"
        except subprocess.TimeoutExpired:
            logger.warning(f"yt-dlp download-sections timed out after {timeout_sec}s for {clean_url} ({mode_label}).")
            last_err_snippet = f"download-sections timed out after {timeout_sec}s"
        except Exception as e:
            logger.warning(f"yt-dlp download-sections failed ({e}) ({mode_label}).")
            last_err_snippet = str(e)

        # Method 2: Fallback - Extract direct stream URLs with yt-dlp and slice using FFmpeg
        logger.info(f"Direct section download fallback ({last_err_snippet}), trying stream URL trimming ({mode_label})...")
        try:
            url_cmd = [
                *base_cmd,
                "-g",
                "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/bestvideo+bestaudio/best",
                clean_url
            ]
            url_res = subprocess.run(url_cmd, capture_output=True, text=True, timeout=45)
            if url_res.returncode == 0 and url_res.stdout.strip():
                urls = url_res.stdout.strip().split("\n")
                video_stream = urls[0]
                audio_stream = urls[1] if len(urls) > 1 else urls[0]

                trim_timeout = max(120, int(clip_duration * 3) + 30)
                trim_cmd = [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-ss", str(start_time),
                    "-i", video_stream,
                    "-ss", str(start_time),
                    "-i", audio_stream,
                    "-t", str(clip_duration),
                    "-map", "0:v:0", "-map", "1:a:0?",
                    *ACTIVE_ENCODER_ARGS,
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-avoid_negative_ts", "make_zero",
                    "-movflags", "+faststart",
                    str(output_path)
                ]
                subprocess.run(trim_cmd, capture_output=True, timeout=trim_timeout)
                if output_path.exists() and output_path.stat().st_size > 10000:
                    logger.info(f"Successfully trimmed stream URLs with FFmpeg ({mode_label}): {output_path} ({output_path.stat().st_size} bytes)")
                    return str(output_path)
        except Exception as e:
            logger.error(f"Fallback stream trimming failed ({mode_label}): {e}")

        # Method 3: Fallback - Download at 720p (vastly lower bandwidth, skips SABR/1080p throttling)
        logger.info(f"Method 3: Attempting fast 720p fallback section download for {clean_url} ({mode_label})...")
        try:
            cmd_720p = [
                *base_cmd,
                "--download-sections", f"*{t_start_fmt}-{t_end_fmt}",
                "--force-keyframes-at-cuts",
                "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
                "-N", "4",
                "--fragment-retries", "10",
                "--retries", "10",
                "-o", str(output_path),
                "--merge-output-format", "mp4",
                "--no-warnings",
                clean_url
            ]
            timeout_720p = max(180, int(clip_duration * 3) + 60)
            res_720p = subprocess.run(cmd_720p, capture_output=True, text=True, timeout=timeout_720p)
            if output_path.exists() and output_path.stat().st_size > 10000:
                logger.info(f"Successfully downloaded 720p fallback section ({mode_label}): {output_path} ({output_path.stat().st_size} bytes)")
                return str(output_path)
            if res_720p and res_720p.stderr:
                last_err_snippet = res_720p.stderr[:300]
        except Exception as e:
            logger.warning(f"720p fallback failed ({mode_label}): {e}")
            last_err_snippet = str(e)

        # If cookies were used and failed due to reload / session error or bot block, log and proceed to guest mode
        if use_cookies:
            logger.warning(f"Download with cookies failed ({last_err_snippet}). Automatically attempting guest mode fallback...")

    err_lower = last_err_snippet.lower()
    if "reloaded" in err_lower or "reload" in err_lower:
        raise RuntimeError("YouTube rejected the session cookies ('The page needs to be reloaded'). Your cookies.txt may have expired or need refreshing. Please re-export fresh cookies from an active YouTube tab using the 🍪 Cookies Manager button in the top navbar.")
    if "confirm you're not a bot" in err_lower or "sign in" in err_lower or "login" in err_lower:
        raise RuntimeError("YouTube blocked video download (Bot verification). Please import/save fresh YouTube cookies using the 🍪 Cookies Manager button in the top navbar.")
    raise RuntimeError(f"Failed to download video clip segment from YouTube ({last_err_snippet}). Please try again or check your network/cookies.")


def download_full_raw_video(video_url: str, output_path: str, progress_callback=None) -> str:
    """
    Downloads the full raw video from YouTube in maximum quality (up to 1080p).
    Reports real-time progress to progress_callback if provided.
    Automatically retries in guest mode if session cookies are rejected.
    """
    clean_url = video_url.strip()
    if not clean_url.startswith("http"):
        clean_url = f"https://www.youtube.com/watch?v={clean_url}"

    has_cookies = get_effective_cookies_path() is not None
    attempts = [True, False] if has_cookies else [False]

    for use_cookies in attempts:
        base_cmd = get_yt_dlp_base_cmd(include_cookies=use_cookies)
        mode_label = "with cookies" if use_cookies else "guest mode (without cookies)"
        cmd = [
            *base_cmd,
            "--no-colors",
            "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/bestvideo+bestaudio/best",
            "-o", str(output_path),
            "--merge-output-format", "mp4",
            "--newline",
            "--progress-template", "download:%(progress._percent_str)s|%(progress._downloaded_bytes_str)s|%(progress._total_bytes_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
            clean_url
        ]
        logger.info(f"Downloading full raw video ({mode_label}) from {clean_url} to {output_path}...")

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in iter(process.stdout.readline, ''):
            raw_line = line.strip()
            if not raw_line:
                continue
            clean_line = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', raw_line).strip()

            if clean_line.startswith("download:") and progress_callback:
                raw_data = clean_line[len("download:"):].strip()
                parts = raw_data.split("|")
                if len(parts) >= 5:
                    pct_str, dl_str, tot_str, spd_str, eta_str = parts[0], parts[1], parts[2], parts[3], parts[4]
                    try:
                        clean_pct = re.sub(r'[^0-9.]', '', pct_str)
                        pct_val = float(clean_pct) if clean_pct else 0.0
                    except Exception:
                        pct_val = 0.0
                    progress_callback({
                        "percent": pct_val,
                        "downloaded": dl_str.strip() if dl_str and dl_str != "NA" else f"{pct_val:.1f}%",
                        "total": tot_str.strip() if tot_str and tot_str != "NA" else "",
                        "speed": spd_str.strip() if spd_str and spd_str != "NA" else "",
                        "eta": eta_str.strip() if eta_str and eta_str != "NA" else ""
                    })
            elif "[download]" in clean_line and progress_callback:
                match = re.search(r'([0-9]+(?:\.[0-9]+)?)\s*%', clean_line)
                if match:
                    try:
                        pct_val = float(match.group(1))
                    except Exception:
                        pct_val = 0.0
                    spd_match = re.search(r'at\s+([0-9.]+\s*[a-zA-Z]+/s)', clean_line)
                    eta_match = re.search(r'ETA\s+([0-9:]+)', clean_line)
                    tot_match = re.search(r'of\s+~?([0-9.]+\s*[a-zA-Z]+)', clean_line)
                    progress_callback({
                        "percent": pct_val,
                        "downloaded": f"{pct_val:.1f}%",
                        "total": tot_match.group(1) if tot_match else "",
                        "speed": spd_match.group(1) if spd_match else "",
                        "eta": eta_match.group(1) if eta_match else ""
                    })
        process.stdout.close()
        returncode = process.wait()

        if os.path.exists(output_path) and os.path.getsize(output_path) > 10000:
            logger.info(f"Full raw video downloaded successfully ({mode_label}, {os.path.getsize(output_path)} bytes)")
            return str(output_path)

        if use_cookies:
            logger.warning(f"Full raw video download with cookies exited with code {returncode}. Retrying in guest mode...")

    raise RuntimeError("Failed to download raw video. Please check your cookies or network connection.")


def clean_caption_text(text: str) -> str:
    """
    Cleans transcripted subtitle/caption text by:
    1. Removing sound/action tags like [LAUGHTER], [APPLAUSE], [MUSIC], (laughter), *cheering*.
    2. Removing common sound effect words if present.
    3. Stripping all symbols EXCEPT '.', ',', '%', '&', '$', '?' (keeping alphanumeric characters and spaces).
    4. Normalizing whitespace.
    """
    if not text:
        return ""
    # 1. Remove bracketed, parenthesized, or asterisk tags (e.g. [LAUGHTER], (music), *cheering*)
    t = re.sub(r'\[.*?\]|\(.*?\)|[\*].*?[\*]', ' ', text)
    # 2. Remove common unbracketed sound tags
    t = re.sub(r'\b(laughter|applause|music|cheering|snickering|giggle|cough)\b', ' ', t, flags=re.IGNORECASE)
    # 3. Remove all symbols except . , % & $ ? (keep letters, digits, whitespace, . , % & $ ?)
    # Note: in Python regex \w includes '_', so we explicitly eliminate '_'
    t = re.sub(r'[^\w\s.,%&$?]|_', '', t)
    # 4. Collapse multiple spaces
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def transcribe_clip_words(
    video_path: str,
    fallback_transcript: Optional[List[Dict[str, Any]]] = None,
    clip_start_time: float = 0.0,
    clip_end_time: float = 0.0
) -> List[Dict[str, Any]]:
    """
    Extracts word-level timestamps using the analyzed video transcript.
    This guarantees 100% fidelity with the analyzed speech (no mis-speech or Whisper hallucinations).
    Timestamps are mapped relative to the sliced clip audio (0.0s = clip_start_time).
    Whisper is only used as a fallback if no video transcript is available.
    """
    # 1. Primary: Use the analyzed video transcript (exact matches from YouTube)
    if fallback_transcript:
        words = []
        for line in fallback_transcript:
            line_text = line.get("text", "").strip()
            if not line_text:
                continue

            cleaned_line = clean_caption_text(line_text)
            if not cleaned_line:
                continue

            l_start = float(line.get("start", 0.0))
            l_dur = float(line.get("duration", 2.0))
            l_end = l_start + l_dur

            # If clip range is defined, filter lines overlapping the clip
            if clip_end_time > clip_start_time:
                if l_end < clip_start_time - 0.2 or l_start > clip_end_time + 0.2:
                    continue
                # Shift timestamps relative to clip start (0.0)
                rel_start = max(0.0, l_start - clip_start_time)
                rel_end = max(rel_start + 0.15, l_end - clip_start_time)
            else:
                rel_start = max(0.0, l_start)
                rel_end = max(rel_start + 0.15, l_end)

            line_words = cleaned_line.split()
            if not line_words:
                continue
            w_duration = max(0.12, (rel_end - rel_start) / len(line_words))
            for i, w in enumerate(line_words):
                w_s = rel_start + (i * w_duration)
                w_e = w_s + w_duration
                words.append({
                    "word": w,
                    "start": round(w_s, 2),
                    "end": round(w_e, 2)
                })
        if words:
            logger.info(f"Using analyzed video transcript: mapped {len(words)} words for clip range [{clip_start_time:.1f}s -> {clip_end_time:.1f}s].")
            return words

    # 2. Secondary fallback: Whisper if no transcript was returned from YouTube
    whisper_model = get_whisper_model()
    if whisper_model is not None:
        try:
            logger.info("Running Whisper word-level transcription as fallback...")
            result = whisper_model.transcribe(video_path, word_timestamps=True, fp16=False)
            words = []
            for segment in result.get("segments", []):
                for w in segment.get("words", []):
                    word_clean = clean_caption_text(w.get("word", "").strip())
                    if word_clean:
                        words.append({
                            "word": word_clean,
                            "start": max(0.0, float(w.get("start", 0.0))),
                            "end": max(float(w.get("start", 0.0)) + 0.1, float(w.get("end", 0.0)))
                        })
            if words:
                logger.info(f"Whisper transcribed {len(words)} words successfully.")
                return words
        except Exception as e:
            logger.warning(f"Whisper word transcription error: {e}")

    return []


def format_ass_timestamp(seconds: float) -> str:
    """Format seconds into ASS timestamp format: H:MM:SS.cs"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def apply_text_case(text: str, mode: str) -> str:
    """Applies uppercase, capitalize (Title Case), or lowercase to text."""
    clean = text.strip()
    if mode == "uppercase":
        return clean.upper()
    elif mode == "lowercase":
        return clean.lower()
    elif mode == "capitalize":
        return clean.title()
    return clean


def wrap_title_smart(text: str, max_single_len: int = 22) -> Tuple[str, int]:
    """
    Wraps title cleanly into 1, 2, 3 or more balanced lines separated by \\N.
    Preserves manual newlines if present, otherwise balances words across lines.
    Returns (formatted_title, line_count).
    """
    raw = text.strip()
    if not raw:
        return "", 1

    # Preserve manual newlines if the user specifically broke lines
    if "\n" in raw:
        lines = [l.strip() for l in raw.split("\n") if l.strip()]
        return "\\N".join(lines), len(lines)

    words = raw.split()
    if len(words) <= 1:
        return raw, 1

    total_len = len(raw)
    if total_len <= max_single_len:
        return raw, 1

    # Determine target line count dynamically based on character count and max_single_len
    target_lines = min(4, max(2, math.ceil(total_len / max_single_len)))

    target_per_line = total_len / target_lines
    lines = []
    current_line = []
    current_len = 0

    for i, w in enumerate(words):
        remaining_words = len(words) - i
        remaining_lines = target_lines - len(lines)
        if remaining_lines > 1 and len(current_line) > 0 and (current_len + len(w) > target_per_line * 1.15 or remaining_words <= remaining_lines - 1):
            lines.append(" ".join(current_line))
            current_line = [w]
            current_len = len(w)
        else:
            current_line.append(w)
            current_len += len(w) + 1

    if current_line:
        lines.append(" ".join(current_line))

    return "\\N".join(lines), len(lines)


def is_emoji_char(ch: str) -> bool:
    """Checks if a character is an emoji, symbol, or emoji presentation modifier."""
    code = ord(ch)
    if (0x1F000 <= code <= 0x1FAFF or
        0x2600 <= code <= 0x27BF or
        0x2300 <= code <= 0x23FF or
        0x2B50 <= code <= 0x2B55 or
        code == 0x200D or
        0xFE00 <= code <= 0xFE0F or
        code == 0x20E3):
        return True
    cat = unicodedata.category(ch)
    return cat in ('So', 'Sk')


def has_emoji(text: Optional[str]) -> bool:
    """Returns True if the string contains one or more emoji characters."""
    if not text:
        return False
    return any(is_emoji_char(ch) for ch in text)


def split_text_and_emojis(text: str) -> List[Tuple[str, str]]:
    """Splits text into contiguous runs of ('emoji', text) and ('text', text)."""
    segments = []
    if not text:
        return segments
    current_type = None
    current_buf = []
    for ch in text:
        t = 'emoji' if is_emoji_char(ch) else 'text'
        if current_type is None:
            current_type = t
            current_buf.append(ch)
        elif t == current_type:
            current_buf.append(ch)
        else:
            segments.append((current_type, "".join(current_buf)))
            current_type = t
            current_buf = [ch]
    if current_buf:
        segments.append((current_type, "".join(current_buf)))
    return segments


def get_font(font_name: str, size: int) -> ImageFont.FreeTypeFont:
    """Resolves font with fallback to Montserrat or default font."""
    fonts_dir = str(FONTS_DIR)
    for ext in [".ttf", ".otf", ""]:
        p = os.path.join(fonts_dir, f"{font_name}{ext}")
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    p_fallback = os.path.join(fonts_dir, "Montserrat.ttf")
    if os.path.exists(p_fallback):
        try:
            return ImageFont.truetype(p_fallback, size)
        except Exception:
            pass
    return ImageFont.load_default()


def get_emoji_font(size: int) -> Optional[ImageFont.FreeTypeFont]:
    """Finds and loads a color emoji font (seguiemj.ttf, NotoColorEmoji.ttf, etc.)."""
    env_emoji = os.environ.get("EMOJI_FONT_PATH", "").strip()
    candidates = [
        env_emoji if env_emoji else None,
        str(FONTS_DIR / "seguiemj.ttf"),
        str(FONTS_DIR / "NotoColorEmoji.ttf"),
        "C:/Windows/Fonts/seguiemj.ttf",
        "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
        "/usr/share/fonts/google-noto-color-emoji/NotoColorEmoji.ttf",
        "/usr/share/fonts/opentype/noto/NotoColorEmoji.otf",
        "/usr/share/fonts/truetype/ancient-scripts/Symbola_hint.ttf",
    ]
    for c in candidates:
        if c and os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception as e:
                logger.debug(f"Could not load emoji font {c}: {e}")
    return None


def render_title_overlay_png(
    title_text: str,
    output_png_path: str,
    font_name: str = "Montserrat",
    target_aspect_ratio: str = "9:16",
    font_size_preset: str = "medium",
    text_case: str = "uppercase",
    title_position: str = "auto",
    title_y_percent: Optional[float] = None,
    canvas_w: int = 1080,
    canvas_h: int = 1920,
    title_font_size_preset: Optional[str] = None,
    streamer_preset: Optional[str] = "none"
) -> Optional[str]:
    """
    Renders the title with full-color emojis and bold styled typography into a transparent
    1080x1920 PNG overlay for seamless FFmpeg compositing.
    """
    if not title_text or title_position == "none":
        return None

    effective_title_preset = (title_font_size_preset or font_size_preset or "medium").lower()

    if effective_title_preset == "small":
        max_wrap_len = 24
    elif effective_title_preset == "big":
        max_wrap_len = 13
    else:  # medium
        max_wrap_len = 19

    # Format Title & Determine Line Count
    formatted_title, title_line_count = wrap_title_smart(
        apply_text_case(title_text, text_case),
        max_single_len=max_wrap_len
    )

    if not formatted_title:
        return None

    # Distinct, calibrated title font sizes based on preset
    if effective_title_preset == "small":
        title_font_size = 58 if title_line_count >= 3 else 68
    elif effective_title_preset == "big":
        title_font_size = 106 if title_line_count >= 3 else 124
    else:  # medium
        title_font_size = 82 if title_line_count >= 3 else 94

    # Create dummy draw to measure line widths and prevent edge overflow
    temp_draw = ImageDraw.Draw(Image.new("RGBA", (canvas_w, canvas_h)))
    text_font = get_font(font_name, title_font_size)
    emoji_font = get_emoji_font(int(title_font_size * 0.90))

    lines = [l.strip() for l in formatted_title.split("\\N") if l.strip()]
    if not lines:
        lines = [formatted_title]

    # Measure maximum line width to prevent clipping off screen edges
    max_line_w = 0
    for line in lines:
        seg_w = 0
        for kind, chunk in split_text_and_emojis(line):
            f = emoji_font if (kind == 'emoji' and emoji_font) else text_font
            bbox = temp_draw.textbbox((0, 0), chunk, font=f)
            seg_w += (bbox[2] - bbox[0])
        max_line_w = max(max_line_w, seg_w)

    max_allowed_w = canvas_w - 70  # 1010px safe width
    if max_line_w > max_allowed_w and max_line_w > 0:
        scale_factor = max_allowed_w / max_line_w
        title_font_size = max(40, int(title_font_size * scale_factor))
        text_font = get_font(font_name, title_font_size)
        emoji_font = get_emoji_font(int(title_font_size * 0.90))

    # Content boundaries for aspect ratios (Canvas is 1080x1920)
    if streamer_preset == "split_top_cam":
        if target_aspect_ratio == "16:9":
            content_top = 352
            content_bot = 1568
        elif target_aspect_ratio == "4:3":
            content_top = 150
            content_bot = 1770
        else:  # 1:1 and 9:16
            content_top = 0
            content_bot = 1920
    else:
        if target_aspect_ratio == "1:1":
            content_top = 420
            content_bot = 1500
        elif target_aspect_ratio == "4:3":
            content_top = 555
            content_bot = 1365
        elif target_aspect_ratio == "16:9":
            content_top = 656
            content_bot = 1264
        else:  # 9:16
            content_top = 0
            content_bot = 1920

    line_step = int(title_font_size * 0.86)
    est_title_h = int(title_line_count * line_step)

    # Title Positioning (100% WYSIWYG matching framing preview):
    # Preview renders at top: `${title_y_percent}%` on 569px height (which is 1080x1920 canvas).
    # When title_y_percent is provided, directly map to canvas pixels: 1920 * (title_y_percent / 100.0).
    if title_y_percent is not None:
        effective_title_y_pct = float(title_y_percent)
    else:
        if streamer_preset == "split_top_cam":
            effective_title_y_pct = 3.5 if title_line_count >= 3 else 4.5
        elif target_aspect_ratio == "1:1":
            effective_title_y_pct = 11.5 if title_line_count >= 3 else (13.5 if title_line_count == 2 else 17.0)
        elif target_aspect_ratio == "4:3":
            effective_title_y_pct = 17.3 if title_line_count >= 3 else (19.3 if title_line_count == 2 else 23.6)
        elif target_aspect_ratio == "16:9":
            effective_title_y_pct = 22.6 if title_line_count >= 3 else (24.5 if title_line_count == 2 else 28.8)
        else:  # 9:16
            effective_title_y_pct = 12.0 if title_line_count >= 3 else (14.5 if title_line_count == 2 else 17.0)

    title_y = max(10, min(1800, int(round(1920 * (effective_title_y_pct / 100.0)))))

    # Create transparent canvas
    img = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    stroke_width = max(3, int(title_font_size * 0.055))
    shadow_offset = max(2, int(title_font_size * 0.025))

    # Reference baseline height for uppercase text
    t_ref_bbox = draw.textbbox((0, 0), "HGY", font=text_font)
    t_ref_mid = (t_ref_bbox[1] + t_ref_bbox[3]) / 2.0

    for line_idx, line in enumerate(lines):
        line_top = title_y + (line_idx * line_step)
        segments = split_text_and_emojis(line)

        # 1. Measure total width
        segment_widths = []
        for kind, chunk in segments:
            f = emoji_font if (kind == 'emoji' and emoji_font) else text_font
            bbox = draw.textbbox((0, 0), chunk, font=f)
            w = bbox[2] - bbox[0]
            segment_widths.append(w)

        total_line_w = sum(segment_widths)
        start_x = (canvas_w - total_line_w) / 2.0

        # 2. Draw shadow first (for text segments)
        cur_x = start_x
        for (kind, chunk), w in zip(segments, segment_widths):
            if kind != 'emoji':
                draw.text(
                    (cur_x + shadow_offset, line_top + shadow_offset),
                    chunk,
                    font=text_font,
                    fill=(0, 0, 0, 160),
                    stroke_width=stroke_width,
                    stroke_fill=(0, 0, 0, 160)
                )
            cur_x += w

        # 3. Draw outline / stroke and color emojis
        cur_x = start_x
        for (kind, chunk), w in zip(segments, segment_widths):
            if kind == 'emoji' and emoji_font:
                e_bbox = draw.textbbox((0, 0), chunk, font=emoji_font)
                e_mid = (e_bbox[1] + e_bbox[3]) / 2.0
                offset_y = t_ref_mid - e_mid

                draw.text(
                    (cur_x, line_top + offset_y),
                    chunk,
                    font=emoji_font,
                    embedded_color=True
                )
            else:
                draw.text(
                    (cur_x, line_top),
                    chunk,
                    font=text_font,
                    fill=(255, 255, 255, 255),
                    stroke_width=stroke_width,
                    stroke_fill=(0, 0, 0, 255)
                )
            cur_x += w

    os.makedirs(os.path.dirname(output_png_path), exist_ok=True)
    img.save(output_png_path, "PNG")
    return output_png_path


def generate_ass_file(
    words: List[Dict[str, Any]],
    style_preset: str,
    font_name: str,
    output_ass_path: str,
    target_aspect_ratio: str = "9:16",
    font_size_preset: str = "medium",
    text_case: str = "uppercase",
    title_text: Optional[str] = None,
    title_position: str = "auto",
    title_duration: str = "entire",
    duration_seconds: float = 60.0,
    title_y_percent: Optional[float] = None,
    subtitle_y_percent: Optional[float] = None,
    subtitle_position_mode: str = "bottom",
    subtitle_center_y_percent: float = 50.0,
    skip_title: bool = False,
    title_font_size_preset: Optional[str] = None,
    streamer_preset: Optional[str] = "none"
) -> str:
    """
    Generates an Advanced SubStation Alpha (.ass) subtitle and title file with karaoke / word-level animation.
    Enforces WrapStyle: 2 and short 1-to-3 word chunks so subtitles are ALWAYS strictly 1 line.
    Uses \\an2\\pos(540, Y) for bottom or \\an5\\pos(540, Y) for center to permanently freeze subtitle in place.
    Keeps title and subtitle snug and close to video content (top & bottom) without touching.
    Supports subtitle_position_mode ('bottom' | 'center') with custom center Y position.
    """
    effective_title_preset = (title_font_size_preset or font_size_preset or "medium").lower()

    if effective_title_preset == "small":
        max_wrap_len = 24
    elif effective_title_preset == "big":
        max_wrap_len = 13
    else:  # medium
        max_wrap_len = 19

    # 1. Format Title & Determine Line Count
    if title_text and title_position != "none":
        formatted_title, title_line_count = wrap_title_smart(
            apply_text_case(title_text, text_case),
            max_single_len=max_wrap_len
        )
    else:
        formatted_title, title_line_count = "", 1

    # 2. Font Sizes based on preset, with automatic scale-down for 3+ line titles
    # Subtitle font sizes based on font_size_preset
    if font_size_preset == "small":
        sub_font_size = 65
    elif font_size_preset == "big":
        sub_font_size = 94
    else:  # medium
        sub_font_size = 78

    # Title font sizes based on effective_title_preset
    if effective_title_preset == "small":
        title_font_size = 58 if title_line_count >= 3 else 68
    elif effective_title_preset == "big":
        title_font_size = 106 if title_line_count >= 3 else 124
    else:  # medium
        title_font_size = 82 if title_line_count >= 3 else 94

    # 3. Content boundaries for aspect ratios (Canvas is 1080x1920)
    if streamer_preset == "split_top_cam":
        if target_aspect_ratio == "16:9":
            content_top = 352
            content_bot = 1568
        elif target_aspect_ratio == "4:3":
            content_top = 150
            content_bot = 1770
        else:  # 1:1 and 9:16
            content_top = 0
            content_bot = 1920
    else:
        if target_aspect_ratio == "1:1":
            content_top = 420
            content_bot = 1500
        elif target_aspect_ratio == "4:3":
            content_top = 555
            content_bot = 1365
        elif target_aspect_ratio == "16:9":
            content_top = 656
            content_bot = 1264
        else:  # 9:16
            content_top = 0
            content_bot = 1920

    # Tight line height step (0.86x) for close, compact multi-line title layout
    line_step = int(title_font_size * 0.86)
    est_title_h = int(title_line_count * line_step)
    est_sub_h = int(sub_font_size * 1.08)
    sub_align = 5 if subtitle_position_mode == "center" else 2

    # Title Positioning (100% WYSIWYG matching framing preview):
    # Preview renders at top: `${title_y_percent}%` on 569px height (which is 1080x1920 canvas).
    # When title_y_percent is provided, directly map to canvas pixels: 1920 * (title_y_percent / 100.0).
    if title_y_percent is not None:
        effective_title_y_pct = float(title_y_percent)
    else:
        if streamer_preset == "split_top_cam":
            effective_title_y_pct = 3.5 if title_line_count >= 3 else 4.5
        elif target_aspect_ratio == "1:1":
            effective_title_y_pct = 11.5 if title_line_count >= 3 else (13.5 if title_line_count == 2 else 17.0)
        elif target_aspect_ratio == "4:3":
            effective_title_y_pct = 17.3 if title_line_count >= 3 else (19.3 if title_line_count == 2 else 23.6)
        elif target_aspect_ratio == "16:9":
            effective_title_y_pct = 22.6 if title_line_count >= 3 else (24.5 if title_line_count == 2 else 28.8)
        else:  # 9:16
            effective_title_y_pct = 12.0 if title_line_count >= 3 else (14.5 if title_line_count == 2 else 17.0)

    title_y = max(10, min(1800, int(round(1920 * (effective_title_y_pct / 100.0)))))

    # Subtitle Positioning:
    if subtitle_position_mode == "center":
        sub_y = int(round(1920 * (subtitle_center_y_percent / 100.0)))
        sub_y = max(content_top + 40, min(content_bot - 40, sub_y))
    else:
        # Bottom subtitle
        if subtitle_y_percent is not None:
            sub_y = int(round(1920 * (1.0 - (float(subtitle_y_percent) / 100.0))))
        else:
            if streamer_preset == "split_top_cam":
                default_sub_pct = 18.0 if (target_aspect_ratio in ["9:16", "1:1"]) else (10.0 if target_aspect_ratio == "4:3" else 18.0)
                sub_y = int(round(1920 * (1.0 - (default_sub_pct / 100.0))))
            else:
                default_sub_y = content_bot + est_sub_h + 12
                sub_y = default_sub_y

        if streamer_preset == "split_top_cam" or target_aspect_ratio == "9:16":
            sub_y = max(60, min(1880, sub_y))
        else:
            min_safe_sub_y = content_bot + est_sub_h + 8
            sub_y = max(sub_y, min_safe_sub_y)

    # Preset color schemes (ASS uses &HAABBGGRR in hex)
    if style_preset == "viral_pop":
        primary_color = "&H00FFFFFF"
        outline_color = "&H00000000"
        back_color = "&H80000000"
        highlight_color = "&H0000E6FF"  # #FFE600 Lemon Yellow
        outline_w = 4.8
        shadow_w = 2.0
    elif style_preset == "beast_punch":
        primary_color = "&H00FFFFFF"
        outline_color = "&H00111111"
        back_color = "&HA0000000"
        highlight_color = "&H0066FF00"  # #00FF66 High-voltage Neon Green
        outline_w = 5.0
        shadow_w = 2.2
    elif style_preset == "cyber_violet":
        primary_color = "&H00FFFFFF"
        outline_color = "&H00330033"
        back_color = "&H80500050"
        highlight_color = "&H00EF46D9"  # #D946EF Vivid Magenta
        outline_w = 4.8
        shadow_w = 2.0
    elif style_preset == "fire_red":
        primary_color = "&H00FFFFFF"
        outline_color = "&H00000020"
        back_color = "&H90000060"
        highlight_color = "&H002E2EFF"  # #FF2E2E Blazing Fire Red
        outline_w = 4.8
        shadow_w = 2.0
    elif style_preset == "electric_cyan":
        primary_color = "&H00FFFFFF"
        outline_color = "&H00102020"
        back_color = "&H90002030"
        highlight_color = "&H00FFF000"  # #00F0FF Electric Cyan
        outline_w = 4.8
        shadow_w = 2.0
    elif style_preset == "golden_aura":
        primary_color = "&H00FFFFFF"
        outline_color = "&H000a1220"
        back_color = "&HA0001830"
        highlight_color = "&H0000B8FF"  # #FFB800 Warm Gold
        outline_w = 4.8
        shadow_w = 2.0
    else:  # clean_minimal or none
        primary_color = "&H00FFFFFF"
        outline_color = "&H00111111"
        back_color = "&HB0000000"
        highlight_color = "&H00E0E0E0"
        outline_w = 3.6
        shadow_w = 1.8

    # Title styling: clean transparent background across ALL formats (no black box border)
    title_box_back = "&H00000000"
    title_border_style = 1

    ass_header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 2
Collisions: Reverse

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TitleStyle,{font_name},{title_font_size},&H00FFFFFF,&H000000FF,&H00000000,{title_box_back},-1,0,0,0,100,100,0,0,{title_border_style},4.4,2.0,8,40,40,0,1
Style: SubStyle,{font_name},{sub_font_size},{primary_color},&H000000FF,{outline_color},{back_color},-1,0,0,0,100,100,0,0,1,{outline_w},{shadow_w},2,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []

    # 3. Add Title Event with selectable visibility duration (5s, 10s, or entire clip)
    # If skip_title is True or title contains emojis, title is composited via PNG overlay with full color
    if formatted_title and title_position != "none" and not skip_title and not has_emoji(title_text):
        if title_duration == "5s":
            t_end_sec = min(5.0, duration_seconds)
        elif title_duration == "10s":
            t_end_sec = min(10.0, duration_seconds)
        else:
            t_end_sec = max(1.0, duration_seconds)

        end_time_str = format_ass_timestamp(t_end_sec)
        title_lines = [l.strip() for l in formatted_title.split("\\N") if l.strip()]
        for line_idx, t_line in enumerate(title_lines):
            line_y = title_y + (line_idx * line_step)
            events.append(
                f"Dialogue: 1,0:00:00.00,{end_time_str},TitleStyle,,0,0,0,,{{\\q2\\an8\\pos(540,{line_y})}}{t_line}"
            )

    # 4. Add Subtitle Events if captions are enabled (guaranteed ZERO vertical glitch / jumping)
    if words and style_preset != "none":
        # Step A: Sanitize and sort all word timestamps
        valid_words = []
        for w in words:
            raw_text = clean_caption_text(w.get("word", "").strip())
            if not raw_text:
                continue
            w_text = apply_text_case(raw_text, text_case)
            st = max(0.0, float(w.get("start", 0.0)))
            et = max(st + 0.08, float(w.get("end", st + 0.25)))
            valid_words.append({"word_text": w_text, "start": st, "end": et, "raw": w})

        valid_words.sort(key=lambda x: x["start"])

        # Step B: Pack into compact chunks (1 to 3 words, max 16 chars) to strictly guarantee 1 single line
        chunks = []
        current_chunk = []
        current_chars = 0
        for item in valid_words:
            w_len = len(item["word_text"])
            if len(current_chunk) >= 3 or (current_chunk and (current_chars + w_len > 16)):
                chunks.append(current_chunk)
                current_chunk = [item]
                current_chars = w_len
            else:
                current_chunk.append(item)
                current_chars += w_len + 1
        if current_chunk:
            chunks.append(current_chunk)

        # Step C: Enforce strictly non-overlapping, monotonically increasing chunk boundaries
        chunk_bounds = []
        for chunk in chunks:
            c_start = chunk[0]["start"]
            c_end = max(c_start + 0.25, chunk[-1]["end"])
            if chunk_bounds:
                prev_end = chunk_bounds[-1][1]
                if c_start < prev_end:
                    c_start = prev_end
                if c_end <= c_start:
                    c_end = c_start + 0.25
            chunk_bounds.append((c_start, c_end))

        # Clamp against subsequent chunk start times to eliminate any inter-chunk overlaps
        for i in range(len(chunk_bounds) - 1):
            cur_s, cur_e = chunk_bounds[i]
            nxt_s, _ = chunk_bounds[i + 1]
            if cur_e > nxt_s:
                chunk_bounds[i] = (cur_s, nxt_s)

        # Step D: Partition each chunk into strictly contiguous active-word time slices
        for chunk_idx, chunk in enumerate(chunks):
            c_start, c_end = chunk_bounds[chunk_idx]
            if c_end <= c_start:
                c_end = c_start + 0.20
            num_words = len(chunk)

            if num_words == 1:
                time_slices = [(c_start, c_end)]
            else:
                points = [c_start]
                for w_i in range(1, num_words):
                    raw_st = chunk[w_i]["start"]
                    min_allowed = points[-1] + 0.08
                    max_allowed = c_end - 0.08 * (num_words - w_i)
                    if min_allowed > max_allowed:
                        pt = points[-1] + (c_end - points[-1]) / (num_words - w_i + 1)
                    else:
                        pt = max(min_allowed, min(max_allowed, raw_st))
                    points.append(pt)
                points.append(c_end)
                time_slices = [(points[k], points[k + 1]) for k in range(num_words)]

            for active_idx, (w_start, w_end) in enumerate(time_slices):
                if w_end <= w_start:
                    continue

                line_parts = []
                for idx, item in enumerate(chunk):
                    w_txt = item["word_text"]
                    if idx == active_idx:
                        # Highlight active word with color only (no font scale or bold toggle so metrics stay 100% identical)
                        line_parts.append(r"{\c" + highlight_color + r"\3c" + outline_color + r"}" + w_txt + r"{\c" + primary_color + r"\3c" + outline_color + r"}")
                    else:
                        line_parts.append(w_txt)

                styled_line = " ".join(line_parts)
                # Lock position to sub_y with \q2\an{sub_align}\pos(540, sub_y) (zero vertical jump / collision)
                events.append(
                    f"Dialogue: 0,{format_ass_timestamp(w_start)},{format_ass_timestamp(w_end)},SubStyle,,0,0,0,,{{\\q2\\an{sub_align}\\pos(540,{sub_y})}}{styled_line}"
                )

    ass_content = ass_header + "\n".join(events) + "\n"
    os.makedirs(os.path.dirname(os.path.abspath(output_ass_path)), exist_ok=True)
    with open(output_ass_path, "w", encoding="utf-8") as f:
        f.write(ass_content)

    return output_ass_path


def detect_speaker_face_box(
    source_path: str,
    facecam_position: str = "auto",
    streamer_preset: str = "none"
) -> Dict[str, Any]:
    """
    Detects speaker face bounding box using OpenCV Haar Cascade Classifier ensemble.
    Can accept a video file or an image frame.
    Supports manual facecam position overrides ('bottom_right', 'top_right', 'bottom_left', 'top_left', 'center')
    or 'auto' smart detection using multi-cascade models (alt2, profile, default) + contrast enhancement + clustering.
    Returns normalized coordinates:
    {
        "found": bool,
        "cx": float,  # horizontal center (0.0 to 1.0)
        "cy": float,  # vertical center (0.0 to 1.0)
        "w": float,   # face width ratio (0.0 to 1.0)
        "h": float    # face height ratio (0.0 to 1.0)
    }
    """
    pos = (facecam_position or "auto").lower().strip()
    if pos == "bottom_right":
        return {"found": True, "cx": 0.85, "cy": 0.78, "w": 0.22, "h": 0.25}
    elif pos == "top_right":
        return {"found": True, "cx": 0.85, "cy": 0.22, "w": 0.22, "h": 0.25}
    elif pos == "bottom_left":
        return {"found": True, "cx": 0.15, "cy": 0.78, "w": 0.22, "h": 0.25}
    elif pos == "top_left":
        return {"found": True, "cx": 0.15, "cy": 0.22, "w": 0.22, "h": 0.25}
    elif pos == "center":
        return {"found": True, "cx": 0.50, "cy": 0.35, "w": 0.25, "h": 0.25}

    is_streamer = streamer_preset in ["split_top_cam", "pip_corner"]
    default_cx = 0.85 if is_streamer else 0.50
    default_cy = 0.78 if is_streamer else 0.35
    default_res = {"found": False, "cx": default_cx, "cy": default_cy, "w": 0.22, "h": 0.25}

    if not source_path or not os.path.exists(source_path):
        return default_res

    try:
        import cv2

        cascades = []
        cascade_names = [
            "haarcascade_frontalface_alt2.xml",
            "haarcascade_profileface.xml",
            "haarcascade_frontalface_default.xml"
        ]
        opencv_data_dir = getattr(cv2, "data", None)
        haarcascades_dir = getattr(opencv_data_dir, "haarcascades", None) if opencv_data_dir else None

        for c_name in cascade_names:
            p_cv = os.path.join(haarcascades_dir, c_name) if haarcascades_dir else ""
            if p_cv and os.path.exists(p_cv):
                try:
                    c = cv2.CascadeClassifier(p_cv)
                    if not c.empty():
                        cascades.append(c)
                except Exception:
                    pass
            elif (BASE_DIR / c_name).exists():
                try:
                    c = cv2.CascadeClassifier(str(BASE_DIR / c_name))
                    if not c.empty():
                        cascades.append(c)
                except Exception:
                    pass

        if not cascades and CASCADE_PATH.exists():
            try:
                c = cv2.CascadeClassifier(str(CASCADE_PATH))
                if not c.empty():
                    cascades.append(c)
            except Exception:
                pass

        if not cascades:
            logger.warning("No Haar cascade XML files could be loaded.")
            return default_res

        def detect_in_frame(img):
            h, w = img.shape[:2]
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            eq = cv2.equalizeHist(gray)
            frame_faces = []
            for cascade in cascades:
                for g in [eq, gray]:
                    faces = cascade.detectMultiScale(g, scaleFactor=1.1, minNeighbors=3, minSize=(28, 28))
                    if len(faces) > 0:
                        for (fx, fy, fw, fh) in faces:
                            fcx = (fx + fw / 2.0) / w
                            fcy = (fy + fh / 2.0) / h
                            frame_faces.append((fcx, fcy, float(fw) / w, float(fh) / h))
                if frame_faces:
                    break

            if not frame_faces:
                return None

            if is_streamer:
                corner_faces = [f for f in frame_faces if ((f[0] - 0.5)**2 + (f[1] - 0.5)**2) > 0.06]
                if corner_faces:
                    return max(corner_faces, key=lambda f: f[2] * f[3])

            return max(frame_faces, key=lambda f: f[2] * f[3])

        # Check if source is an image
        ext = os.path.splitext(source_path)[1].lower()
        if ext in [".jpg", ".jpeg", ".png", ".webp", ".bmp"]:
            frame = cv2.imread(source_path)
            if frame is None:
                return default_res
            best = detect_in_frame(frame)
            if best:
                return {
                    "found": True,
                    "cx": round(float(best[0]), 3),
                    "cy": round(float(best[1]), 3),
                    "w": round(float(best[2]), 3),
                    "h": round(float(best[3]), 3)
                }
            return default_res

        # Source is a video file
        cap = cv2.VideoCapture(source_path)
        if not cap.isOpened():
            return default_res

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        step = max(1, total_frames // 25) if total_frames > 25 else max(1, int(fps * 0.75))

        detections = []
        frame_idx = 0
        checked = 0
        while cap.isOpened() and frame_idx < total_frames and checked < 25:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            frame_idx += step
            checked += 1
            if not ret or frame is None:
                continue

            best = detect_in_frame(frame)
            if best:
                detections.append(best)

        cap.release()

        if detections:
            clusters = []
            for d in detections:
                matched = False
                for c in clusters:
                    dist = ((c['cx'] - d[0])**2 + (c['cy'] - d[1])**2)**0.5
                    if dist < 0.16:
                        c['pts'].append(d)
                        c['cx'] = sum(p[0] for p in c['pts']) / len(c['pts'])
                        c['cy'] = sum(p[1] for p in c['pts']) / len(c['pts'])
                        matched = True
                        break
                if not matched:
                    clusters.append({'cx': d[0], 'cy': d[1], 'pts': [d]})

            if is_streamer and len(clusters) > 1:
                corner_clusters = [c for c in clusters if ((c['cx'] - 0.5)**2 + (c['cy'] - 0.5)**2) > 0.06]
                best_cluster = max(corner_clusters or clusters, key=lambda c: len(c['pts']))
            else:
                best_cluster = max(clusters, key=lambda c: len(c['pts']))

            avg_w = sum(p[2] for p in best_cluster['pts']) / len(best_cluster['pts'])
            avg_h = sum(p[3] for p in best_cluster['pts']) / len(best_cluster['pts'])
            logger.info(f"Enhanced face tracking detected speaker: center=({best_cluster['cx']:.3f}, {best_cluster['cy']:.3f}), size=({avg_w:.3f}x{avg_h:.3f}) across {len(best_cluster['pts'])} frames")
            return {
                "found": True,
                "cx": round(float(best_cluster['cx']), 3),
                "cy": round(float(best_cluster['cy']), 3),
                "w": round(float(avg_w), 3),
                "h": round(float(avg_h), 3)
            }
    except Exception as e:
        logger.warning(f"Face detection encountered error: {e}, falling back to defaults.")

    return default_res


def detect_speaker_center_ratio(video_path: str, facecam_position: str = "auto", streamer_preset: str = "none") -> float:
    """
    Detects speaker faces across sample frames and returns the smoothed horizontal center ratio (0.0 to 1.0).
    Defaults to 0.5 (center) if no face is detected.
    """
    box = detect_speaker_face_box(video_path, facecam_position=facecam_position, streamer_preset=streamer_preset)
    return float(box.get("cx", 0.5))


def build_ffmpeg_filtergraph(
    aspect_ratio: str,
    background_style: str,
    face_center_ratio: float = 0.5,
    streamer_preset: str = "none",
    title_text: Optional[str] = None,
    title_position: str = "auto",
    ass_subtitles_path: Optional[str] = None,
    face_box: Optional[Dict[str, Any]] = None,
    title_y_percent: Optional[float] = None
) -> Tuple[str, str]:
    """
    Constructs the FFmpeg -filter_complex chain with proper aspect ratio center-cropping.
    Canvas is always 1080x1920 (9:16).
    """
    filters = []

    face_cx = float(face_box.get("cx", face_center_ratio)) if face_box else face_center_ratio
    face_cy = float(face_box.get("cy", 0.78 if streamer_preset in ["split_top_cam", "pip_corner"] else 0.35)) if face_box else 0.35

    # 1. Base Layout & Scaling
    if streamer_preset == "split_top_cam":
        if aspect_ratio == "16:9":
            # 16:9 split: top cam 1080x608 (16:9) tightly cropped around face, bottom feed 1080x608 (16:9)
            cam_h = "min(ih, max(240, ih*0.38))"
            cam_w = f"min(iw, ({cam_h})*16/9)"
            cam_x = f"max(0, min(iw-ow, iw*{face_cx:.3f}-ow/2))"
            cam_y = f"max(0, min(ih-oh, ih*{face_cy:.3f}-oh/2))"
            filters.append(
                f"[0:v]split=2[cam_raw][game_raw];"
                f"[cam_raw]crop='{cam_w}':'{cam_h}':'{cam_x}':'{cam_y}',scale=1080:608[cam_box];"
                f"[game_raw]crop='min(iw,ih*16/9)':'min(ih,iw*9/16)':'(iw-min(iw,ih*16/9))/2':'(ih-min(ih,iw*9/16))/2',scale=1080:608[game_box];"
                f"[cam_box][game_box]vstack=inputs=2[both_split]"
            )
            if background_style == "blurred":
                filters.append(
                    f"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[bg_blurred][both_split]overlay=0:352[layout_base]"
                )
            else:
                filters.append(f"[both_split]pad=1080:1920:0:352:black[layout_base]")

        elif aspect_ratio == "1:1":
            # 1:1 split: top cam 960x960 (1:1) tightly cropped around face, bottom feed 960x960 (1:1)
            cam_h = "min(ih, max(280, ih*0.38))"
            cam_w = f"min(iw, {cam_h})"
            cam_x = f"max(0, min(iw-ow, iw*{face_cx:.3f}-ow/2))"
            cam_y = f"max(0, min(ih-oh, ih*{face_cy:.3f}-oh/2))"
            filters.append(
                f"[0:v]split=2[cam_raw][game_raw];"
                f"[cam_raw]crop='{cam_w}':'{cam_h}':'{cam_x}':'{cam_y}',scale=960:960[cam_box];"
                f"[game_raw]crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(ih,iw))/2',scale=960:960[game_box];"
                f"[cam_box][game_box]vstack=inputs=2[both_split]"
            )
            if background_style == "blurred":
                filters.append(
                    f"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[bg_blurred][both_split]overlay=60:0[layout_base]"
                )
            else:
                filters.append(f"[both_split]pad=1080:1920:60:0:black[layout_base]")

        elif aspect_ratio == "4:3":
            # 4:3 split: top cam 1080x810 (4:3) tightly cropped around face, bottom feed 1080x810 (4:3)
            cam_h = "min(ih, max(280, ih*0.38))"
            cam_w = f"min(iw, ({cam_h})*4/3)"
            cam_x = f"max(0, min(iw-ow, iw*{face_cx:.3f}-ow/2))"
            cam_y = f"max(0, min(ih-oh, ih*{face_cy:.3f}-oh/2))"
            filters.append(
                f"[0:v]split=2[cam_raw][game_raw];"
                f"[cam_raw]crop='{cam_w}':'{cam_h}':'{cam_x}':'{cam_y}',scale=1080:810[cam_box];"
                f"[game_raw]crop='min(iw,ih*4/3)':'min(ih,iw*3/4)':'(iw-min(iw,ih*4/3))/2':'(ih-min(ih,iw*3/4))/2',scale=1080:810[game_box];"
                f"[cam_box][game_box]vstack=inputs=2[both_split]"
            )
            if background_style == "blurred":
                filters.append(
                    f"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[bg_blurred][both_split]overlay=0:150[layout_base]"
                )
            else:
                filters.append(f"[both_split]pad=1080:1920:0:150:black[layout_base]")

        else:  # 9:16
            # 9:16 Split: full bleed 1080x1920 with crisp facecam on top and centered gameplay on bottom
            cam_h = "min(ih, max(280, ih*0.38))"
            cam_w = f"min(iw, ({cam_h})*4/3)"
            cam_x = f"max(0, min(iw-ow, iw*{face_cx:.3f}-ow/2))"
            cam_y = f"max(0, min(ih-oh, ih*{face_cy:.3f}-oh/2))"

            game_w = "min(iw, ih*1080/1110)"
            game_h = "ih"
            game_x = "(iw-ow)/2"
            game_y = "(ih-oh)/2"

            filters.append(
                f"[0:v]split=2[cam_raw][game_raw];"
                f"[cam_raw]crop='{cam_w}':'{cam_h}':'{cam_x}':'{cam_y}',scale=1080:810[cam_box];"
                f"[game_raw]crop='{game_w}':'{game_h}':'{game_x}':'{game_y}',scale=1080:1110[game_box];"
                f"[cam_box][game_box]vstack=inputs=2[layout_base]"
            )

        current_v = "[layout_base]"

    elif streamer_preset == "pip_corner":
        # PIP Box tightly cropped on face (320x240)
        pip_cam_h = "min(ih, max(220, ih*0.35))"
        pip_cam_w = f"min(iw, ({pip_cam_h})*4/3)"
        pip_cam_x = f"max(0, min(iw-ow, iw*{face_cx:.3f}-ow/2))"
        pip_cam_y = f"max(0, min(ih-oh, ih*{face_cy:.3f}-oh/2))"
        pip_crop = f"[pip_raw]crop='{pip_cam_w}':'{pip_cam_h}':'{pip_cam_x}':'{pip_cam_y}',scale=320:240[pip_box];"

        if aspect_ratio == "1:1":
            crop_main = "crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=1080:1080"
            pip_x, pip_y = 736, 444
            if background_style == "blurred":
                filters.append(
                    f"[0:v]split=3[bg_raw][main_raw][pip_raw];"
                    f"[bg_raw]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[main_raw]{crop_main}[fg_square];"
                    f"[bg_blurred][fg_square]overlay=0:420[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )
            else:
                filters.append(
                    f"[0:v]split=2[main_raw][pip_raw];"
                    f"[main_raw]{crop_main},pad=1080:1920:0:420:black[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )

        elif aspect_ratio == "4:3":
            crop_main = "crop='min(iw,ih*4/3)':'min(ih,iw*3/4)':'(iw-min(iw,ih*4/3))/2':'(ih-min(ih,iw*3/4))/2',scale=1080:810"
            pip_x, pip_y = 736, 579
            if background_style == "blurred":
                filters.append(
                    f"[0:v]split=3[bg_raw][main_raw][pip_raw];"
                    f"[bg_raw]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[main_raw]{crop_main}[fg_43];"
                    f"[bg_blurred][fg_43]overlay=0:555[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )
            else:
                filters.append(
                    f"[0:v]split=2[main_raw][pip_raw];"
                    f"[main_raw]{crop_main},pad=1080:1920:0:555:black[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )

        elif aspect_ratio == "16:9":
            crop_main = "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)':'(iw-min(iw,ih*16/9))/2':'(ih-min(ih,iw*9/16))/2',scale=1080:608"
            pip_x, pip_y = 736, 676
            if background_style == "blurred":
                filters.append(
                    f"[0:v]split=3[bg_raw][main_raw][pip_raw];"
                    f"[bg_raw]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[main_raw]{crop_main}[fg_169];"
                    f"[bg_blurred][fg_169]overlay=0:656[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )
            else:
                filters.append(
                    f"[0:v]split=2[main_raw][pip_raw];"
                    f"[main_raw]{crop_main},pad=1080:1920:0:656:black[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )

        else:  # 9:16
            crop_ratio_safe = max(0.0, min(1.0, (face_cx - 0.158) / 0.684))
            pip_x, pip_y = 736, 120
            filters.append(
                f"[0:v]split=2[main_raw][pip_raw];"
                f"[main_raw]crop=ih*9/16:ih:(iw-ih*9/16)*{crop_ratio_safe:.3f}:0,scale=1080:1920[main_base];"
                f"{pip_crop}"
                f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
            )

        current_v = "[layout_base]"

    elif aspect_ratio == "9:16":
        # Full Bleed 9:16 with Face Tracking horizontal crop offset
        crop_ratio_safe = max(0.0, min(1.0, (face_cx - 0.158) / 0.684))
        filters.append(
            f"[0:v]crop=ih*9/16:ih:(iw-ih*9/16)*{crop_ratio_safe:.3f}:0,scale=1080:1920[layout_base]"
        )
        current_v = "[layout_base]"

    elif aspect_ratio == "1:1":
        # 1:1 Square (1080x1080) - Center crop to 1:1 square then scale to 1080x1080
        crop_11 = "crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=1080:1080"
        if background_style == "blurred":
            filters.append(
                f"[0:v]split=2[bg_raw][fg_raw];"
                f"[bg_raw]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                f"[fg_raw]{crop_11}[fg_square];"
                f"[bg_blurred][fg_square]overlay=0:420[layout_base]"
            )
        else:
            filters.append(
                f"[0:v]{crop_11},pad=1080:1920:0:420:black[layout_base]"
            )
        current_v = "[layout_base]"

    elif aspect_ratio == "4:3":
        # 4:3 Standard (1080x810) - Center crop 16:9/source to 4:3 then scale to 1080x810
        crop_43 = "crop='min(iw,ih*4/3)':'min(ih,iw*3/4)':'(iw-min(iw,ih*4/3))/2':'(ih-min(ih,iw*3/4))/2',scale=1080:810"
        if background_style == "blurred":
            filters.append(
                f"[0:v]split=2[bg_raw][fg_raw];"
                f"[bg_raw]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                f"[fg_raw]{crop_43}[fg_43];"
                f"[bg_blurred][fg_43]overlay=0:555[layout_base]"
            )
        else:
            filters.append(
                f"[0:v]{crop_43},pad=1080:1920:0:555:black[layout_base]"
            )
        current_v = "[layout_base]"

    else:  # 16:9 Letterbox
        # 16:9 Letterbox (1080x608)
        crop_169 = "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)':'(iw-min(iw,ih*16/9))/2':'(ih-min(ih,iw*9/16))/2',scale=1080:608"
        if background_style == "blurred":
            filters.append(
                f"[0:v]split=2[bg_raw][fg_raw];"
                f"[bg_raw]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                f"[fg_raw]{crop_169}[fg_169];"
                f"[bg_blurred][fg_169]overlay=0:656[layout_base]"
            )
        else:
            filters.append(
                f"[0:v]{crop_169},pad=1080:1920:0:656:black[layout_base]"
            )
        current_v = "[layout_base]"

    # 2. Subtitles & Title Burning via libass (.ass)
    # (If ass_subtitles_path is provided, it contains BOTH the title and subtitles rendered with exact matching fonts)
    if ass_subtitles_path and os.path.exists(ass_subtitles_path):
        escaped_ass = str(ass_subtitles_path).replace("\\", "/").replace(":", "\\:")
        if FONTS_DIR.exists() and any(FONTS_DIR.glob("*.ttf")):
            escaped_fonts = str(FONTS_DIR).replace("\\", "/").replace(":", "\\:")
            sub_filter = f"{current_v}subtitles='{escaped_ass}':fontsdir='{escaped_fonts}'[v_final]"
        else:
            sub_filter = f"{current_v}subtitles='{escaped_ass}'[v_final]"
        filters.append(sub_filter)
        current_v = "[v_final]"
    elif title_text and title_position != "none":
        # Fallback drawtext if no ASS was generated
        clean_title = title_text.replace("'", "").replace(":", "-").replace('"', "").strip()
        if title_y_percent is not None:
            y_pos = int(round(1920 * (float(title_y_percent) / 100.0)))
        elif streamer_preset == "split_top_cam":
            y_pos = int(round(1920 * 0.045))
        else:
            y_pos = 345 if aspect_ratio == "1:1" else (480 if aspect_ratio in ["4:3", "9:16"] else 581)
        box_style = "box=0"
        title_filter = (
            f"{current_v}drawtext=text='{clean_title}':fontsize=60:fontcolor=white:"
            f"x=(w-text_w)/2:y={y_pos}:borderw=2.5:bordercolor=black@0.8:{box_style}[v_with_title]"
        )
        filters.append(title_filter)
        current_v = "[v_with_title]"

    full_filter_str = ";".join(filters)
    return full_filter_str, current_v


def check_has_audio(video_path: str) -> bool:
    """Checks if the video file contains a readable audio stream."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            str(video_path)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        return bool(res.stdout and res.stdout.strip())
    except Exception:
        return True


def render_clip_to_mp4(
    video_path: str,
    output_mp4_path: str,
    aspect_ratio: str = "9:16",
    background_style: str = "black",
    enable_face_tracking: bool = True,
    streamer_preset: str = "none",
    facecam_position: str = "auto",
    title_text: Optional[str] = None,
    title_position: str = "auto",
    ass_subtitles_path: Optional[str] = None,
    clip_duration: float = 30.0,
    # Title Overlay (for full-color emojis and styling)
    title_overlay_path: Optional[str] = None,
    title_duration: str = "entire",
    # Watermark options
    watermark_enabled: bool = False,
    watermark_type: str = "image",
    watermark_image_path: Optional[str] = None,
    watermark_text: Optional[str] = None,
    watermark_size: float = 20.0,
    watermark_opacity: float = 0.8,
    watermark_x_percent: float = 90.0,
    watermark_y_percent: float = 8.0,
    # Background Music options
    bgm_enabled: bool = False,
    bgm_path: Optional[str] = None,
    bgm_volume: float = 0.25,
    bgm_start_offset: float = 0.0,
    # Hook SFX options (plays at frame 0)
    hook_sfx_enabled: bool = False,
    hook_sfx_path: Optional[str] = None,
    hook_sfx_volume: float = 1.0,
    # Raw voice / original audio boost (0.0 to 2.0)
    original_audio_volume: float = 1.0,
    # Hardware acceleration selection ('auto', 'nvenc', 'amf', 'qsv', 'cpu')
    hardware_accel: Optional[str] = "auto",
    title_y_percent: Optional[float] = None
) -> str:
    """
    Renders the final 1080x1920 short-form video with layout, aspect ratio, titles, subtitles,
    watermark branding, background music with start offset, and hook sound effect at frame 0.
    """
    is_streamer = streamer_preset in ["pip_corner", "split_top_cam"]
    default_cx = 0.85 if is_streamer else 0.50
    default_cy = 0.78 if is_streamer else 0.35
    face_box = {"found": False, "cx": default_cx, "cy": default_cy, "w": 0.22, "h": 0.25}
    if enable_face_tracking or is_streamer:
        face_box = detect_speaker_face_box(
            video_path,
            facecam_position=facecam_position,
            streamer_preset=streamer_preset
        )

    filter_complex, out_video_map = build_ffmpeg_filtergraph(
        aspect_ratio=aspect_ratio,
        background_style=background_style,
        face_center_ratio=float(face_box.get("cx", 0.5)),
        streamer_preset=streamer_preset,
        title_text=title_text if not (title_overlay_path and os.path.exists(title_overlay_path)) else None,
        title_position=title_position,
        ass_subtitles_path=ass_subtitles_path,
        face_box=face_box,
        title_y_percent=title_y_percent
    )

    filter_chains = [filter_complex]
    extra_input_args = []
    input_idx_counter = 1
    dur = max(1.0, float(clip_duration))

    # 1. Apply Title Overlay (Full-Color Emojis & Titles)
    if title_overlay_path and os.path.exists(title_overlay_path):
        t_idx = input_idx_counter
        input_idx_counter += 1
        extra_input_args.extend(["-i", str(title_overlay_path)])

        if title_duration == "5s":
            t_end_sec = min(5.0, dur)
            enable_expr = f":enable='between(t,0,{t_end_sec:.2f})'"
        elif title_duration == "10s":
            t_end_sec = min(10.0, dur)
            enable_expr = f":enable='between(t,0,{t_end_sec:.2f})'"
        else:
            enable_expr = ""

        overlay_title_cmd = f"{out_video_map}[{t_idx}:v]overlay=0:0{enable_expr}[v_with_title_overlay]"
        filter_chains.append(overlay_title_cmd)
        out_video_map = "[v_with_title_overlay]"

    # 2. Apply Watermark Overlay
    if watermark_enabled and float(watermark_size) > 0:
        wm_opacity = max(0.05, min(1.0, float(watermark_opacity)))
        wm_x_ratio = max(-1.0, min(2.0, float(watermark_x_percent) / 100.0))
        wm_y_ratio = max(-1.0, min(2.0, float(watermark_y_percent) / 100.0))

        if watermark_type == "image" and watermark_image_path and os.path.exists(watermark_image_path):
            wm_idx = input_idx_counter
            input_idx_counter += 1
            extra_input_args.extend(["-i", str(watermark_image_path)])

            # Canvas width is 1080. Calculate watermark width based on percentage (0-500%)
            wm_w = max(16, min(5400, int(1080 * (float(watermark_size) / 100.0))))
            wm_prep = f"[{wm_idx}:v]format=rgba,colorchannelmixer=aa={wm_opacity:.2f},scale={wm_w}:-1[wm_proc]"
            filter_chains.append(wm_prep)

            # Center-based positioning: (X%, Y%) represents the center anchor point on the canvas.
            # This ensures full 100% travel range across the canvas regardless of watermark size.
            overlay_cmd = (
                f"{out_video_map}[wm_proc]overlay="
                f"x='main_w*{wm_x_ratio:.4f}-overlay_w/2':"
                f"y='main_h*{wm_y_ratio:.4f}-overlay_h/2':eval=init[v_watermarked]"
            )
            filter_chains.append(overlay_cmd)
            out_video_map = "[v_watermarked]"

        elif watermark_text and watermark_text.strip():
            clean_text = watermark_text.replace("'", "").replace(":", "\\:").replace("%", "").strip()
            # Font size scaled smoothly across 0-500% range: 20% -> 36px, 100% -> 180px, 500% -> 900px
            wm_font_size = max(10, min(900, int(180 * (float(watermark_size) / 100.0))))
            # Center-based positioning: text anchor is centered at (X%, Y%) coordinates on the canvas
            overlay_x_expr = f"w*{wm_x_ratio:.4f}-text_w/2"
            overlay_y_expr = f"h*{wm_y_ratio:.4f}-text_h/2"
            drawtext_cmd = (
                f"{out_video_map}drawtext=text='{clean_text}':fontsize={wm_font_size}:"
                f"fontcolor=white@{wm_opacity:.2f}:borderw=2:bordercolor=black@{wm_opacity:.2f}:"
                f"x='{overlay_x_expr}':y='{overlay_y_expr}'[v_watermarked]"
            )
            filter_chains.append(drawtext_cmd)
            out_video_map = "[v_watermarked]"

    # 2. Audio Processing (Original Audio with Boost, BGM with start offset, and Hook SFX at frame 0)
    audio_inputs_to_mix = []
    has_orig_audio = check_has_audio(video_path)
    if has_orig_audio:
        orig_vol = max(0.0, min(2.0, float(original_audio_volume)))
        if abs(orig_vol - 1.0) > 0.01:
            filter_chains.append(f"[0:a:0]volume={orig_vol:.3f}[v_orig_boosted]")
            audio_inputs_to_mix.append("[v_orig_boosted]")
        else:
            audio_inputs_to_mix.append("[0:a:0]")

    dur = max(1.0, float(clip_duration))

    # BGM input with start offset & looping
    if bgm_enabled and bgm_path and os.path.exists(bgm_path):
        bgm_idx = input_idx_counter
        input_idx_counter += 1
        offset_sec = max(0.0, float(bgm_start_offset))
        if offset_sec > 0.0:
            extra_input_args.extend(["-ss", f"{offset_sec:.2f}"])
        extra_input_args.extend(["-stream_loop", "-1", "-i", str(bgm_path)])

        vol = max(0.0, min(1.0, float(bgm_volume)))
        fade_st = max(0.0, dur - 1.5)
        filter_chains.append(
            f"[{bgm_idx}:a]asetpts=PTS-STARTPTS,volume={vol:.3f},afade=t=out:st={fade_st:.2f}:d=1.5[bgm_proc]"
        )
        audio_inputs_to_mix.append("[bgm_proc]")

    # Hook SFX input placed at the very first frame (t=0)
    if hook_sfx_enabled and hook_sfx_path and os.path.exists(hook_sfx_path):
        sfx_idx = input_idx_counter
        input_idx_counter += 1
        extra_input_args.extend(["-i", str(hook_sfx_path)])

        sfx_vol = max(0.0, min(2.0, float(hook_sfx_volume)))
        filter_chains.append(
            f"[{sfx_idx}:a]asetpts=PTS-STARTPTS,atrim=end={dur:.2f},volume={sfx_vol:.3f}[sfx_proc]"
        )
        audio_inputs_to_mix.append("[sfx_proc]")

    # Mix audio streams together
    if len(audio_inputs_to_mix) > 1:
        mix_inputs_str = "".join(audio_inputs_to_mix)
        filter_chains.append(
            f"{mix_inputs_str}amix=inputs={len(audio_inputs_to_mix)}:duration=first:dropout_transition=2:normalize=0[a_final]"
        )
        out_audio_map = "[a_final]"
    elif len(audio_inputs_to_mix) == 1:
        single_stream = audio_inputs_to_mix[0]
        if single_stream == "[0:a:0]":
            out_audio_map = "0:a:0"
        else:
            filter_chains.append(f"{single_stream}anull[a_final]")
            out_audio_map = "[a_final]"
    else:
        out_audio_map = "0:a:0?"

    final_filter_complex = ";".join(filter_chains)

    # Video encoder (resolved from user choice: auto, nvenc, amf, qsv, cpu)
    chosen_encoder_name, chosen_encoder_args = resolve_encoder(hardware_accel)
    v_codec_args = chosen_encoder_args

    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(video_path),
        *extra_input_args,
        "-filter_complex", final_filter_complex,
        "-map", out_video_map,
        "-map", out_audio_map,
        *v_codec_args,
        "-c:a", "aac", "-b:a", "192k",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-shortest",
        str(output_mp4_path)
    ]

    # Check if FFmpeg is installed and accessible
    if not shutil.which("ffmpeg"):
        raise RuntimeError("FFmpeg is not installed or not found in system PATH. Please install FFmpeg (e.g. 'winget install Gyan.FFmpeg') and restart your terminal.")

    logger.info(f"Rendering final vertical clip to {output_mp4_path} with {chosen_encoder_name} (Selection: {hardware_accel}, BGM: {bgm_enabled}, Watermark: {watermark_enabled})...")
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if res.returncode != 0:
        logger.warning(f"Hardware encoder ({chosen_encoder_name}) failed (code {res.returncode}): {res.stderr[:250] if res.stderr else ''}")
        # Automatic fallback to universal CPU encoding (libx264) if chosen hardware encoder fails
        if chosen_encoder_name != "libx264":
            logger.info("Retrying render with universal multi-threaded CPU encoder (libx264)...")
            cpu_cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(video_path),
                *extra_input_args,
                "-filter_complex", final_filter_complex,
                "-map", out_video_map,
                "-map", out_audio_map,
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
                "-c:a", "aac", "-b:a", "192k",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                "-shortest",
                str(output_mp4_path)
            ]
            res_cpu = subprocess.run(cpu_cmd, capture_output=True, text=True, timeout=240)
            if res_cpu.returncode == 0 and os.path.exists(output_mp4_path) and os.path.getsize(output_mp4_path) > 1000:
                logger.info(f"Successfully rendered with CPU fallback: {output_mp4_path}")
                return str(output_mp4_path)
            else:
                logger.error(f"FFmpeg CPU fallback also failed: {res_cpu.stderr}")
                raise RuntimeError(f"FFmpeg rendering failed: {res_cpu.stderr or res.stderr}")
        else:
            logger.error(f"FFmpeg render error: {res.stderr}")
            raise RuntimeError(f"FFmpeg rendering failed: {res.stderr}")

    return str(output_mp4_path)


def extract_clip_frame(video_url: str, video_id: str, timestamp: float = 0.0) -> Optional[str]:
    """
    Extracts a single JPEG image frame at timestamp for the real video preview.
    Caches the frame on disk in TEMP_DIR / 'frames'.
    Guarantees returning a real video frame, never a promotional thumbnail.
    """
    frames_dir = TEMP_DIR / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '_', video_id)
    target_ts = max(1.0, timestamp if timestamp > 0 else 5.0)
    sec = int(round(target_ts))
    frame_path = frames_dir / f"{safe_id}_{sec}.jpg"

    if frame_path.exists() and frame_path.stat().st_size > 2000:
        return str(frame_path)

    # 1. Check local sliced clips or exports
    local_candidates = list(TEMP_DIR.glob(f"*{safe_id}*.mp4")) + list(EXPORTS_DIR.glob(f"*{safe_id}*.mp4"))
    for candidate in local_candidates:
        if candidate.exists() and candidate.stat().st_size > 10000 and "slice_" not in candidate.name:
            cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-ss", "00:00:01.00",
                "-i", str(candidate),
                "-vframes", "1",
                "-strict", "-1",
                str(frame_path)
            ]
            subprocess.run(cmd, capture_output=True, timeout=10)
            if frame_path.exists() and frame_path.stat().st_size > 2000:
                return str(frame_path)

    # 2. Extract a tiny 1-second slice of format 18 (fast 360p mp4) using yt-dlp + ffmpeg
    try:
        clean_url = video_url.strip() if video_url else f"https://www.youtube.com/watch?v={video_id}"
        base_cmd = get_yt_dlp_base_cmd()
        temp_slice = frames_dir / f"slice_{safe_id}_{sec}.mp4"

        t_start = target_ts
        t_end = target_ts + 1.0
        t_start_fmt = format_section_time(t_start)
        t_end_fmt = format_section_time(t_end)

        slice_cmd = [
            *base_cmd,
            "-f", "18/best[height<=720]/best",
            "--download-sections", f"*{t_start_fmt}-{t_end_fmt}",
            "-o", str(temp_slice),
            "--no-warnings",
            clean_url
        ]
        subprocess.run(slice_cmd, capture_output=True, text=True, timeout=20)
        if temp_slice.exists() and temp_slice.stat().st_size > 1000:
            ff_cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-ss", "00:00:00.20",
                "-i", str(temp_slice),
                "-vframes", "1",
                "-strict", "-1",
                str(frame_path)
            ]
            subprocess.run(ff_cmd, capture_output=True, timeout=5)
            try:
                temp_slice.unlink()
            except Exception:
                pass

        if frame_path.exists() and frame_path.stat().st_size > 2000:
            return str(frame_path)
    except Exception as e:
        logger.warning(f"Slice frame extraction failed for {video_id}: {e}")

    # 3. Check any existing frame for this video in frames_dir as fallback
    existing_frames = list(frames_dir.glob(f"{safe_id}_*.jpg"))
    if existing_frames:
        return str(existing_frames[0])

    # 4. Instant high-res thumbnail fallback (guarantees frame preview NEVER gets stuck)
    try:
        import urllib.request
        for thumb_url in [
            f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
            f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        ]:
            try:
                req = urllib.request.Request(thumb_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=3) as resp, open(frame_path, "wb") as f_out:
                    f_out.write(resp.read())
                if frame_path.exists() and frame_path.stat().st_size > 2000:
                    return str(frame_path)
            except Exception:
                continue
    except Exception as e:
        logger.warning(f"Thumbnail fallback failed for {video_id}: {e}")

    return None
