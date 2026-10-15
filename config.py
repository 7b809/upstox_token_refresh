"""Central configuration loaded from environment variables."""
from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv()

# --------------------------------------------------------------- test flag
def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "y", "on")


TEST_FLAG: bool = _bool(os.getenv("TEST_FLAG"), default=False)

# --------------------------------------------------------------- Upstox
UPSTOX_API_KEY: str = os.getenv("UPSTOX_API_KEY", "").strip()
UPSTOX_PIN: str = os.getenv("UPSTOX_PIN", "").strip()
UPSTOX_TOTP_URL = "https://api.upstox.com/v2/totp-login/authorization/token"
UPSTOX_PROFILE_URL = "https://api.upstox.com/v2/user/profile"

# --------------------------------------------------------------- MongoDB
MONGO_URI: str = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB: str = os.getenv("MONGO_DB", "UPSTOX_APP_V2")
MONGO_COLLECTION: str = os.getenv("MONGO_COLLECTION", "app_tokens")

TOKEN_DOC_ID: str = "upstox_access_token"
SOURCE: str = os.getenv("SOURCE", "dashboard").strip() or "dashboard"

# --------------------------------------------------------------- server
HOST: str = os.getenv("HOST", "127.0.0.1")
PORT: int = int(os.getenv("PORT", "8000"))