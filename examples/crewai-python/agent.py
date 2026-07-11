"""
CrewAI-style agent example with VekInbox approval gate.

Requires: pip install -e packages/sdk-python
Env: VEKINBOX_API_KEY, VEKINBOX_WORKSPACE_ID
"""

from __future__ import annotations

import os

from vekinbox import VekInbox
from vekinbox.types import CreateRequestInput


def deploy_tool(environment: str, version: str) -> str:
    """Simulate a CrewAI tool that requires human approval before deploy."""
    inbox = VekInbox(
        api_key=os.environ["VEKINBOX_API_KEY"],
        base_url=os.environ.get("VEKINBOX_BASE_URL", "http://localhost:3001/v1"),
    )

    req = inbox.requests.create(
        CreateRequestInput(
            workspace_id=os.environ["VEKINBOX_WORKSPACE_ID"],
            key=f"deploy.{environment}.{version}",
            title=f"Deploy v{version} to {environment}?",
            metadata={"environment": environment, "version": version},
            priority="critical",
        )
    )

    result = inbox.requests.wait_for_resolution(req.id, timeout="2h")
    if result.status != "approved":
        return f"Deploy blocked: {result.status}"

    return f"Deployed v{version} to {environment}"


if __name__ == "__main__":
    print(deploy_tool("staging", "1.2.0"))
