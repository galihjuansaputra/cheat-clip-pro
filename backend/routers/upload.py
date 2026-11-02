import os
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from backend.services.upload_service import (
    build_youtube_auth_url,
    exchange_youtube_code,
    save_token,
    get_token,
    delete_token,
    build_tiktok_auth_url,
    exchange_tiktok_code,
    create_job,
    get_job,
    suggest_time,
)
import os
from backend.config import EXPORTS_DIR
from backend.services.render_service import RENDER_BATCHES

router = APIRouter(tags=["Upload"])


def _frontend_url() -> str:
    return os.environ.get("FRONTEND_URL", "http://localhost:5173")


# ---------- YouTube OAuth ----------
@router.get("/api/upload/youtube/connect")
def youtube_connect():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    redirect_uri = os.environ.get("YOUTUBE_REDIRECT_URI", "http://localhost:8000/api/upload/youtube/callback")
    if not client_id:
        raise HTTPException(status_code=400, detail="YOUTUBE_CLIENT_ID not set")
    state = uuid.uuid4().hex
    url = build_youtube_auth_url(client_id, redirect_uri, state)
    return {"auth_url": url}


@router.get("/api/upload/youtube/callback")
def youtube_callback(code: str, state: Optional[str] = None):
    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET")
    redirect_uri = os.environ.get("YOUTUBE_REDIRECT_URI", "http://localhost:8000/api/upload/youtube/callback")
    token = exchange_youtube_code(client_id, client_secret, redirect_uri, code)
    save_token("youtube", token)
    return RedirectResponse(url=f"{_frontend_url()}/?upload=youtube_connected")


@router.get("/api/upload/youtube/status")
def youtube_status():
    t = get_token("youtube")
    return {"connected": bool(t), "has_refresh": bool(t and t.get("refresh_token"))}


@router.post("/api/upload/youtube/disconnect")
def youtube_disconnect():
    delete_token("youtube")
    return {"status": "disconnected"}


# ---------- TikTok OAuth ----------
@router.get("/api/upload/tiktok/connect")
def tiktok_connect():
    client_key = os.environ.get("TIKTOK_CLIENT_KEY")
    redirect_uri = os.environ.get("TIKTOK_REDIRECT_URI", "http://localhost:8000/api/upload/tiktok/callback")
    if not client_key:
        raise HTTPException(status_code=400, detail="TIKTOK_CLIENT_KEY not set")
    state = uuid.uuid4().hex
    url = build_tiktok_auth_url(client_key, redirect_uri, state)
    return {"auth_url": url}


@router.get("/api/upload/tiktok/callback")
def tiktok_callback(code: str, state: Optional[str] = None):
    client_key = os.environ.get("TIKTOK_CLIENT_KEY")
    client_secret = os.environ.get("TIKTOK_CLIENT_SECRET")
    redirect_uri = os.environ.get("TIKTOK_REDIRECT_URI", "http://localhost:8000/api/upload/tiktok/callback")
    token = exchange_tiktok_code(client_key, client_secret, redirect_uri, code)
    save_token("tiktok", token)
    return RedirectResponse(url=f"{_frontend_url()}/?upload=tiktok_connected")


@router.get("/api/upload/tiktok/status")
def tiktok_status():
    t = get_token("tiktok")
    return {"connected": bool(t)}


@router.post("/api/upload/tiktok/disconnect")
def tiktok_disconnect():
    delete_token("tiktok")
    return {"status": "disconnected"}


# ---------- Upload job ----------
@router.post("/api/upload")
def start_upload(body: dict):
    platform = body.get("platform")
    if platform not in ("youtube", "tiktok"):
        raise HTTPException(status_code=400, detail="platform must be youtube or tiktok")

    # resolve file path
    file_path = body.get("file_path")
    batch_id = body.get("batch_id")
    clip_index = body.get("clip_index")
    if not file_path and batch_id and clip_index is not None:
        batch = RENDER_BATCHES.get(batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="batch not found")
        clips = batch.get("clips", [])
        if clip_index < 0 or clip_index >= len(clips):
            raise HTTPException(status_code=404, detail="clip not found")
        c = clips[clip_index]
        file_path = c.get("output_path")
        if not file_path and c.get("download_url"):
            fname = c["download_url"].split("/")[-1]
            file_path = str(__import__("pathlib").Path(__file__).resolve().parent.parent.parent / "exports" / fname)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="rendered file not found")

    metadata = {
        "title": body.get("title", "Clip"),
        "description": body.get("description", ""),
        "tags": body.get("tags", []),
        "privacy": body.get("privacy", "unlisted" if platform == "youtube" else "SELF_ONLY"),
    }
    scheduled_at = body.get("scheduled_at")
    job_id = create_job(platform, file_path, metadata, scheduled_at)
    return {"job_id": job_id, "status": "scheduled" if scheduled_at else "queued"}


@router.get("/api/upload/status/{job_id}")
def upload_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.get("/api/upload/suggest-time/{platform}")
def suggest_upload_time(platform: str):
    return {"platform": platform, "suggestion": suggest_time(platform)}


@router.get("/api/rendered-clips")
def list_rendered_clips():
    items = []
    if EXPORTS_DIR.exists():
        for p in sorted(EXPORTS_DIR.glob("*.mp4"), key=lambda x: x.stat().st_mtime, reverse=True)[:50]:
            items.append({"name": p.name, "path": str(p), "modified": p.stat().st_mtime})
    return {"clips": items}