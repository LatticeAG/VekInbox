from __future__ import annotations

import re
import time
from typing import Any, Optional

import httpx

from vekinbox.types import CreateRequestInput, ListRequestsResponse, Request
from vekinbox.webhooks import verify_webhook_signature

DEFAULT_BASE_URL = "https://api.vekinbox.latticeag.com/v1"

_DURATION_RE = re.compile(r"^(\d+)(ms|s|m|h|d)$")
_DURATION_MULTIPLIERS = {
    "ms": 1,
    "s": 1_000,
    "m": 60_000,
    "h": 3_600_000,
    "d": 86_400_000,
}


class VekInboxApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


def _parse_duration_ms(duration: str) -> int:
    match = _DURATION_RE.match(duration.strip())
    if not match:
        raise ValueError(f"Invalid duration: {duration}")
    value = int(match.group(1))
    unit = match.group(2)
    return value * _DURATION_MULTIPLIERS[unit]


class RequestsClient:
    def __init__(self, client: "VekInbox") -> None:
        self._client = client

    def create(self, input: CreateRequestInput) -> Request:
        data = self._client._request("POST", "/requests", json=input.to_api())
        return Request.from_api(data)

    def get(self, request_id: str) -> Request:
        data = self._client._request("GET", f"/requests/{request_id}")
        return Request.from_api(data)

    def list(
        self,
        *,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        agent_id: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> ListRequestsResponse:
        params: dict[str, Any] = {}
        if status is not None:
            params["status"] = status
        if priority is not None:
            params["priority"] = priority
        if agent_id is not None:
            params["agent_id"] = agent_id
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = limit

        data = self._client._request("GET", "/requests", params=params)
        return ListRequestsResponse(
            data=[Request.from_api(item) for item in data.get("data", [])],
            cursor=data.get("cursor") or data.get("next_cursor"),
        )

    def cancel(self, request_id: str, *, reason: Optional[str] = None) -> Request:
        body = {"reason": reason} if reason else {}
        data = self._client._request("POST", f"/requests/{request_id}/cancel", json=body)
        return Request.from_api(data)

    def wait_for_resolution(
        self,
        request_id: str,
        *,
        timeout: str = "1h",
        poll_interval: float = 2.0,
    ) -> Request:
        deadline = time.time() + _parse_duration_ms(timeout) / 1000
        while time.time() < deadline:
            request = self.get(request_id)
            if request.status not in ("pending", "escalated"):
                return request
            time.sleep(poll_interval)
        raise TimeoutError(f"Timed out waiting for request {request_id} to resolve")


class VekInbox:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._http = httpx.Client(
            base_url=self._base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
            },
            timeout=timeout,
        )
        self.requests = RequestsClient(self)
        self.webhooks = type(
            "Webhooks",
            (),
            {"verify": staticmethod(verify_webhook_signature)},
        )()

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        response = self._http.request(method, path, json=json, params=params)
        if response.status_code >= 400:
            try:
                body = response.json()
                error = body.get("error", {})
                raise VekInboxApiError(
                    response.status_code,
                    error.get("code", "unknown"),
                    error.get("message", response.text),
                )
            except (ValueError, AttributeError):
                raise VekInboxApiError(
                    response.status_code,
                    "unknown",
                    response.text,
                ) from None
        if not response.content:
            return {}
        return response.json()

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "VekInbox":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
