#!/usr/bin/env python3
"""FastAPI dashboard: enter TOTP -> Upstox login -> MongoDB persistence."""
from __future__ import annotations

import logging
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from config import (
    HOST,
    PORT,
    SOURCE,
    TEST_FLAG,
    UPSTOX_API_KEY,
    UPSTOX_PIN,
)
from masking import MASK, sanitize
from mongo_store import TokenStore
from upstox_client import UpstoxClient, UpstoxError

# ----------------------------------------------------------------- logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
)
log = logging.getLogger("upstox-dashboard")

BASE_DIR = Path(__file__).resolve().parent

# ----------------------------------------------------------------- FastAPI
app = FastAPI(title="Upstox TOTP Dashboard", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

# Single TokenStore instance (PyMongo client is thread-safe).
try:
    store = TokenStore()
    log.info("Connected to MongoDB (db=%s, collection=%s)", "UPSTOX_APP_V2", "app_tokens")
except Exception as exc:  # noqa: BLE001
    log.error("Cannot connect to MongoDB: %s", exc)
    store = None  # type: ignore[assignment]


# ----------------------------------------------------------------- models
class LoginRequest(BaseModel):
    totp: str = ""


# ----------------------------------------------------------------- routes
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    # New Starlette signature: TemplateResponse(request, name, context)
    return templates.TemplateResponse(
        request,
        "index.html",
        {"test_flag": TEST_FLAG},
    )


@app.get("/api/status")
def api_status():
    if store is None:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "message": "Database unavailable."},
        )
    try:
        doc = store.get_token_doc()
    except Exception as exc:  # noqa: BLE001
        log.error("Mongo read failed: %s", exc)
        return JSONResponse(
            status_code=503,
            content={"ok": False, "message": "Database error."},
        )

    if not doc:
        return {"ok": True, "data": None, "test_flag": TEST_FLAG}

    doc.pop("_id", None)
    return {
        "ok": True,
        "test_flag": TEST_FLAG,
        "data": sanitize(doc),
    }


@app.post("/api/login")
def api_login(req: LoginRequest):
    # --------------------------------------------------------- validate TOTP
    totp = (req.totp or "").strip().replace(" ", "")
    if not (totp.isdigit() and len(totp) == 6):
        return JSONResponse(
            status_code=400,
            content={"ok": False, "message": "TOTP must be exactly 6 digits."},
        )

    if store is None:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "message": "Database unavailable."},
        )

    log.info("Login attempt received")  # never logs the TOTP value

    # --------------------------------------------------------- Upstox login
    try:
        client = UpstoxClient(UPSTOX_API_KEY, UPSTOX_PIN)
        login_resp = client.login_with_totp(totp)
    except UpstoxError as exc:
        log.warning("Login rejected: %s", str(exc))
        return JSONResponse(
            status_code=400,
            content={"ok": False, "message": str(exc), "code": "LOGIN_FAILED"},
        )
    except Exception:  # noqa: BLE001
        log.exception("Unexpected login error")
        return JSONResponse(
            status_code=500,
            content={"ok": False, "message": "Unexpected server error."},
        )

    access_token = login_resp.get("access_token")
    if not access_token:
        log.warning("Login succeeded but no access_token returned")
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "message": "Upstox response did not contain an access_token.",
            },
        )

    # --------------------------------------------------------- profile check
    profile: dict = {}
    validation_status = "success"
    validation_status_text = "profile_success"
    validation_error: str | None = None

    try:
        profile_resp = client.get_profile(access_token)
        profile = (profile_resp or {}).get("data") or {}
        log.info("Profile validation succeeded")
    except UpstoxError as exc:
        validation_status = "failed"
        validation_status_text = "profile_failed"
        validation_error = str(exc)
        log.warning("Profile validation failed: %s", validation_error)

    # --------------------------------------------------------- persist token
    try:
        store.upsert_token(
            access_token=access_token,
            profile=profile,
            validation_status=validation_status,
            validation_status_text=validation_status_text,
            validation_error=validation_error,
        )
    except Exception:  # noqa: BLE001
        log.exception("Mongo write failed")
        return JSONResponse(
            status_code=503,
            content={"ok": False, "message": "Failed to save token to MongoDB."},
        )

    log.info("Access token saved to MongoDB")  # never logs the token value

    # --------------------------------------------------------- UI response
    # The doc is returned masked when TEST_FLAG is off.
    doc_for_ui = {
        "access_token": access_token,
        "source": SOURCE,
        "last_validation_status": validation_status,
        "last_validation_status_text": validation_status_text,
        "last_validated_at": None,  # filled below via a fresh read
        "last_validation_error": validation_error,
        "last_profile_user_id": profile.get("user_id"),
        "last_profile_user_name": profile.get("user_name"),
        "last_profile_broker": profile.get("broker"),
    }
    # refresh to get accurate timestamps from the DB
    try:
        fresh = store.get_token_doc() or {}
        fresh.pop("_id", None)
        doc_for_ui.update(fresh)
    except Exception:  # noqa: BLE001
        pass

    warning = None
    if validation_status != "success":
        warning = (
            "Token saved, but profile validation failed. "
            "See validation error for details."
        )

    return {
        "ok": True,
        "message": "Access token saved successfully.",
        "warning": warning,
        "test_flag": TEST_FLAG,
        "mask": MASK,
        "data": sanitize(doc_for_ui),
    }


# ----------------------------------------------------------------- entrypoint
def run() -> None:
    log.info(
        "Starting dashboard (TEST_FLAG=%s, source=%s)", TEST_FLAG, SOURCE
    )
    if not TEST_FLAG:
        log.info("TEST_FLAG is OFF — tokens and profile data will be masked.")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    run()