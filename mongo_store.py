"""MongoDB persistence for the Upstox access-token document."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo import MongoClient, ReturnDocument
from pymongo.errors import PyMongoError

from config import (
    MONGO_COLLECTION,
    MONGO_DB,
    MONGO_URI,
    SOURCE,
    TOKEN_DOC_ID,
)

IST = timezone(timedelta(hours=5, minutes=30))


def now_ist_iso() -> str:
    """ISO-8601 timestamp in IST, e.g. 2026-10-15T06:28:26.714170+05:30."""
    return datetime.now(IST).isoformat()


class TokenStore:
    """Wraps the `app_tokens` collection."""

    def __init__(self) -> None:
        self.client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        self.col = self.client[MONGO_DB][MONGO_COLLECTION]
        # Ping early so startup fails loudly on a bad URI.
        self.client.admin.command("ping")

    # ------------------------------------------------------------------ writes
    def upsert_token(
        self,
        access_token: str,
        *,
        profile: dict[str, Any] | None = None,
        validation_status: str = "success",
        validation_status_text: str = "profile_success",
        validation_error: str | None = None,
    ) -> dict[str, Any]:
        """Insert or update the single token document."""
        now = now_ist_iso()
        profile = profile or {}

        doc = {
            "access_token": access_token,
            "updated_at": now,
            "source": SOURCE,
            "last_validation_status": validation_status,
            "last_validation_status_text": validation_status_text,
            "last_validated_at": now,
            "last_validation_error": validation_error,
            "last_profile_user_id": profile.get("user_id"),
            "last_profile_user_name": profile.get("user_name"),
            "last_profile_broker": profile.get("broker"),
        }

        self.col.update_one(
            {"_id": TOKEN_DOC_ID},
            {
                "$set": doc,
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
        return self.col.find_one({"_id": TOKEN_DOC_ID}) or {}

    # ------------------------------------------------------------------ reads
    def get_token_doc(self) -> dict[str, Any] | None:
        return self.col.find_one({"_id": TOKEN_DOC_ID})