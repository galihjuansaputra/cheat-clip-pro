import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Initialize environment and configuration
import backend.config
from backend.config import logger
from backend.routers import (
    analyze_router,
    cookies_router,
    downloads_router,
    media_router,
    render_router,
    system_router,
)
# Re-exports for backwards compatibility
from backend.schemas.analyze import (
    AnalyzeRequest,
    AnalyzeResponse,
    HeatmapPoint,
    TranscriptLine,
    VideoAnalysis,
    ViralClip,
    ViralClipGemini,
)
from backend.schemas.downloads import (
    CookiesSaveRequest,
    RawClipDownloadRequest,
    RawVideoDownloadRequest,
)
from backend.schemas.render import (
    RenderBatchRequest,
    RenderSettingsModel,
    RetryBatchRequest,
)
from backend.services.download_service import (
    raw_clip_download_jobs,
    raw_download_jobs,
)
from backend.services.render_service import (
    BATCH_REQUESTS,
    RENDER_BATCHES,
)

# Initialize FastAPI Application
app = FastAPI(
    title="CHEAT CLIP PRO API",
    description="High-performance backend API for Cheat Clip Pro auto-clipper and video studio",
    version="2.0.0"
)

# CORS middleware for development and production web frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Modular Routers
app.include_router(analyze_router)
app.include_router(render_router)
app.include_router(media_router)
app.include_router(cookies_router)
app.include_router(downloads_router)
app.include_router(system_router)

logger.info("Cheat Clip PRO backend routers mounted successfully.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
