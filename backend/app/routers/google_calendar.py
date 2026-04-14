from __future__ import annotations

import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.repo import get_google_refresh_token, save_google_refresh_token
from app.schemas import FreeBusyInterval, FreeBusyResponse

router = APIRouter(prefix="/api/google", tags=["google"])

FREE_BUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy"

# Demo-only CSRF state store (single-process). For production use Redis + short TTL.
_oauth_state_issued_at: dict[str, float] = {}
_STATE_TTL_SEC = 600


def _cleanup_states() -> None:
    now = time.time()
    dead = [s for s, t in _oauth_state_issued_at.items() if now - t > _STATE_TTL_SEC]
    for s in dead:
        _oauth_state_issued_at.pop(s, None)


def _access_token_from_refresh(refresh_token: str) -> str:
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(status_code=503, detail="google_oauth_not_configured")
    data = {
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    with httpx.Client(timeout=30) as client:
        r = client.post("https://oauth2.googleapis.com/token", data=data)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="google_token_refresh_failed")
    payload = r.json()
    token = payload.get("access_token")
    if not token:
        raise HTTPException(status_code=502, detail="google_token_missing")
    return str(token)


@router.get("/status")
def google_status(db: Session = Depends(get_db)) -> dict[str, bool]:
    return {"connected": bool(get_google_refresh_token(db))}


@router.get("/oauth/start")
def google_oauth_start() -> RedirectResponse:
    if not settings.google_client_id or not settings.google_redirect_uri:
        raise HTTPException(status_code=503, detail="google_oauth_not_configured")
    _cleanup_states()
    state = secrets.token_urlsafe(32)
    _oauth_state_issued_at[state] = time.time()
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": FREE_BUSY_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    return RedirectResponse(url)


@router.get("/oauth/callback")
def google_oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    if error:
        return RedirectResponse(f"{settings.frontend_url}/availability?google=error&message={error}")
    if not code or not state:
        raise HTTPException(status_code=400, detail="missing_code_or_state")
    _cleanup_states()
    if state not in _oauth_state_issued_at:
        raise HTTPException(status_code=400, detail="invalid_state")
    _oauth_state_issued_at.pop(state, None)

    if not settings.google_client_secret:
        raise HTTPException(status_code=503, detail="google_oauth_not_configured")

    data = {
        "code": code,
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uri": settings.google_redirect_uri,
        "grant_type": "authorization_code",
    }
    with httpx.Client(timeout=30) as client:
        r = client.post("https://oauth2.googleapis.com/token", data=data)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="google_code_exchange_failed")
    payload: dict[str, Any] = r.json()
    refresh = payload.get("refresh_token")
    if refresh:
        save_google_refresh_token(db, str(refresh))
    return RedirectResponse(f"{settings.frontend_url}/availability?google=connected")


@router.post("/freebusy", response_model=FreeBusyResponse)
def google_freebusy(db: Session = Depends(get_db)) -> FreeBusyResponse:
    rt = get_google_refresh_token(db)
    if not rt:
        raise HTTPException(status_code=400, detail="google_not_connected")
    access = _access_token_from_refresh(rt)
    now = datetime.now(timezone.utc)
    time_min = now.isoformat().replace("+00:00", "Z")
    time_max = (now + timedelta(days=5)).isoformat().replace("+00:00", "Z")
    body = {
        "timeMin": time_min,
        "timeMax": time_max,
        "items": [{"id": "primary"}],
    }
    headers = {"Authorization": f"Bearer {access}", "Content-Type": "application/json"}
    with httpx.Client(timeout=30) as client:
        r = client.post(
            "https://www.googleapis.com/calendar/v3/freeBusy",
            json=body,
            headers=headers,
        )
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="google_freebusy_failed")
    data = r.json()
    cal = (data.get("calendars") or {}).get("primary") or {}
    busy_raw = cal.get("busy") or []
    busy: list[FreeBusyInterval] = []
    for row in busy_raw:
        try:
            busy.append(
                FreeBusyInterval(
                    start=datetime.fromisoformat(str(row["start"]).replace("Z", "+00:00")),
                    end=datetime.fromisoformat(str(row["end"]).replace("Z", "+00:00")),
                )
            )
        except Exception:
            continue
    return FreeBusyResponse(busy=busy)
