import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Body, File, Form, HTTPException, Query, UploadFile

from backend.config import EXPORTS_DIR, logger
from backend.services.app_store import (
    clear_analysis_entries,
    delete_analysis_entry,
    delete_render_batch,
    get_analysis_entry,
    get_app_settings,
    list_analysis_entries,
    list_render_batches,
    save_analysis_entry,
    save_app_settings,
    save_render_batch,
)

router = APIRouter(tags=["History"])


def _history_entry(row: dict) -> dict:
    """Convert a stored analysis row into the shape consumed by the UI."""
    data = row.get("data") or {}
    video_id = row.get("video_id") or data.get("video_id") or ""
    is_gdrive = data.get("source_type") == "gdrive" or video_id.startswith("gdrive_")
    is_upload = data.get("source_type") == "upload" or video_id.startswith("upload_")
    source_type = "gdrive" if is_gdrive else ("upload" if is_upload else "youtube")

    if is_gdrive:
        match = re.search(r"gdrive_([a-zA-Z0-9_-]+)", video_id)
        item_url = (
            f"https://drive.google.com/file/d/{match.group(1)}/view"
            if match
            else (data.get("video_url") or "")
        )
    elif is_upload:
        item_url = data.get("video_url") or f"/api/video/{video_id}"
    else:
        item_url = f"https://www.youtube.com/watch?v={video_id}"

    thumbnail = (
        f"/api/frame/{quote(video_id)}?t=2"
        if (is_gdrive or is_upload)
        else f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg"
    )

    clips = data.get("clips") or []
    return {
        "cache_key": row.get("cache_key", ""),
        "video_id": video_id,
        "title": data.get("title") or video_id,
        "duration_pref": row.get("duration_pref") or "",
        "clip_count": len(clips),
        "analyzed_at": row.get("analyzed_at") or "",
        "thumbnail": thumbnail,
        "url": item_url,
        "source_type": source_type,
        "video_url": data.get("video_url"),
        "range_suffix": row.get("range_suffix") or "",
        "summary": data.get("summary") or "",
        "clip_titles": [c.get("title") or "" for c in clips if c.get("title")],
        "key_quotes": [q for c in clips for q in (c.get("key_quotes") or []) if q],
    }


@router.post("/api/analysis-cache")
def save_analysis_cache(payload: dict = Body(...)):
    cache_key = str(payload.get("cache_key") or "").strip()
    data = payload.get("data")
    if not cache_key or not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="cache_key and data are required")
    save_analysis_entry(
        cache_key=cache_key,
        video_id=str(payload.get("video_id") or data.get("video_id") or ""),
        analyzed_at=str(payload.get("analyzed_at") or ""),
        duration_pref=str(payload.get("duration_pref") or ""),
        range_suffix=str(payload.get("range_suffix") or ""),
        data=data,
    )
    return {"ok": True}


@router.get("/api/analysis-cache")
def list_analysis_cache(limit: int = 200):
    rows = list_analysis_entries(limit=limit)
    return {"entries": [_history_entry(row) for row in rows]}


@router.get("/api/analysis-cache/entry")
def read_analysis_cache(cache_key: str):
    row = get_analysis_entry(cache_key)
    if not row:
        raise HTTPException(status_code=404, detail="Analysis cache entry not found")
    return {"cache_key": row["cache_key"], "analyzed_at": row["analyzed_at"], "data": row["data"]}


@router.delete("/api/analysis-cache")
def remove_all_analysis_cache():
    clear_analysis_entries()
    return {"ok": True}


@router.delete("/api/analysis-cache/entry")
def remove_analysis_cache(cache_key: str):
    delete_analysis_entry(cache_key)
    return {"ok": True}


_RECOVERED_EXPORTS = False


def _recover_orphan_exports():
    """Import MP4 files left in EXPORTS_DIR without a render-history row.

    Older builds rendered files but did not persist their batch metadata. This
    keeps those exports visible (and downloadable) instead of forcing a rerender.
    """
    global _RECOVERED_EXPORTS
    if _RECOVERED_EXPORTS:
        return
    _RECOVERED_EXPORTS = True
    try:
        existing = list_render_batches(limit=10000)
        referenced = set()
        for batch in existing:
            for clip in batch.get("clips") or []:
                url = clip.get("download_url") or ""
                name = url.split("?")[0].split("/")[-1]
                if name:
                    referenced.add(name)

        groups: dict[str, list[tuple[str, int, Path]]] = {}
        for file_path in EXPORTS_DIR.glob("*.mp4"):
            if file_path.name in referenced:
                continue
            # Raw download segments and other intermediate files are not
            # finished exports and must not appear in the render history.
            if "_raw" in file_path.stem.lower():
                continue
            stem = file_path.stem
            parts = stem.rsplit("_", 2)
            if len(parts) != 3 or not parts[1].isdigit():
                continue
            title, index_text, suffix = parts
            clip_index = int(index_text)
            groups.setdefault(suffix, []).append((title, clip_index, file_path))

        for suffix, items in groups.items():
            entries = []
            timestamps = []
            for title, clip_index, file_path in sorted(items, key=lambda item: (item[1], item[0])):
                try:
                    timestamps.append(file_path.stat().st_mtime)
                except OSError:
                    timestamps.append(time.time())
                entries.append({
                    "clip_index": len(entries),
                    "source_index": max(0, clip_index - 1),
                    "title": title,
                    "base_title": title,
                    "status": "completed",
                    "progress_percent": 100,
                    "download_url": f"/api/download-rendered/{quote(file_path.name)}?title={quote(title)}",
                })
            if not entries:
                continue
            created_at = datetime.fromtimestamp(min(timestamps), tz=timezone.utc).isoformat()
            save_render_batch({
                "batch_id": f"recovered_{suffix}",
                "video_id": "",
                "total_clips": len(entries),
                "current_clip_index": len(entries) - 1,
                "overall_status": "completed",
                "clips": entries,
                "recovered": True,
                "created_at": created_at,
            })
    except Exception as exc:
        logger.warning(f"Failed to recover orphan rendered exports: {exc}")


@router.get("/api/render-history")
def get_render_history(limit: int = 20, video_id: Optional[str] = Query(default=None)):
    _recover_orphan_exports()
    batches = list_render_batches(limit=limit)
    if video_id:
        batches = [batch for batch in batches if batch.get("video_id") == video_id]
    return {"batches": batches}


@router.delete("/api/render-history/{batch_id}")
def remove_render_history(batch_id: str):
    delete_render_batch(batch_id)
    return {"ok": True}


@router.post("/api/render-history")
def persist_render_history(batch: dict = Body(...)):
    """Persist a render batch created outside the server renderer (client-side engine)."""
    batch_id = str(batch.get("batch_id") or "").strip()
    if not batch_id:
        raise HTTPException(status_code=400, detail="batch_id is required")
    save_render_batch(batch)
    return {"ok": True}


@router.post("/api/render-history/client-clip")
async def save_client_rendered_clip(
    video: UploadFile = File(...),
    batch_id: str = Form(...),
    video_id: str = Form(""),
    clip_index: int = Form(0),
    source_index: int = Form(0),
    title: str = Form("clip"),
    base_title: str = Form(""),
):
    """Store a browser-rendered MP4 in EXPORTS_DIR and return a durable URL."""
    safe_title = re.sub(r'[\\/*?:"<>|]', "", (base_title or title or "")).strip()
    safe_title = re.sub(r"\s+", " ", safe_title).strip(".")[:70] or f"clip_{clip_index + 1}"
    suffix = re.sub(r"[^a-zA-Z0-9_-]", "", batch_id[-8:]) or "client"
    filename = f"{safe_title}_{clip_index + 1}_{suffix}.mp4"
    dest = EXPORTS_DIR / os.path.basename(filename)
    dest.parent.mkdir(parents=True, exist_ok=True)

    try:
        with dest.open("wb") as output:
            while True:
                chunk = await video.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to store rendered clip: {exc}") from exc
    finally:
        await video.close()

    if not dest.exists() or dest.stat().st_size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Rendered clip upload was empty")

    display_name = (base_title or title or safe_title).strip() or safe_title
    return {
        "file_name": dest.name,
        "download_url": f"/api/download-rendered/{quote(dest.name)}?title={quote(display_name)}",
        "source_index": source_index,
        "video_id": video_id,
    }


@router.get("/api/app-settings")
def read_app_settings():
    return {"settings": get_app_settings()}


@router.put("/api/app-settings")
def update_app_settings(payload: dict = Body(...)):
    incoming = payload.get("settings")
    if not isinstance(incoming, dict):
        raise HTTPException(status_code=400, detail="settings object is required")
    save_app_settings(incoming)
    return {"ok": True, "settings": get_app_settings()}
