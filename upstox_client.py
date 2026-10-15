"""Thin client for the Upstox TOTP-login and profile endpoints."""
from __future__ import annotations

from typing import Any

import requests

from config import UPSTOX_PROFILE_URL, UPSTOX_TOTP_URL


class UpstoxError(Exception):
    """Raised for any non-200 response or transport error from Upstox."""


class UpstoxClient:
    def __init__(self, api_key: str, pin: str, timeout: int = 30):
        if not api_key:
            raise UpstoxError("UPSTOX_API_KEY is not configured")
        if not pin:
            raise UpstoxError("UPSTOX_PIN is not configured")
        self.api_key = api_key
        self.pin = pin
        self.timeout = timeout

    # ------------------------------------------------------------------ login
    def login_with_totp(self, totp: str) -> dict[str, Any]:
        headers = {
            "accept": "application/json",
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
        }
        payload = {"totp": totp, "pin": self.pin}
        try:
            r = requests.post(
                UPSTOX_TOTP_URL,
                headers=headers,
                json=payload,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise UpstoxError(f"Network error contacting Upstox: {exc}") from exc

        if r.status_code != 200:
            raise UpstoxError(self._format_error(r))
        return r.json()

    # ---------------------------------------------------------------- profile
    def get_profile(self, access_token: str) -> dict[str, Any]:
        headers = {
            "accept": "application/json",
            "Authorization": f"Bearer {access_token}",
        }
        try:
            r = requests.get(
                UPSTOX_PROFILE_URL, headers=headers, timeout=self.timeout
            )
        except requests.RequestException as exc:
            raise UpstoxError(f"Network error contacting Upstox: {exc}") from exc

        if r.status_code != 200:
            raise UpstoxError(self._format_error(r))
        return r.json()

    # ----------------------------------------------------------------- helpers
    @staticmethod
    def _format_error(response: requests.Response) -> str:
        try:
            body = response.json()
            errors = body.get("errors") or []
            if errors and isinstance(errors, list):
                first = errors[0]
                code = first.get("errorCode") or first.get("error_code") or "?"
                msg = first.get("message") or response.text
                return f"HTTP {response.status_code} [{code}]: {msg}"
            return f"HTTP {response.status_code}: {response.text}"
        except ValueError:
            return f"HTTP {response.status_code}: {response.text}"