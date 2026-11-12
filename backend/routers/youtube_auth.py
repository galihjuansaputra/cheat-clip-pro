import json
import os
import secrets
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from backend.config import ROOT_DIR, TEMP_DIR

router = APIRouter(prefix="/api/youtube", tags=["YouTube OAuth"])
SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube"]
# state -> PKCE code_verifier. The verifier must survive between /oauth/start
# and /oauth/callback because Google validates the challenge against it.
_oauth_states: dict[str, str] = {}
# Keep the token outside TEMP_DIR: the storage cleanup daemon deletes temp files
# after ~1 hour, which would silently disconnect YouTube.
TOKEN_FILE = ROOT_DIR / ".runtime" / "youtube_oauth_token.bin"
LEGACY_TOKEN_FILE = TEMP_DIR / "youtube_oauth_token.bin"


def _settings():
    client_id = os.environ.get("YOUTUBE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET", "").strip()
    redirect_uri = os.environ.get("YOUTUBE_REDIRECT_URI", "http://localhost:5173/api/youtube/oauth/callback").strip()
    encryption_key = os.environ.get("YOUTUBE_TOKEN_ENCRYPTION_KEY", "").strip()
    if not client_id or not client_secret or not encryption_key:
        raise HTTPException(status_code=503, detail="YouTube OAuth is not configured on the server.")
    try:
        Fernet(encryption_key.encode())
    except Exception as exc:
        raise HTTPException(status_code=500, detail="YOUTUBE_TOKEN_ENCRYPTION_KEY is invalid.") from exc
    return client_id, client_secret, redirect_uri, encryption_key


def _client_config(client_id: str, client_secret: str):
    return {"web": {"client_id": client_id, "client_secret": client_secret, "auth_uri": "https://accounts.google.com/o/oauth2/auth", "token_uri": "https://oauth2.googleapis.com/token"}}


def _load_credentials():
    if not TOKEN_FILE.exists() and LEGACY_TOKEN_FILE.exists():
        try:
            TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
            TOKEN_FILE.write_bytes(LEGACY_TOKEN_FILE.read_bytes())
            LEGACY_TOKEN_FILE.unlink()
        except OSError:
            pass
    if not TOKEN_FILE.exists():
        return None
    _, _, _, key = _settings()
    try:
        from google.oauth2.credentials import Credentials
        raw = Fernet(key.encode()).decrypt(TOKEN_FILE.read_bytes())
        return Credentials.from_authorized_user_info(json.loads(raw), SCOPES)
    except (InvalidToken, OSError, ValueError, json.JSONDecodeError):
        return None


def _save_credentials(credentials, key: str):
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_bytes(Fernet(key.encode()).encrypt(credentials.to_json().encode()))


@router.get("/oauth/start")
def youtube_oauth_start(request: Request):
    client_id, client_secret, redirect_uri, _ = _settings()
    from google_auth_oauthlib.flow import Flow
    state = secrets.token_urlsafe(32)
    flow = Flow.from_client_config(
        _client_config(client_id, client_secret),
        scopes=SCOPES,
        state=state,
        autogenerate_code_verifier=True,
    )
    flow.redirect_uri = redirect_uri
    authorization_url, _ = flow.authorization_url(access_type="offline", include_granted_scopes="true", prompt="consent")
    # google-auth-oauthlib >= 1.5 generates a PKCE verifier by default. Keep it
    # keyed by state so the callback can complete the token exchange.
    if flow.code_verifier:
        # Avoid unbounded growth if a user abandons several consent screens.
        if len(_oauth_states) > 20:
            _oauth_states.clear()
        _oauth_states[state] = flow.code_verifier
    return RedirectResponse(authorization_url)


@router.get("/oauth/callback")
def youtube_oauth_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    if error:
        return RedirectResponse("/?youtube=cancelled")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Invalid YouTube OAuth state.")
    code_verifier = _oauth_states.pop(state, None)
    if code_verifier is None:
        raise HTTPException(status_code=400, detail="Invalid or expired YouTube OAuth state.")
    client_id, client_secret, redirect_uri, encryption_key = _settings()
    from google_auth_oauthlib.flow import Flow
    flow = Flow.from_client_config(_client_config(client_id, client_secret), scopes=SCOPES, state=state)
    flow.redirect_uri = redirect_uri
    flow.fetch_token(code=code, code_verifier=code_verifier)
    _save_credentials(flow.credentials, encryption_key)
    return RedirectResponse("/?youtube=connected")


@router.get("/status")
def youtube_oauth_status():
    try:
        credentials = _load_credentials()
    except HTTPException:
        return {"connected": False, "configured": False}
    if not credentials:
        return {"connected": False, "configured": True}
    if credentials.expired and credentials.refresh_token:
        from google.auth.transport.requests import Request as GoogleRequest
        _, _, _, key = _settings()
        credentials.refresh(GoogleRequest())
        _save_credentials(credentials, key)
    try:
        from googleapiclient.discovery import build
        channel = build("youtube", "v3", credentials=credentials).channels().list(part="snippet", mine=True).execute()
        item = (channel.get("items") or [{}])[0]
        return {"connected": True, "configured": True, "channel_id": item.get("id"), "channel_title": item.get("snippet", {}).get("title", "")}
    except Exception:
        return {"connected": True, "configured": True}


@router.post("/disconnect")
def youtube_oauth_disconnect():
    if TOKEN_FILE.exists():
        TOKEN_FILE.unlink()
    return {"connected": False}
