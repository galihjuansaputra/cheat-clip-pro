from typing import Any, Dict, List, Optional
from pydantic import BaseModel

class RawVideoDownloadRequest(BaseModel):
    video_url: str
    video_id: str
    title: Optional[str] = None
    cookies: Optional[str] = None

class PrepareSourceRequest(BaseModel):
    video_url: Optional[str] = None
    video_id: Optional[str] = None
    cookies: Optional[str] = None
    max_end_time: Optional[float] = None
    clips: Optional[List[Dict[str, Any]]] = None

class RawClipDownloadRequest(BaseModel):
    video_url: str
    video_id: str
    start_time: float
    end_time: float
    title: Optional[str] = None
    cookies: Optional[str] = None
    proxy: Optional[str] = None

class CookiesSaveRequest(BaseModel):
    cookies: Optional[str] = None
    cookies_content: Optional[str] = None
