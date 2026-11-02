import asyncio
import base64
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import requests

from backend.config import logger, EXPORTS_DIR

TOKEN_STORE_PATH = Path(__file__).resolve().parent.parent / "data" / "upload_tokens.json"
JOBS: Dict[str, Dict[str, Any]] = {}


def _ensure_store_dir():
    TOKEN_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)


def _load_tokens() -> Dict[str, Any]:
    _ensure_store_dir()
    if not TOKEN_STORE_PATH.exists():
        return {}
    try:
        return json.loads(TOKEN_STORE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_tokens(data: Dict[str, Any]):
    _ensure_store_dir()
    # shortcut: plaintext JSON for local MVP; encrypt before production
    TOKEN_STORE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_token(platform: str) -> Optional[Dict[str, Any]]:
    return _load_tokens().get(platform)


def save_token(platform: str, token: Dict[str, Any]):
    data = _load_tokens()
    data[platform] = token
    _save_tokens(data)


def delete_token(platform: str):
    data = _load_tokens()
    data.pop(platform, None)
    _save_tokens(data)


def build_youtube_auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    scope = "https://www.googleapis.com/auth/youtube.upload"
    return (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={client_id}"
        f"&redirect_uri={requests.utils.quote(redirect_uri, safe='')}"
        f"&response_type=code"
        f"&scope={requests.utils.quote(scope, safe='')}"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&state={state}"
    )


def exchange_youtube_code(client_id: str, client_secret: str, redirect_uri: str, code: str) -> Dict[str, Any]:
    resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    if "refresh_token" not in data:
        # keep existing refresh token if present
        existing = get_token("youtube") or {}
        if existing.get("refresh_token"):
            data["refresh_token"] = existing["refresh_token"]
    data["obtained_at"] = time.time()
    return data


def refresh_youtube_token(client_id: str, client_secret: str, refresh_token: str) -> Dict[str, Any]:
    resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    data["refresh_token"] = refresh_token
    data["obtained_at"] = time.time()
    return data


def get_youtube_access_token() -> str:
    token = get_token("youtube")
    if not token:
        raise RuntimeError("YouTube not connected")
    client_id = os.environ.get("YOUTUBE_CLIENT_ID")
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET")
    # refresh if expired (5 min buffer)
    if time.time() - token.get("obtained_at", 0) > token.get("expires_in", 3600) - 300:
        token = refresh_youtube_token(client_id, client_secret, token["refresh_token"])
        save_token("youtube", token)
    return token["access_token"]


def youtube_upload(file_path: str, title: str, description: str, privacy: str, tags: list) -> str:
    access_token = get_youtube_access_token()
    file_size = os.path.getsize(file_path)
    metadata = {
        "snippet": {
            "title": title[:100],
            "description": description[:5000],
            "tags": tags[:500],
            "categoryId": "22",
        },
        "status": {"privacyStatus": privacy},
    }
    # init resumable upload
    init_resp = requests.post(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": str(file_size),
            "X-Upload-Content-Type": "video/mp4",
        },
        json=metadata,
        timeout=30,
    )
    init_resp.raise_for_status()
    upload_url = init_resp.headers.get("Location")
    if not upload_url:
        raise RuntimeError("No upload URL returned")
    with open(file_path, "rb") as f:
        data = f.read()
    up_resp = requests.put(
        upload_url,
        headers={
            "Content-Type": "video/mp4",
            "Content-Length": str(file_size),
        },
        data=data,
        timeout=600,
    )
    up_resp.raise_for_status()
    result = up_resp.json()
    return result.get("id", "")


# ---------- TikTok ----------
def build_tiktok_auth_url(client_key: str, redirect_uri: str, state: str) -> str:
    scope = "video.upload,video.publish"
    return (
        "https://www.tiktok.com/v2/auth/authorize/"
        f"?client_key={client_key}"
        f"&scope={requests.utils.quote(scope, safe='')}"
        f"&response_type=code"
        f"&redirect_uri={requests.utils.quote(redirect_uri, safe='')}"
        f"&state={state}"
    )


def exchange_tiktok_code(client_key: str, client_secret: str, redirect_uri: str, code: str) -> Dict[str, Any]:
    resp = requests.post(
        "https://open.tiktokapis.com/v2/oauth/token/",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "client_key": client_key,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    data["obtained_at"] = time.time()
    return data


def get_tiktok_access_token() -> str:
    token = get_token("tiktok")
    if not token:
        raise RuntimeError("TikTok not connected")
    # refresh if needed
    if time.time() - token.get("obtained_at", 0) > token.get("expires_in", 86400) - 300:
        resp = requests.post(
            "https://open.tiktokapis.com/v2/oauth/token/",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "client_key": os.environ.get("TIKTOK_CLIENT_KEY"),
                "client_secret": os.environ.get("TIKTOK_CLIENT_SECRET"),
                "grant_type": "refresh_token",
                "refresh_token": token.get("refresh_token"),
            },
            timeout=30,
        )
        resp.raise_for_status()
        token = resp.json()
        token["obtained_at"] = time.time()
        save_token("tiktok", token)
    return token["access_token"]


def tiktok_upload(file_path: str, title: str, privacy: str) -> str:
    access_token = get_tiktok_access_token()
    # creator info
    ci = requests.post(
        "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json; charset=UTF-8"},
        json={},
        timeout=30,
    )
    ci.raise_for_status()
    creator = ci.json().get("data", {})
    max_dur = creator.get("max_video_post_duration_sec", 300)
    import os as _os
    # duration check skipped (would need ffprobe); rely on platform
    # init upload (inbox)
    init = requests.post(
        "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json; charset=UTF-8"},
        json={
            "post_info": {
                "title": title[:2200],
                "privacy_level": privacy,
                "disable_duet": False,
                "disable_comment": False,
                "disable_stitch": False,
            },
            "source_info": {
                "source": "FILE_UPLOAD",
                "video_size": os.path.getsize(file_path),
                "chunk_size": os.path.getsize(file_path),
                "total_chunk_count": 1,
            },
        },
        timeout=30,
    )
    init.raise_for_status()
    data = init.json().get("data", {})
    upload_url = data.get("upload_url")
    publish_id = data.get("publish_id")
    if not upload_url:
        raise RuntimeError("No TikTok upload URL")
    with open(file_path, "rb") as f:
        content = f.read()
    up = requests.put(
        upload_url,
        headers={"Content-Type": "video/mp4", "Content-Range": f"bytes 0-{len(content)-1}/{len(content)}"},
        data=content,
        timeout=600,
    )
    up.raise_for_status()
    return publish_id or ""


# ---------- Scheduling ----------
def suggest_time(platform: str) -> str:
    # static suggestions based on research (local time)
    if platform == "youtube":
        return "Upload 1-3 jam sebelum peak audience (cek YouTube Studio Heatmap). Untuk Shorts: Thu-Sat sore."
    if platform == "tiktok":
        return "Tue-Thu 14:00-18:00 (lokal audiens), 30-60 menit sebelum peak."
    return "N/A"


def create_job(platform: str, file_path: str, metadata: Dict[str, Any], scheduled_at: Optional[str] = None) -> str:
    job_id = f"up_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    JOBS[job_id] = {
        "job_id": job_id,
        "platform": platform,
        "file_path": file_path,
        "metadata": metadata,
        "status": "scheduled" if scheduled_at else "queued",
        "scheduled_at": scheduled_at,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "result": None,
        "error": None,
    }
    if not scheduled_at:
        asyncio.ensure_future(_run_job(job_id))
    return job_id


async def _run_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return
    job["status"] = "uploading"
    try:
        if job["platform"] == "youtube":
            vid = await asyncio.to_thread(
                youtube_upload,
                job["file_path"],
                job["metadata"].get("title", "Clip"),
                job["metadata"].get("description", ""),
                job["metadata"].get("privacy", "unlisted"),
                job["metadata"].get("tags", []),
            )
            job["result"] = {"video_id": vid, "url": f"https://youtu.be/{vid}"}
        elif job["platform"] == "tiktok":
            pid = await asyncio.to_thread(
                tiktok_upload,
                job["file_path"],
                job["metadata"].get("title", "Clip"),
                job["metadata"].get("privacy", "SELF_ONLY"),
            )
            job["result"] = {"publish_id": pid}
        job["status"] = "completed"
    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)


async def scheduler_loop():
    while True:
        now = datetime.now(timezone.utc)
        for jid, job in list(JOBS.items()):
            if job["status"] == "scheduled" and job.get("scheduled_at"):
                try:
                    when = datetime.fromisoformat(job["scheduled_at"].replace("Z", "+00:00"))
                    if when <= now:
                        job["status"] = "queued"
                        asyncio.ensure_future(_run_job(jid))
                except Exception:
                    pass
        await asyncio.sleep(30)


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    return JOBS.get(job_id)