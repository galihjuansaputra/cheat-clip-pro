from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import subprocess
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Union
from urllib.parse import quote

from backend.utils.text import canonical_video_url
from backend.config import (
    ACTIVE_ENCODER_ARGS,
    ACTIVE_ENCODER_NAME,
    EXPORTS_DIR,
    TEMP_DIR,
    UPLOADS_DIR,
    download_clip_segment,
    download_full_raw_video,
    get_effective_cookies_path,
    is_valid_mp4,
    logger,
)

from pathlib import Path

raw_download_jobs: Dict[str, dict] = {}
raw_download_procs: Dict[str, subprocess.Popen] = {}
raw_clip_download_jobs: Dict[str, dict] = {}
raw_clip_download_procs: Dict[str, subprocess.Popen] = {}
master_source_jobs: Dict[str, dict] = {}
master_source_procs: Dict[str, subprocess.Popen] = {}


def cancel_raw_download_job(job_id: str) -> bool:
    """Cancels an active raw full video download job and terminates any running subprocess."""
    job = raw_download_jobs.get(job_id)
    if not job:
        return False
    job["status"] = "cancelled"
    job["error"] = "Unduhan video lengkap dibatalkan oleh pengguna."
    proc = raw_download_procs.pop(job_id, None)
    if proc:
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
            else:
                proc.kill()
        except Exception:
            pass
    return True


def cancel_raw_clip_download_job(job_id: str) -> bool:
    """Cancels an active raw clip download job and terminates any running subprocess."""
    job = raw_clip_download_jobs.get(job_id)
    if not job:
        return False
    job["status"] = "cancelled"
    job["error"] = "Unduhan klip dibatalkan oleh pengguna."
    proc = raw_clip_download_procs.pop(job_id, None)
    if proc:
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
            else:
                proc.kill()
        except Exception:
            pass
    return True


def get_video_duration_quick(file_path: Union[str, Path]) -> float:
    """Returns video duration in seconds via ffprobe, or 0.0 on error."""
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(file_path)],
            capture_output=True, text=True, timeout=5
        )
        val = probe.stdout.strip()
        return float(val) if val else 0.0
    except Exception:
        return 0.0


def find_master_source_video(
    video_id: str,
    video_url: Optional[str] = None,
    required_duration: Optional[float] = None
) -> Optional[Path]:
    """
    Locates any cached 1080p/HD master video source file for this video ID or URL.
    Checks EXPORTS_DIR, TEMP_DIR, and UPLOADS_DIR.
    If required_duration is specified, ensures the file covers at least that duration.
    """
    raw_id = (video_id or "").replace("gdrive_", "").replace("upload_", "").strip()
    if not raw_id and video_url:
        yt_m = re.search(r'(?:v=|youtu\.be/|yt_audio_)([a-zA-Z0-9_-]{11})', video_url)
        if yt_m:
            raw_id = yt_m.group(1)

    if not raw_id:
        return None

    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '_', raw_id)

    def _check_cand(p: Path) -> bool:
        if not (p.exists() and p.stat().st_size > 5 * 1024 * 1024 and is_valid_mp4(p)):
            return False
        if required_duration and required_duration > 0:
            dur = get_video_duration_quick(p)
            if dur > 0 and dur < (required_duration - 1.0):
                return False
        return True

    # 1. Direct check for standard master source filenames
    for d in [EXPORTS_DIR, TEMP_DIR, UPLOADS_DIR]:
        if not d.exists():
            continue
        p1 = d / f"master_source_{safe_id}.mp4"
        if _check_cand(p1):
            return p1
        p2 = d / f"{safe_id}_master.mp4"
        if _check_cand(p2):
            return p2

    # 2. General scan in EXPORTS_DIR, TEMP_DIR, UPLOADS_DIR for matching raw video
    for d in [EXPORTS_DIR, TEMP_DIR, UPLOADS_DIR]:
        if not d.exists():
            continue
        for f in d.iterdir():
            if f.is_file() and f.suffix.lower() in [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]:
                if f.name.startswith("yt_audio_") or f.name.startswith("twitch_audio_") or "_clip_" in f.name:
                    continue
                if safe_id in f.name and _check_cand(f):
                    return f

    return None


def cancel_master_source_job(job_id: str) -> bool:
    """Cancels an active master source download job and terminates any running subprocess."""
    job = master_source_jobs.get(job_id)
    if not job:
        return False
    job["status"] = "cancelled"
    job["detail"] = "Proses pengunduhan bahan master dibatalkan oleh pengguna."
    proc = master_source_procs.pop(job_id, None)
    if proc:
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
            else:
                proc.kill()
        except Exception:
            pass
    return True


async def run_master_source_job(
    job_id: str,
    v_url: str,
    video_id: str,
    cookies_content: Optional[str] = None,
    max_end_time: Optional[float] = None,
    clips: Optional[List[Dict[str, Any]]] = None
):
    """
    Downloads or prepares the master source video in 1080p quality, saving it to disk so that
    subsequent clip slicing runs 100% locally and instantaneously.
    """
    def on_progress(p: dict):
        if job_id in master_source_jobs:
            if master_source_jobs[job_id].get("status") == "cancelled":
                return
            new_pct = float(p.get("percent", 0.0) or 0.0)
            cur_pct = float(master_source_jobs[job_id].get("progress_percent", 0.0) or 0.0)
            if new_pct > cur_pct or cur_pct <= 5.0:
                master_source_jobs[job_id]["progress_percent"] = max(5.0, new_pct)
            if p.get("downloaded"):
                master_source_jobs[job_id]["downloaded"] = p.get("downloaded")
            if p.get("total"):
                master_source_jobs[job_id]["total"] = p.get("total")
            if p.get("speed"):
                master_source_jobs[job_id]["speed"] = p.get("speed")
            if p.get("eta"):
                master_source_jobs[job_id]["eta"] = p.get("eta")
            if p.get("detail"):
                master_source_jobs[job_id]["detail"] = p.get("detail")

    def on_spawn(p):
        master_source_procs[job_id] = p

    try:
        master_source_jobs[job_id]["status"] = "downloading"
        safe_id = re.sub(r'[^a-zA-Z0-9_-]', '_', (video_id or "video").replace("gdrive_", "").replace("upload_", ""))
        master_path = EXPORTS_DIR / f"master_source_{safe_id}.mp4"

        # 1. Check if full master video is already available on disk
        existing = find_master_source_video(video_id, v_url, required_duration=max_end_time)
        if existing and existing.exists():
            logger.info(f"Master source video already available for {video_id}: {existing}")
            master_source_jobs[job_id]["status"] = "ready"
            master_source_jobs[job_id]["progress_percent"] = 100.0
            master_source_jobs[job_id]["filename"] = existing.name
            master_source_jobs[job_id]["file_path"] = str(existing)
            master_source_jobs[job_id]["downloaded"] = f"{round(existing.stat().st_size / (1024 * 1024), 1)} MB"
            master_source_jobs[job_id]["total"] = master_source_jobs[job_id]["downloaded"]
            master_source_jobs[job_id]["detail"] = "✓ Video bahan master siap di cache server!"
            return

        # 2. If specific clips are requested, download only their required sections in HD 1080p
        if clips and len(clips) > 0:
            total_clips = len(clips)
            for idx, c in enumerate(clips):
                if master_source_jobs[job_id].get("status") == "cancelled":
                    return
                st = float(c.get("start_time", 0.0))
                et = float(c.get("end_time", st + 30.0))
                clip_label = f"klip {idx + 1}/{total_clips}"
                target_fname = f"clip_bahan_{safe_id}_{int(st)}_{int(et)}.mp4"
                target_p = TEMP_DIR / target_fname

                if target_p.exists() and is_valid_mp4(target_p):
                    logger.info(f"Clip bahan already ready for {clip_label}: {target_p}")
                    continue

                master_source_jobs[job_id]["detail"] = f"Mengunduh bahan {clip_label} (1080p)..."
                master_source_jobs[job_id]["progress_percent"] = max(5.0, round((idx / total_clips) * 100.0, 1))

                await asyncio.to_thread(
                    download_clip_segment,
                    v_url,
                    st,
                    et,
                    target_fname,
                    cookies_content,
                    on_spawn
                )

            if master_source_jobs[job_id].get("status") == "cancelled":
                return

            master_source_jobs[job_id]["status"] = "ready"
            master_source_jobs[job_id]["progress_percent"] = 100.0
            master_source_jobs[job_id]["detail"] = "✓ Video bahan klip master 1080p siap!"
            return

        # 3. Otherwise download full raw video
        logger.info(f"Downloading master source video for {video_id} to {master_path} (max_end_time={max_end_time})...")
        await asyncio.to_thread(download_full_raw_video, v_url, str(master_path), on_progress, cookies_content, max_end_time, on_spawn)

        if master_source_jobs[job_id].get("status") == "cancelled":
            logger.info(f"Master source download job {job_id} cancelled by user")
            return

        if master_path.exists() and is_valid_mp4(master_path):
            size_mb = round(master_path.stat().st_size / (1024 * 1024), 1)
            logger.info(f"Master source video ready ({size_mb} MB) at {master_path}")
            master_source_jobs[job_id]["status"] = "ready"
            master_source_jobs[job_id]["progress_percent"] = 100.0
            master_source_jobs[job_id]["filename"] = master_path.name
            master_source_jobs[job_id]["file_path"] = str(master_path)
            master_source_jobs[job_id]["downloaded"] = f"{size_mb} MB"
            master_source_jobs[job_id]["total"] = f"{size_mb} MB"
            master_source_jobs[job_id]["detail"] = f"✓ Video bahan master siap ({size_mb} MB)"
        else:
            raise RuntimeError("Master video file is missing or invalid after download.")
    except Exception as e:
        if master_source_jobs.get(job_id, {}).get("status") == "cancelled":
            return
        logger.error(f"Master source download job {job_id} failed: {e}")
        master_source_jobs[job_id]["status"] = "failed"
        master_source_jobs[job_id]["error"] = str(e)
    finally:
        master_source_procs.pop(job_id, None)


async def run_raw_download_job(
    job_id: str,
    v_url: str,
    out_path: str,
    filename: str,
    download_title: Optional[str] = None,
    cookies_content: Optional[str] = None,
    video_id: Optional[str] = None
):
    def on_progress(p: dict):
        if job_id in raw_download_jobs:
            if raw_download_jobs[job_id].get("status") == "cancelled":
                return
            raw_download_jobs[job_id]["progress_percent"] = p.get("percent", 0.0)
            raw_download_jobs[job_id]["downloaded"] = p.get("downloaded", "")
            raw_download_jobs[job_id]["total"] = p.get("total", "")
            raw_download_jobs[job_id]["speed"] = p.get("speed", "")
            raw_download_jobs[job_id]["eta"] = p.get("eta", "")

    def on_spawn(p):
        raw_download_procs[job_id] = p

    try:
        raw_download_jobs[job_id]["status"] = "downloading"

        # 1. First check if master source video exists locally (e.g. from Stage 1 or cache)
        if video_id:
            master_video = find_master_source_video(video_id, v_url)
            if master_video and Path(master_video).exists():
                logger.info(f"Serving local master video {master_video} directly as full download {out_path}")
                shutil.copy2(str(master_video), out_path)
                raw_download_jobs[job_id]["status"] = "ready"
                raw_download_jobs[job_id]["progress_percent"] = 100.0
                dl_name = download_title or filename
                raw_download_jobs[job_id]["download_url"] = f"/api/download-rendered/{filename}?title={quote(dl_name)}"
                raw_download_jobs[job_id]["filename"] = f"{dl_name}.mp4" if not dl_name.endswith(".mp4") else dl_name
                return

        # Check if local video exists (e.g. Google Drive or Uploaded video)
        clean_vname = urllib.parse.unquote(os.path.basename(v_url.split("?")[0])).strip()
        from backend.utils.text import is_twitch_url, extract_twitch_info, get_twitch_canonical_url
        yt_audio_match = re.search(r'yt_audio_([a-zA-Z0-9_-]{11})', clean_vname)
        tw_audio_match = re.search(r'twitch_audio_(twitch_\d+|twitch_clip_[a-zA-Z0-9_-]+|\d+|[a-zA-Z0-9_-]+)', clean_vname)
        is_youtube = bool(yt_audio_match or re.search(r'(?:youtube\.com|youtu\.be)', v_url))
        is_twitch = bool(tw_audio_match or is_twitch_url(v_url))

        if yt_audio_match:
            v_url = f"https://www.youtube.com/watch?v={yt_audio_match.group(1)}"
        elif tw_audio_match or is_twitch:
            tw_info = extract_twitch_info(v_url)
            v_url = get_twitch_canonical_url(tw_info) if tw_info else v_url

        local_src = None
        if not is_youtube and not is_twitch:
            if os.path.exists(v_url):
                local_src = os.path.abspath(v_url)
            elif (UPLOADS_DIR / clean_vname).exists():
                local_src = str(UPLOADS_DIR / clean_vname)
            elif (TEMP_DIR / clean_vname).exists() and not clean_vname.startswith("yt_audio_") and not clean_vname.startswith("twitch_audio_"):
                local_src = str(TEMP_DIR / clean_vname)
            else:
                for d in [UPLOADS_DIR, TEMP_DIR, EXPORTS_DIR]:
                    if d.exists():
                        for f in d.iterdir():
                            if f.is_file() and not f.name.startswith("yt_audio_") and not f.name.startswith("twitch_audio_") and (f.name.lower() == clean_vname.lower() or clean_vname.lower() in f.name.lower() or f.stem.lower() in clean_vname.lower()):
                                local_src = str(f)
                                break
                    if local_src:
                        break

        if local_src and os.path.exists(local_src):
            logger.info(f"Serving local/gdrive video {local_src} directly as full download {out_path}")
            shutil.copy2(local_src, out_path)
            raw_download_jobs[job_id]["status"] = "ready"
            raw_download_jobs[job_id]["progress_percent"] = 100.0
            dl_name = download_title or filename
            raw_download_jobs[job_id]["download_url"] = f"/api/download-rendered/{filename}?title={quote(dl_name)}"
            raw_download_jobs[job_id]["filename"] = f"{dl_name}.mp4" if not dl_name.endswith(".mp4") else dl_name
            return

        if raw_download_jobs[job_id].get("status") == "cancelled":
            return

        await asyncio.to_thread(download_full_raw_video, v_url, out_path, on_progress, cookies_content, None, on_spawn)

        if raw_download_jobs[job_id].get("status") == "cancelled":
            logger.info(f"Raw download job {job_id} cancelled by user")
            return

        raw_download_jobs[job_id]["status"] = "ready"
        raw_download_jobs[job_id]["progress_percent"] = 100.0
        dl_name = download_title or filename
        raw_download_jobs[job_id]["download_url"] = f"/api/download-rendered/{filename}?title={quote(dl_name)}"
        raw_download_jobs[job_id]["filename"] = f"{dl_name}.mp4" if not dl_name.endswith(".mp4") else dl_name
    except Exception as e:
        if raw_download_jobs.get(job_id, {}).get("status") == "cancelled":
            return
        logger.error(f"Raw video download job {job_id} failed: {e}")
        raw_download_jobs[job_id]["status"] = "failed"
        raw_download_jobs[job_id]["error"] = str(e)
    finally:
        raw_download_procs.pop(job_id, None)


async def run_raw_clip_download_job(
    job_id: str,
    v_url: str,
    video_id: str,
    start_time: float,
    end_time: float,
    title: str,
    cookies_content: Optional[str] = None,
    proxy: Optional[str] = None
):
    clean_title = re.sub(r'[\\/*?:"<>|]', "", (title or "clip").strip())
    if not clean_title:
        clean_title = f"clip_{int(start_time)}_{int(end_time)}"
    v_url = v_url or canonical_video_url(video_id)
    download_title = f"{clean_title} (raw)"
    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '_', video_id or "clip")
    seg_filename = f"{safe_id}_clip_{int(start_time)}_{int(end_time)}_{int(time.time())}_raw.mp4"
    out_path = EXPORTS_DIR / seg_filename

    try:
        raw_clip_download_jobs[job_id]["status"] = "downloading"
        raw_clip_download_jobs[job_id]["progress_percent"] = 15.0
        raw_clip_download_jobs[job_id]["current_step"] = 1
        raw_clip_download_jobs[job_id]["total_steps"] = 4
        raw_clip_download_jobs[job_id]["step_name"] = "Potong Klip"
        raw_clip_download_jobs[job_id]["stage"] = "Memeriksa video master lokal..."

        # Check master source video first
        source_video = find_master_source_video(video_id, v_url)

        # Fallback to local file candidate scan if find_master_source_video didn't match
        if not source_video:
            local_candidates = []
            clean_vname = urllib.parse.unquote(os.path.basename(v_url.split("?")[0])).strip() if v_url else ""
            if clean_vname and not clean_vname.startswith("yt_audio_") and not clean_vname.startswith("twitch_audio_"):
                if (UPLOADS_DIR / clean_vname).exists():
                    local_candidates.append(UPLOADS_DIR / clean_vname)
                if (TEMP_DIR / clean_vname).exists():
                    local_candidates.append(TEMP_DIR / clean_vname)

            all_dirs = [UPLOADS_DIR, EXPORTS_DIR, TEMP_DIR]
            raw_vid_id = (video_id or "").replace("gdrive_", "").replace("upload_", "")
            
            for d in all_dirs:
                if d.exists():
                    for f in d.iterdir():
                        if f.is_file() and f.suffix.lower() in [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]:
                            if f.name.startswith("yt_audio_") or f.name.startswith("twitch_audio_"):
                                continue
                            if clean_vname and (clean_vname.lower() in f.name.lower() or f.name.lower() in clean_vname.lower()):
                                local_candidates.append(f)
                            elif raw_vid_id and len(raw_vid_id) >= 4 and raw_vid_id in f.name:
                                local_candidates.append(f)

            has_cookies = bool(cookies_content or get_effective_cookies_path())
            required_h = 1080 if has_cookies else 720

            for candidate in local_candidates:
                if candidate.exists() and candidate.is_file() and candidate.stat().st_size > 5 * 1024 * 1024 and is_valid_mp4(candidate):
                    if "_clip_" not in candidate.name and candidate.name != seg_filename:
                        try:
                            probe = subprocess.run(
                                ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height", "-of", "csv=p=0", str(candidate)],
                                capture_output=True, text=True, timeout=5
                            )
                            cand_h = int(probe.stdout.strip()) if probe.stdout.strip().isdigit() else 0
                            if cand_h < required_h:
                                logger.info(f"Skipping cached candidate {candidate.name} (height={cand_h}p < {required_h}p)")
                                continue
                        except Exception:
                            pass
                        source_video = candidate
                        break

        duration_sec = max(1.0, end_time - start_time)

        def on_spawn(p):
            raw_clip_download_procs[job_id] = p

        def _on_progress(p: dict):
            if job_id in raw_clip_download_jobs:
                if raw_clip_download_jobs[job_id].get("status") == "cancelled":
                    return
                if "percent" in p:
                    raw_clip_download_jobs[job_id]["progress_percent"] = p["percent"]
                if "downloaded" in p:
                    raw_clip_download_jobs[job_id]["downloaded"] = p["downloaded"]
                if "total" in p:
                    raw_clip_download_jobs[job_id]["total"] = p["total"]
                if "speed" in p:
                    raw_clip_download_jobs[job_id]["speed"] = p["speed"]
                if "eta" in p:
                    raw_clip_download_jobs[job_id]["eta"] = p["eta"]
                if "stage" in p:
                    raw_clip_download_jobs[job_id]["stage"] = p["stage"]

        success = False

        # 0. Check if direct HD clip segment was already acquired by Stage 1 master acquisition
        stream_id = None
        if "v=" in v_url:
            v_match = re.search(r'[?&]v=([a-zA-Z0-9_-]{11})', v_url)
            if v_match:
                stream_id = v_match.group(1)
        elif "youtu.be/" in v_url:
            v_match = re.search(r'youtu\.be/([a-zA-Z0-9_-]{11})', v_url)
            if v_match:
                stream_id = v_match.group(1)
        safe_id = stream_id or re.sub(r'[^a-zA-Z0-9_-]', '_', v_url.split("?")[0])

        pre_candidates = [
            TEMP_DIR / f"clip_bahan_{safe_id}_{int(start_time)}_{int(end_time)}.mp4",
            EXPORTS_DIR / f"clip_bahan_{safe_id}_{int(start_time)}_{int(end_time)}.mp4",
        ]
        for pre in pre_candidates:
            if pre.exists() and pre.stat().st_size > 50 * 1024 and is_valid_mp4(pre):
                logger.info(f"Reusing pre-acquired Stage 1 HD clip segment for download: {pre.name} -> {out_path}")
                raw_clip_download_jobs[job_id]["step_name"] = "Potong Klip"
                raw_clip_download_jobs[job_id]["stage"] = "Menyiapkan klip HD..."
                raw_clip_download_jobs[job_id]["progress_percent"] = 90.0
                shutil.copyfile(str(pre), str(out_path))
                if out_path.exists() and is_valid_mp4(out_path):
                    success = True
                    break

        if not success and source_video and Path(source_video).exists():
            source_video_str = str(source_video)
            raw_clip_download_jobs[job_id]["step_name"] = "Potong Klip"
            raw_clip_download_jobs[job_id]["stage"] = "Memotong klip dari video master lokal..."
            raw_clip_download_jobs[job_id]["progress_percent"] = 50.0
            raw_clip_download_jobs[job_id]["downloaded"] = "Memotong klip..."
            raw_clip_download_jobs[job_id]["speed"] = "Direct Render"
            raw_clip_download_jobs[job_id]["eta"] = "00:02"
            try:
                logger.info(f"Trimming local video with {ACTIVE_ENCODER_NAME} for clip {download_title} ({start_time}-{end_time}) from {source_video_str}")
                trim_cmd = [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-ss", str(start_time),
                    "-i", source_video_str,
                    "-t", str(duration_sec),
                    *ACTIVE_ENCODER_ARGS,
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-af", "aresample=async=1:first_pts=0",
                    "-movflags", "+faststart",
                    str(out_path)
                ]
                trim_timeout = max(60, int(duration_sec * 3) + 30)
                await asyncio.to_thread(subprocess.run, trim_cmd, check=True, timeout=trim_timeout)
                if out_path.exists() and is_valid_mp4(out_path):
                    success = True
            except Exception as trim_err:
                logger.warning(f"Hardware trimming failed ({trim_err}), retrying with CPU libx264...")
                try:
                    cpu_trim_cmd = [
                        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                        "-ss", str(start_time),
                        "-i", source_video_str,
                        "-t", str(duration_sec),
                        "-c:v", "libx264",
                        "-preset", "veryfast",
                        "-crf", "18",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-af", "aresample=async=1:first_pts=0",
                        "-movflags", "+faststart",
                        str(out_path)
                    ]
                    await asyncio.to_thread(subprocess.run, cpu_trim_cmd, check=True, timeout=trim_timeout)
                    if out_path.exists() and is_valid_mp4(out_path):
                        success = True
                except Exception as cpu_err:
                    logger.warning(f"CPU trimming also failed ({cpu_err}), falling back to direct stream download...")

        if raw_clip_download_jobs[job_id].get("status") == "cancelled":
            return

        if not success:
            logger.info(f"Downloading clip segment from YouTube for {download_title} ({start_time}-{end_time})")
            raw_clip_download_jobs[job_id]["step_name"] = "Potong Klip"
            raw_clip_download_jobs[job_id]["stage"] = "Connecting to YouTube..."
            raw_clip_download_jobs[job_id]["progress_percent"] = 20.0
            temp_name = f"temp_{seg_filename}"

            def _on_stage(text: str, pct: float):
                if job_id in raw_clip_download_jobs:
                    raw_clip_download_jobs[job_id]["stage"] = text
                    raw_clip_download_jobs[job_id]["progress_percent"] = pct

            downloaded_temp = await asyncio.to_thread(
                download_clip_segment,
                v_url,
                start_time,
                end_time,
                temp_name,
                cookies_content,
                on_spawn,
                proxy,
                _on_stage,
                _on_progress
            )
            if downloaded_temp and os.path.exists(downloaded_temp):
                if out_path.exists():
                    try:
                        out_path.unlink()
                    except Exception:
                        pass
                # Fast timestamp and keyframe normalization without stripping audio edit lists
                fix_cmd = [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                    "-i", downloaded_temp,
                    "-c", "copy",
                    "-movflags", "+faststart",
                    str(out_path)
                ]
                try:
                    await asyncio.to_thread(subprocess.run, fix_cmd, check=True, timeout=45)
                    if out_path.exists() and is_valid_mp4(out_path):
                        success = True
                        try:
                            os.unlink(downloaded_temp)
                        except Exception:
                            pass
                except Exception:
                    shutil.move(downloaded_temp, str(out_path))
                    if out_path.exists() and is_valid_mp4(out_path):
                        success = True

        if raw_clip_download_jobs[job_id].get("status") == "cancelled":
            return

        if success and out_path.exists() and is_valid_mp4(out_path):
            raw_clip_download_jobs[job_id]["status"] = "ready"
            raw_clip_download_jobs[job_id]["current_step"] = 1
            raw_clip_download_jobs[job_id]["step_name"] = "Potong Klip"
            raw_clip_download_jobs[job_id]["stage"] = "Potongan klip siap"
            raw_clip_download_jobs[job_id]["progress_percent"] = 100.0
            raw_clip_download_jobs[job_id]["download_url"] = f"/api/video/{seg_filename}"
            raw_clip_download_jobs[job_id]["filename"] = f"{download_title}.mp4"
            logger.info(f"Raw clip '{download_title}' ready at {out_path}")
        else:
            raise RuntimeError("Generated clip file is missing or invalid.")

    except Exception as e:
        if raw_clip_download_jobs.get(job_id, {}).get("status") == "cancelled":
            return
        logger.error(f"Raw clip download job {job_id} failed: {e}")
        raw_clip_download_jobs[job_id]["status"] = "failed"
        raw_clip_download_jobs[job_id]["error"] = str(e)
    finally:
        raw_clip_download_procs.pop(job_id, None)
