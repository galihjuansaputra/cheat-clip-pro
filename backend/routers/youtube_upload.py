import json
import logging
import mimetypes
import secrets
import socket
import threading
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from backend.config import TEMP_DIR
from backend.routers.youtube_auth import _load_credentials, _save_credentials, _settings
from backend.security import mask_sensitive_text
from backend.services.upload_store import get_job, list_jobs, save_job, update_job

router = APIRouter(prefix="/api/youtube", tags=["YouTube Upload"])
UPLOAD_JOBS: dict[str, dict] = {}
logger = logging.getLogger("cheat-clip-pro.youtube")

# Upload only one video at a time. Parallel uploads compete for the same
# outbound bandwidth and make every transfer slower and more likely to time out.
UPLOAD_LOCK = threading.Lock()

# The default googleapiclient chunk is 100 MB, so a 30 MB clip shows no progress
# until the whole file has been sent. Smaller chunks give real progress and let
# a stalled transfer fail/retry sooner.
UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024
RETRYABLE_STATUS = {429, 500, 502, 503, 504}
MAX_UPLOAD_RETRIES = 5


def _build_youtube(credentials):
    import httplib2
    from google_auth_httplib2 import AuthorizedHttp
    from googleapiclient.discovery import build

    # Without an explicit timeout an interrupted Google connection can hang
    # forever at 5%, which is exactly what the old build did.
    raw_http = httplib2.Http(timeout=120)
    # httplib2 >= 0.32 treats 308 as a redirect and requires a Location header.
    # Google resumable uploads return "308 Resume Incomplete" WITHOUT Location
    # for every unfinished chunk, which raised:
    #   "Redirected but the response is missing a Location: header."
    # googleapiclient removes 308 from its own http object, so do the same here.
    raw_http.redirect_codes = raw_http.redirect_codes - {308}
    http = AuthorizedHttp(credentials, http=raw_http)
    return build("youtube", "v3", http=http, cache_discovery=False)


def _friendly_upload_error(exc: Exception) -> str:
    text = str(exc)
    lowered = text.lower()
    if "quotaexceeded" in lowered or "quota exceeded" in lowered:
        return (
            "Kuota YouTube Data API harian habis. Satu upload memakai 1.600 unit "
            "dari 10.000 unit/hari, jadi maksimal sekitar 6 upload per hari per "
            "project OAuth. Coba lagi besok atau pakai project OAuth lain."
        )
    if "uploadlimitexceeded" in lowered or "exceeded the number of videos" in lowered:
        return (
            "Channel ini sudah mencapai batas jumlah video yang boleh diupload "
            "YouTube untuk sementara. Coba lagi nanti atau besok."
        )
    return mask_sensitive_text(text)[:500]


@router.get("/playlists")
def youtube_playlists():
    credentials = _load_credentials()
    if not credentials:
        raise HTTPException(status_code=401, detail="Connect a YouTube channel first.")
    result = _build_youtube(credentials).playlists().list(part="snippet", mine=True, maxResults=50).execute()
    return {"playlists": [{"id": item["id"], "title": item["snippet"]["title"]} for item in result.get("items", [])]}


def _close_media(media) -> None:
    """Release the file handle MediaFileUpload keeps open (Windows file lock)."""
    if media is None:
        return
    fd = getattr(media, "_fd", None)
    if fd is not None:
        try:
            fd.close()
        except Exception:
            pass


def _safe_unlink(path: Optional[Path]) -> None:
    if not path:
        return
    for _ in range(10):
        try:
            path.unlink(missing_ok=True)
            return
        except PermissionError:
            time.sleep(0.3)
        except OSError:
            return


async def _save_upload(upload: UploadFile, path: Path):
    with path.open("wb") as target:
        while chunk := await upload.read(1024 * 1024):
            target.write(chunk)


def _run_upload(job_id: str, video_path: Path, thumbnail_path: Optional[Path], metadata: dict):
    # Queued uploads wait here instead of running all at once.
    if UPLOAD_LOCK.locked():
        update_job(job_id, status="queued", progress=0, note="Menunggu upload lain selesai...")
        logger.info(f"[YouTube] Job {job_id} queued behind another upload")
    with UPLOAD_LOCK:
        media = None
        thumb_media = None
        try:
            update_job(job_id, status="uploading", progress=5, note="Menghubungi YouTube...")
            credentials = _load_credentials()
            if not credentials:
                raise RuntimeError("YouTube channel is not connected")
            if credentials.expired and credentials.refresh_token:
                from google.auth.transport.requests import Request as GoogleRequest
                _, _, _, key = _settings()
                credentials.refresh(GoogleRequest())
                _save_credentials(credentials, key)

            from googleapiclient.http import MediaFileUpload

            youtube = _build_youtube(credentials)
            body = {
                "snippet": {
                    "title": str(metadata.get("title", "Untitled Clip"))[:100],
                    "description": str(metadata.get("description", ""))[:5000],
                    "tags": metadata.get("tags", [])[:500],
                    "categoryId": str(metadata.get("category_id", "22")),
                },
                "status": {
                    "privacyStatus": metadata.get("privacy_status", "private"),
                    "selfDeclaredMadeForKids": bool(metadata.get("made_for_kids", False)),
                },
            }
            if metadata.get("publish_at"):
                body["status"]["privacyStatus"] = "private"
                body["status"]["publishAt"] = metadata["publish_at"]

            media = MediaFileUpload(
                str(video_path),
                mimetype="video/mp4",
                resumable=True,
                chunksize=UPLOAD_CHUNK_SIZE,
            )
            request = youtube.videos().insert(
                part="snippet,status",
                body=body,
                media_body=media,
            )

            response = None
            retries = 0
            while response is None:
                try:
                    progress, response = request.next_chunk()
                    retries = 0
                except Exception as exc:
                    status = getattr(getattr(exc, "resp", None), "status", 0)
                    retryable = status in RETRYABLE_STATUS or isinstance(
                        exc,
                        (socket.timeout, TimeoutError, ConnectionError, OSError),
                    )
                    if not retryable or retries >= MAX_UPLOAD_RETRIES:
                        raise
                    retries += 1
                    delay = min(30, 2 ** retries)
                    logger.warning(
                        f"[YouTube] Upload {job_id} interrupted (attempt {retries}/{MAX_UPLOAD_RETRIES}): {exc}. "
                        f"Retrying in {delay}s..."
                    )
                    update_job(
                        job_id,
                        status="uploading",
                        progress=5,
                        note=f"Koneksi terputus, mencoba ulang ({retries}/{MAX_UPLOAD_RETRIES})...",
                    )
                    time.sleep(delay)
                    continue

                if progress:
                    pct = min(95, max(5, int(progress.progress() * 90 + 5)))
                    update_job(job_id, progress=pct, note=f"Mengunggah... {pct}%")
                    logger.info(f"[YouTube] Upload {job_id} progress {pct}%")

            video_id = response["id"]
            video_url = f"https://youtu.be/{video_id}"
            update_job(
                job_id,
                status="processing",
                progress=98,
                video_id=video_id,
                url=video_url,
                note="Upload selesai, memproses metadata...",
            )

            warnings = []
            if thumbnail_path:
                try:
                    thumb_media = MediaFileUpload(
                        str(thumbnail_path),
                        mimetype=mimetypes.guess_type(thumbnail_path.name)[0] or "image/jpeg",
                    )
                    youtube.thumbnails().set(videoId=video_id, media_body=thumb_media).execute()
                except Exception as exc:
                    warnings.append(f"Thumbnail gagal: {_friendly_upload_error(exc)}")
                finally:
                    _close_media(thumb_media)
                    thumb_media = None

            playlist_id = metadata.get("playlist_id")
            if playlist_id:
                try:
                    youtube.playlistItems().insert(
                        part="snippet",
                        body={
                            "snippet": {
                                "playlistId": playlist_id,
                                "resourceId": {"kind": "youtube#video", "videoId": video_id},
                            }
                        },
                    ).execute()
                except Exception as exc:
                    warnings.append(f"Playlist gagal: {_friendly_upload_error(exc)}")

            update_job(
                job_id,
                status="completed",
                progress=100,
                video_id=video_id,
                url=video_url,
                note=None,
                warning="; ".join(warnings) if warnings else None,
            )
            logger.info(f"[YouTube] Upload {job_id} completed: {video_url}")
        except Exception as exc:
            logger.error(f"[YouTube] Upload {job_id} failed: {exc}")
            update_job(job_id, status="failed", progress=0, note=None, error=_friendly_upload_error(exc))
        finally:
            # MediaFileUpload keeps the file descriptor open, which blocks
            # deletion on Windows and previously raised WinError 32 in the
            # background task.
            _close_media(media)
            media = None
            _safe_unlink(video_path)
            _safe_unlink(thumbnail_path)


@router.post("/upload")
async def queue_youtube_upload(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    metadata: str = Form(...),
    thumbnail: Optional[UploadFile] = File(None),
):
    try:
        parsed = json.loads(metadata)
        if not isinstance(parsed, dict) or not parsed.get("title"):
            raise ValueError("metadata.title is required")
        if not _load_credentials():
            raise HTTPException(status_code=401, detail="Connect a YouTube channel first.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid upload metadata: {exc}") from exc

    job_id = secrets.token_urlsafe(12)
    video_path = TEMP_DIR / f"youtube_upload_{job_id}.mp4"
    thumb_path = TEMP_DIR / f"youtube_thumbnail_{job_id}"
    await _save_upload(video, video_path)
    saved_thumb = None
    if thumbnail:
        saved_thumb = thumb_path.with_suffix(Path(thumbnail.filename or ".jpg").suffix or ".jpg")
        await _save_upload(thumbnail, saved_thumb)
    UPLOAD_JOBS[job_id] = {"job_id": job_id, "title": str(parsed.get("title", "YouTube clip")), "status": "queued", "progress": 0}
    save_job(UPLOAD_JOBS[job_id])
    background_tasks.add_task(_run_upload, job_id, video_path, saved_thumb, parsed)
    return UPLOAD_JOBS[job_id]


@router.get("/upload/{job_id}")
def youtube_upload_status(job_id: str):
    job = get_job(job_id) or UPLOAD_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    return job


@router.get("/upload-history")
def youtube_upload_history():
    return {"jobs": list_jobs()}
