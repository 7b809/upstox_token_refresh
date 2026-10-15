# Upstox TOTP Dashboard

A tiny, professional dashboard that:

1. takes **only** a 6-digit TOTP from the browser,
2. exchanges it (with your API key + PIN) for an Upstox access token,
3. validates it by calling `/v2/user/profile`,
4. upserts a single MongoDB document with id `upstox_access_token`
   in `UPSTOX_APP_V2.app_tokens`,
5. shows a toast notification on success.

When `TEST_FLAG=false` (the default), tokens and profile data are **fully
masked** — in logs and in the UI. Nothing sensitive is ever printed, not even
partially.

---

## 1. Install

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt