import json
import sqlite3
from datetime import datetime, timezone
from typing import Optional

from backend.config import ROOT_DIR

# Persistent application state. Kept outside TEMP_DIR so the storage cleanup
# daemon never removes history after the temp TTL expires.
DB_PATH = ROOT_DIR / ".runtime" / "app_state.sqlite3"


def _connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        "CREATE TABLE IF NOT EXISTS analysis_cache ("
        "cache_key TEXT PRIMARY KEY, video_id TEXT, analyzed_at TEXT, "
        "duration_pref TEXT, range_suffix TEXT, data TEXT NOT NULL)"
    )
    db.execute(
        "CREATE TABLE IF NOT EXISTS render_batches ("
        "batch_id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, data TEXT NOT NULL)"
    )
    db.execute(
        "CREATE TABLE IF NOT EXISTS app_settings ("
        "key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)"
    )
    return db


def save_analysis_entry(
    cache_key: str,
    video_id: str,
    analyzed_at: str,
    duration_pref: str,
    range_suffix: str,
    data: dict,
):
    with _connect() as db:
        db.execute(
            "INSERT OR REPLACE INTO analysis_cache"
            "(cache_key, video_id, analyzed_at, duration_pref, range_suffix, data) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (cache_key, video_id, analyzed_at, duration_pref, range_suffix, json.dumps(data)),
        )


def list_analysis_entries(limit: int = 200) -> list[dict]:
    with _connect() as db:
        rows = db.execute(
            "SELECT cache_key, video_id, analyzed_at, duration_pref, range_suffix, data "
            "FROM analysis_cache ORDER BY analyzed_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {
            "cache_key": row[0],
            "video_id": row[1],
            "analyzed_at": row[2],
            "duration_pref": row[3] or "",
            "range_suffix": row[4] or "",
            "data": json.loads(row[5]),
        }
        for row in rows
    ]


def get_analysis_entry(cache_key: str) -> Optional[dict]:
    with _connect() as db:
        row = db.execute(
            "SELECT cache_key, video_id, analyzed_at, duration_pref, range_suffix, data "
            "FROM analysis_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
    if not row:
        return None
    return {
        "cache_key": row[0],
        "video_id": row[1],
        "analyzed_at": row[2],
        "duration_pref": row[3] or "",
        "range_suffix": row[4] or "",
        "data": json.loads(row[5]),
    }


def delete_analysis_entry(cache_key: str):
    with _connect() as db:
        db.execute("DELETE FROM analysis_cache WHERE cache_key = ?", (cache_key,))


def clear_analysis_entries():
    with _connect() as db:
        db.execute("DELETE FROM analysis_cache")


def save_render_batch(batch: dict):
    now = datetime.now(timezone.utc).isoformat()
    created_at = batch.get("created_at") or now
    payload = dict(batch)
    payload["created_at"] = created_at
    payload["updated_at"] = now
    with _connect() as db:
        db.execute(
            "INSERT OR REPLACE INTO render_batches(batch_id, created_at, updated_at, data) "
            "VALUES (?, ?, ?, ?)",
            (batch["batch_id"], created_at, now, json.dumps(payload)),
        )


def list_render_batches(limit: int = 20) -> list[dict]:
    with _connect() as db:
        rows = db.execute(
            "SELECT data FROM render_batches ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [json.loads(row[0]) for row in rows]


def get_render_batch(batch_id: str) -> Optional[dict]:
    with _connect() as db:
        row = db.execute(
            "SELECT data FROM render_batches WHERE batch_id = ?", (batch_id,)
        ).fetchone()
    return json.loads(row[0]) if row else None


def delete_render_batch(batch_id: str):
    with _connect() as db:
        db.execute("DELETE FROM render_batches WHERE batch_id = ?", (batch_id,))


def get_app_settings() -> dict:
    with _connect() as db:
        rows = db.execute("SELECT key, value FROM app_settings").fetchall()
    settings: dict = {}
    for key, value in rows:
        try:
            settings[key] = json.loads(value)
        except (TypeError, ValueError):
            settings[key] = value
    return settings


def save_app_settings(settings: dict):
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as db:
        for key, value in settings.items():
            db.execute(
                "INSERT OR REPLACE INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)",
                (str(key), json.dumps(value), now),
            )
