import os
import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from backend.config import EXPORTS_DIR, logger
from backend.services.render_service import RENDER_BATCHES
from backend.services.upload_service import (
    build_youtube_auth_url,
    exchange_youtube_code,
    save_token,
    get_token,
    delete_token,
    create_job,
    get_job,
    suggest_time,
)

try:
    from google import genai
except Exception:
    genai = None

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


# ---------- Upload job ----------
@router.post("/api/upload")
def start_upload(body: dict):
    platform = body.get("platform", "youtube")
    if platform != "youtube":
        raise HTTPException(status_code=400, detail="Only YouTube auto-upload is supported. For TikTok, download and upload manually.")

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
            file_path = str(Path(__file__).resolve().parent.parent.parent / "exports" / fname) if False else os.path.join(os.path.dirname(__file__), "..", "..", "exports", fname)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="rendered file not found")

    metadata = {
        "title": body.get("title", "Clip"),
        "description": body.get("description", ""),
        "tags": body.get("tags", []),
        "privacy": body.get("privacy", "unlisted"),
    }
    scheduled_at = body.get("scheduled_at")
    job_id = create_job("youtube", file_path, metadata, scheduled_at)
    return {"job_id": job_id, "status": "scheduled" if scheduled_at else "queued"}


@router.get("/api/upload/status/{job_id}")
def upload_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.get("/api/upload/suggest-time/youtube")
def suggest_upload_time():
    return {"platform": "youtube", "suggestion": suggest_time("youtube")}


@router.get("/api/rendered-clips")
def list_rendered_clips():
    items = []
    if EXPORTS_DIR.exists():
        for p in sorted(EXPORTS_DIR.glob("*.mp4"), key=lambda x: x.stat().st_mtime, reverse=True)[:50]:
            items.append({"name": p.name, "path": str(p), "modified": p.stat().st_mtime})
    return {"clips": items}


@router.post("/api/ai-metadata")
def ai_metadata(body: dict):
    api_key = (body.get("api_key") or os.environ.get("GEMINI_API_KEY") or "").strip()
    title = body.get("title", "")
    transcript = body.get("transcript", "")
    if not api_key or api_key.lower() == "mock":
        return {
            "title": title or "Highlight Clip",
            "description": (transcript or "")[:200],
            "tags": ["shorts", "clip", "viral"],
            "privacy": "unlisted",
        }
    if genai is None:
        raise HTTPException(status_code=500, detail="google-genai not installed")
    try:
        client = genai.Client(api_key=api_key)
        prompt = (
            "Generate social media upload metadata for a short video clip. "
            f"Platform: youtube. Source title: {title}. Transcript excerpt: {transcript[:1500]}. "
            "Return ONLY JSON with keys: title (<=90 chars), description (<=300 chars), "
            "tags (array of 5-8 short hashtags without #), privacy (one of: public, unlisted, private)."
        )
        resp = client.models.generate_content(model="gemini-2.0-flash", contents=prompt)
        text = resp.text or ""
        import re as _re
        m = _re.search(r"\{.*\}", text, _re.S)
        if m:
            data = json.loads(m.group(0))
        else:
            data = {}
        return {
            "title": data.get("title", title or "Highlight Clip"),
            "description": data.get("description", (transcript or "")[:200]),
            "tags": data.get("tags", ["shorts", "clip", "viral"]),
            "privacy": data.get("privacy", "unlisted"),
        }
    except Exception as e:
        logger.error(f"ai-metadata failed: {e}")
        return {
            "title": title or "Highlight Clip",
            "description": (transcript or "")[:200],
            "tags": ["shorts", "clip", "viral"],
            "privacy": "unlisted",
        }