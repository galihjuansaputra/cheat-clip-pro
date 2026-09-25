import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

from backend.config import (
    COOKIES_PATH,
    ROOT_COOKIES_PATH,
    get_effective_cookies_path,
    logger,
)
from backend.schemas.downloads import CookiesSaveRequest

router = APIRouter(tags=["Cookies"])


@router.post("/api/cookies")
def save_youtube_cookies(req: CookiesSaveRequest):
    content = (req.cookies_content or req.cookies or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Cookies content cannot be empty")
    try:
        with open(COOKIES_PATH, "w", encoding="utf-8") as f:
            f.write(content)
        try:
            with open(ROOT_COOKIES_PATH, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception:
            pass
        return {
            "success": True,
            "status": "saved",
            "exists": True,
            "has_cookies": True,
            "size": len(content)
        }
    except Exception as e:
        logger.error(f"Failed to save cookies: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/cookies")
def get_youtube_cookies_status():
    eff = get_effective_cookies_path()
    if eff:
        sample_lines = []
        cookies_content = ""
        try:
            with open(eff, "r", encoding="utf-8", errors="ignore") as f:
                cookies_content = f.read()
                for line in cookies_content.splitlines():
                    line = line.strip()
                    if line and not line.startswith("#"):
                        parts = line.split("\t")
                        if parts and len(parts) > 0:
                            domain = parts[0]
                            if domain not in sample_lines:
                                sample_lines.append(domain)
                            if len(sample_lines) >= 6:
                                break
        except Exception:
            pass
        return {
            "exists": True,
            "has_cookies": True,
            "size": eff.stat().st_size,
            "sample_lines": sample_lines,
            "cookies_content": cookies_content
        }
    return {"exists": False, "has_cookies": False, "size": 0, "sample_lines": [], "cookies_content": ""}


@router.delete("/api/cookies")
def delete_youtube_cookies():
    for p in [COOKIES_PATH, ROOT_COOKIES_PATH]:
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass
    return {"success": True, "status": "deleted", "exists": False, "has_cookies": False}
