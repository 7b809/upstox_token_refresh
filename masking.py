"""Masking helpers.

Rule:
  - TEST_FLAG = True  -> values pass through unchanged (useful for local dev).
  - TEST_FLAG = False -> every sensitive value is fully replaced with the
                        placeholder `********`. NEVER partial masking.
"""
from __future__ import annotations

from typing import Any

from config import TEST_FLAG

MASK = "********"

# Keys (case-insensitive) that must be masked whenever TEST_FLAG is off.
SENSITIVE_KEYS: set[str] = {
    "access_token",
    "extended_token",
    "totp",
    "pin",
    "email",
    "user_id",
    "user_name",
    "last_profile_user_id",
    "last_profile_user_name",
    "last_profile_broker",
}


def mask(value: Any) -> Any:
    """Return the value when TEST_FLAG is on, otherwise the full mask."""
    if TEST_FLAG:
        return value
    if value is None:
        return None
    return MASK


def sanitize(data: Any) -> Any:
    """Recursively mask sensitive keys inside dicts / lists."""
    if TEST_FLAG:
        return data
    if isinstance(data, dict):
        out: dict[Any, Any] = {}
        for k, v in data.items():
            if isinstance(k, str) and k.lower() in SENSITIVE_KEYS:
                out[k] = MASK if v is not None else None
            else:
                out[k] = sanitize(v)
        return out
    if isinstance(data, list):
        return [sanitize(x) for x in data]
    return data


def safe_log(value: Any) -> Any:
    """For logging — only returns the real value when TEST_FLAG is on."""
    if TEST_FLAG:
        return value
    return MASK if value is not None else None