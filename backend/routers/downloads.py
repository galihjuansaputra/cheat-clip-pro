import logging
import os
import re
import time
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException

from backend.config import EXPORTS_DIR, logger
from backend.schemas.downloads import PrepareSourceRequest, RawClipDownloadRequest, RawVideoDownloadRequest
from backend.services.download_service import (
    find_master_source_video,
    master_source_jobs,
    raw_clip_download_jobs,
    raw_download_jobs,
    run_master_source_job,
    run_raw_clip_download_job,
    run_raw_download_job,
)

router = APIRouter(tags=["Downloads"])


@router.get("/api/source-status")
async def get_source_status(video_id: Optional[str] = None, video_url: Optional[str] = None):
    """
    Checks if a master source video (1080p HD) is cached locally on disk.
    If ready, clip slicing can be executed in ~1 second via local FFmpeg.
    """
    v_url = video_url.strip() if video_url else ""
    master_path = find_master_source_video(video_id or "", v_url)
    if master_path and master_path.exists():
        size_mb = round(master_path.stat().st_size / (1024 * 1024), 1)
        return {
            "ready": True,
            "video_id": video_id,
            "filename": master_path.name,
            "size_mb": size_mb,
            "download_url": f"/api/download-rendered/{master_path.name}"
        }
    return {
        "ready": False,
        "video_id": video_id,
        "filename": None,
        "size_mb": 0.0
    }


@router.post("/api/prepare-source")
async def handle_prepare_source(req: PrepareSourceRequest, background_tasks: BackgroundTasks):
    """
    Initiates Phase 1: Downloading/acquiring the full master source video (1080p).
    If already cached, completes immediately.
    """
    v_url = req.video_url.strip() if req.video_url else ""
    if req.video_id and (req.video_id.startswith("gdrive_") or req.video_id.startswith("upload_")):
        if not v_url.startswith("/api/video/"):
            v_url = f"/api/video/{req.video_id}"
    elif not v_url:
        if req.video_id:
            v_url = f"https://www.youtube.com/watch?v={req.video_id}"
    elif not v_url.startswith("http") and not v_url.startswith("/api/video/"):
        v_url = f"https://www.youtube.com/watch?v={v_url}"

    existing = find_master_source_video(req.video_id or "", v_url)
    if existing and existing.exists():
        size_mb = round(existing.stat().st_size / (1024 * 1024), 1)
        job_id = f"ready_{str(uuid.uuid4())[:6]}"
        master_source_jobs[job_id] = {
            "job_id": job_id,
            "status": "ready",
            "progress_percent": 100.0,
            "downloaded": f"{size_mb} MB",
            "total": f"{size_mb} MB",
            "speed": "",
            "eta": "",
            "filename": existing.name,
            "error": None
        }
        return {"job_id": job_id, "status": "ready"}

    job_id = str(uuid.uuid4())[:8]
    master_source_jobs[job_id] = {
        "job_id": job_id,
        "status": "starting",
        "progress_percent": 0.0,
        "downloaded": "",
        "total": "",
        "speed": "",
        "eta": "",
        "filename": None,
        "error": None
    }
    background_tasks.add_task(run_master_source_job, job_id, v_url, req.video_id or "", req.cookies)
    return {"job_id": job_id, "status": "starting"}


@router.get("/api/prepare-source-status/{job_id}")
async def get_prepare_source_status(job_id: str):
    job = master_source_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Master source job not found")
    return job


@router.post("/api/download-raw-video")
async def handle_download_raw_video(req: RawVideoDownloadRequest, background_tasks: BackgroundTasks):
    v_url = req.video_url.strip() if req.video_url else ""
    if req.video_id and (req.video_id.startswith("gdrive_") or req.video_id.startswith("upload_")):
        if not v_url.startswith("/api/video/"):
            v_url = f"/api/video/{req.video_id}"
    elif not v_url:
        if req.video_id:
            v_url = f"https://www.youtube.com/watch?v={req.video_id}"
    elif not v_url.startswith("http") and not v_url.startswith("/api/video/"):
        v_url = f"https://www.youtube.com/watch?v={v_url}"

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

    background_tasks.add_task(run_raw_download_job, job_id, v_url, out_path, filename, download_title, req.cookies)
    return {"job_id": job_id, "status": "starting"}


@router.get("/api/download-raw-status/{job_id}")
async def get_raw_download_status(job_id: str):
    job = raw_download_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Download job not found")
    return job


@router.post("/api/download-raw-clip")
async def handle_download_raw_clip(req: RawClipDownloadRequest, background_tasks: BackgroundTasks):
    v_url = req.video_url.strip() if req.video_url else ""
    if req.video_id and (req.video_id.startswith("gdrive_") or req.video_id.startswith("upload_")):
        if not v_url.startswith("/api/video/"):
            v_url = f"/api/video/{req.video_id}"
    elif not v_url:
        if req.video_id:
            v_url = f"https://www.youtube.com/watch?v={req.video_id}"
    elif not v_url.startswith("http") and not v_url.startswith("/api/video/"):
        v_url = f"https://www.youtube.com/watch?v={v_url}"

    job_id = str(uuid.uuid4())[:8]
    clean_title = re.sub(r'[\\/*?:"<>|]', "", (req.title or "clip").strip()) or "clip"
    download_title = f"{clean_title} (raw)"

    raw_clip_download_jobs[job_id] = {
        "job_id": job_id,
        "status": "starting",
        "stage": "Menyiapkan antrean...",
        "current_step": 1,
        "total_steps": 4,
        "step_name": "Ambil Bahan",
        "started_at": time.time(),
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
        req.title,
        req.cookies,
        req.proxy
    )
    return {"job_id": job_id, "status": "starting"}


@router.get("/api/download-raw-clip-status/{job_id}")
async def get_raw_clip_download_status(job_id: str):
    job = raw_clip_download_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Clip download job not found")
    return job
