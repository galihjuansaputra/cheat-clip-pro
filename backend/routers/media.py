import asyncio
import logging
import os
import re
import uuid
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from backend.config import (
    EXPORTS_DIR,
    TEMP_DIR,
    UPLOADS_DIR,
    detect_speaker_face_box,
    extract_clip_frame,
    is_valid_mp4,
    logger,
)

router = APIRouter(tags=["Media"])


@router.post("/api/upload-bgm")
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


@router.get("/api/audio/{file_name}")
def get_audio_file(file_name: str):
    clean_name = os.path.basename(file_name)
    file_path = UPLOADS_DIR / clean_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    media_type = "audio/mpeg" if clean_name.endswith(".mp3") else "audio/wav" if clean_name.endswith(".wav") else "application/octet-stream"
    return FileResponse(file_path, media_type=media_type, filename=clean_name)


@router.post("/api/upload-sfx")
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


@router.post("/api/upload-watermark")
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


@router.get("/api/watermark/{file_name}")
def get_watermark_file(file_name: str):
    clean_name = os.path.basename(file_name)
    file_path = UPLOADS_DIR / clean_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Watermark file not found")
    media_type = "image/png" if clean_name.endswith(".png") else "image/jpeg" if (clean_name.endswith(".jpg") or clean_name.endswith(".jpeg")) else "image/webp"
    return FileResponse(file_path, media_type=media_type, filename=clean_name)


@router.get("/api/clip-frame")
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


@router.get("/api/detect-face")
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
