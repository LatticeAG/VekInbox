from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any, Mapping, Optional

WEBHOOK_SIGNATURE_HEADER = "x-vekinbox-signature"
WEBHOOK_TIMESTAMP_HEADER = "x-vekinbox-timestamp"
WEBHOOK_MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000


def _get_header(headers: Mapping[str, str], name: str) -> Optional[str]:
    lower = name.lower()
    for key, value in headers.items():
        if key.lower() == lower:
            return value
    return None


def verify_webhook_signature(
    headers: Mapping[str, str],
    raw_body: str | bytes,
    secret: str,
) -> bool:
    """Verify an incoming VekInbox resume webhook signature."""
    signature = _get_header(headers, WEBHOOK_SIGNATURE_HEADER)
    timestamp = _get_header(headers, WEBHOOK_TIMESTAMP_HEADER)

    if not signature or not timestamp:
        return False

    try:
        ts = int(timestamp)
    except ValueError:
        return False

    skew = abs(int(time.time() * 1000) - ts * 1000)
    if skew > WEBHOOK_MAX_TIMESTAMP_SKEW_MS:
        return False

    body = raw_body.decode("utf-8") if isinstance(raw_body, bytes) else raw_body
    signed_payload = f"{timestamp}.{body}"
    expected = hmac.new(
        secret.encode("utf-8"),
        signed_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    provided = signature[7:] if signature.startswith("sha256=") else signature

    return hmac.compare_digest(provided, expected)
