from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

RequestStatus = Literal[
    "pending",
    "approved",
    "declined",
    "timed_out",
    "escalated",
    "cancelled",
    "changes_requested",
]

RequestPriority = Literal["low", "normal", "high", "critical"]


@dataclass
class ResolutionPayload:
    action: str
    note: Optional[str] = None
    payload: Optional[dict[str, Any]] = None


@dataclass
class Request:
    id: str
    key: str
    title: str
    workspace_id: str
    agent_id: str
    status: RequestStatus
    priority: RequestPriority
    created_at: str
    updated_at: str
    description: str = ""
    actions: list[dict[str, Any]] = field(default_factory=list)
    default_action: Optional[str] = None
    timeout_at: Optional[str] = None
    escalation_policy_id: Optional[str] = None
    resume_webhook_url: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)
    labels: list[str] = field(default_factory=list)
    resolved_by: Optional[str] = None
    resolved_at: Optional[str] = None
    resolution_payload: Optional[ResolutionPayload] = None

    @classmethod
    def from_api(cls, data: dict[str, Any]) -> "Request":
        resolution = data.get("resolution_payload")
        resolution_payload = None
        if isinstance(resolution, dict):
            resolution_payload = ResolutionPayload(
                action=str(resolution.get("action", "")),
                note=resolution.get("note"),
                payload=resolution.get("payload"),
            )

        return cls(
            id=data["id"],
            key=data["key"],
            title=data["title"],
            workspace_id=data["workspace_id"],
            agent_id=data["agent_id"],
            status=data["status"],
            priority=data.get("priority", "normal"),
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            description=data.get("description", ""),
            actions=data.get("actions") or [],
            default_action=data.get("default_action"),
            timeout_at=data.get("timeout_at"),
            escalation_policy_id=data.get("escalation_policy_id"),
            resume_webhook_url=data.get("resume_webhook_url"),
            metadata=data.get("metadata") or {},
            labels=data.get("labels") or [],
            resolved_by=data.get("resolved_by"),
            resolved_at=data.get("resolved_at"),
            resolution_payload=resolution_payload,
        )


@dataclass
class CreateRequestInput:
    workspace_id: str
    key: str
    title: str
    description: str = ""
    priority: RequestPriority = "normal"
    actions: Optional[list[str]] = None
    default_action: Optional[str] = None
    timeout: Optional[str] = None
    escalation_policy_id: Optional[str] = None
    resume_webhook: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    labels: Optional[list[str]] = None
    assignees: Optional[list[str]] = None

    def to_api(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "workspace_id": self.workspace_id,
            "key": self.key,
            "title": self.title,
            "description": self.description,
            "priority": self.priority,
        }
        if self.actions is not None:
            body["actions"] = self.actions
        if self.default_action is not None:
            body["default_action"] = self.default_action
        if self.timeout is not None:
            body["timeout_at"] = self.timeout
        if self.escalation_policy_id is not None:
            body["escalation_policy_id"] = self.escalation_policy_id
        if self.resume_webhook is not None:
            body["resume_webhook_url"] = self.resume_webhook
        if self.metadata is not None:
            body["metadata"] = self.metadata
        if self.labels is not None:
            body["labels"] = self.labels
        if self.assignees is not None:
            body["assignees"] = self.assignees
        return body


@dataclass
class ListRequestsResponse:
    data: list[Request]
    cursor: Optional[str] = None
