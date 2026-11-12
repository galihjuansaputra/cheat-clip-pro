import json
import shutil
import sqlite3
from typing import Optional

from backend.config import ROOT_DIR, TEMP_DIR

DB_PATH = ROOT_DIR / ".runtime" / "upload_jobs.sqlite3"
LEGACY_DB_PATH = TEMP_DIR / "upload_jobs.sqlite3"

# The old location was inside TEMP_DIR, so the cleanup daemon eventually
# deleted the upload history. Migrate once to persistent runtime storage.
if not DB_PATH.exists() and LEGACY_DB_PATH.exists():
    try:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(LEGACY_DB_PATH, DB_PATH)
    except OSError:
        pass


def _connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.execute("CREATE TABLE IF NOT EXISTS upload_jobs (job_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)")
    return db


def save_job(job: dict):
    with _connect() as db:
        db.execute("INSERT OR REPLACE INTO upload_jobs(job_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)", (job["job_id"], json.dumps(job)))


def update_job(job_id: str, **changes) -> dict:
    job = get_job(job_id) or {"job_id": job_id}
    job.update(changes)
    save_job(job)
    return job


def get_job(job_id: str) -> Optional[dict]:
    with _connect() as db:
        row = db.execute("SELECT data FROM upload_jobs WHERE job_id = ?", (job_id,)).fetchone()
    return json.loads(row[0]) if row else None


def list_jobs(limit: int = 50) -> list[dict]:
    with _connect() as db:
        rows = db.execute("SELECT data FROM upload_jobs ORDER BY updated_at DESC LIMIT ?", (limit,)).fetchall()
    return [json.loads(row[0]) for row in rows]


def fail_stale_jobs(reason: str) -> int:
    """Mark jobs left mid-flight by a crash/restart as failed.

    Background upload threads do not survive a process restart, so without this
    the UI would show "uploading 5%" forever.
    """
    count = 0
    with _connect() as db:
        rows = db.execute("SELECT job_id, data FROM upload_jobs").fetchall()
        for job_id, raw in rows:
            try:
                job = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if job.get("status") not in ("queued", "uploading", "processing"):
                continue
            job.update({"status": "failed", "progress": 0, "error": reason})
            db.execute(
                "UPDATE upload_jobs SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE job_id = ?",
                (json.dumps(job), job_id),
            )
            count += 1
    return count
