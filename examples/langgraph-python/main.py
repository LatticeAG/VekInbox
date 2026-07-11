"""
LangGraph-style approval flow example.

Requires: pip install -e packages/sdk-python
Env: VEKINBOX_API_KEY, VEKINBOX_WORKSPACE_ID
"""

from __future__ import annotations

import os
import sys

from vekinbox import VekInbox
from vekinbox.types import CreateRequestInput


class HumanDeclinedError(Exception):
    pass


def risky_tool_node(run_id: str, tool_name: str, tool_args: dict) -> dict:
    """Simulate a LangGraph node that gates a risky tool behind human approval."""
    inbox = VekInbox(
        api_key=os.environ["VEKINBOX_API_KEY"],
        base_url=os.environ.get("VEKINBOX_BASE_URL", "http://localhost:3001/v1"),
    )

    workspace_id = os.environ["VEKINBOX_WORKSPACE_ID"]
    req = inbox.requests.create(
        CreateRequestInput(
            workspace_id=workspace_id,
            key=f"tool.{run_id}",
            title=f"Approve {tool_name}?",
            metadata=tool_args,
            resume_webhook=os.environ.get("AGENT_RESUME_URL"),
        )
    )

    print(f"Created approval request {req.id} — waiting for reviewer...")
    result = inbox.requests.wait_for_resolution(req.id, timeout="30m")

    if result.status != "approved":
        raise HumanDeclinedError(f"Human declined or timed out: {result.status}")

    print(f"Approved — executing {tool_name} with {tool_args}")
    return {"tool_result": f"executed:{tool_name}", "args": tool_args}


if __name__ == "__main__":
    if not os.environ.get("VEKINBOX_API_KEY") or not os.environ.get("VEKINBOX_WORKSPACE_ID"):
        print("Set VEKINBOX_API_KEY and VEKINBOX_WORKSPACE_ID", file=sys.stderr)
        sys.exit(1)

    outcome = risky_tool_node(
        run_id="demo-run-001",
        tool_name="send_email",
        tool_args={"to": "finance@example.com", "subject": "Q2 report"},
    )
    print(outcome)
