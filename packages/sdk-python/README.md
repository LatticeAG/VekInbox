# VekInbox Python SDK

Python client for [VekInbox](https://github.com/LatticeAG/VekInbox) — durable human approval queue for AI agents.

## Install

```bash
cd packages/sdk-python
pip install -e .
```

## Usage

```python
import os
from vekinbox import VekInbox
from vekinbox.types import CreateRequestInput

inbox = VekInbox(
    api_key=os.environ["VEKINBOX_API_KEY"],
    base_url="http://localhost:3001/v1",
)

request = inbox.requests.create(
    CreateRequestInput(
        workspace_id="ws_...",
        key="invoice.pay.001",
        title="Approve $450 invoice payment?",
        resume_webhook="https://my-agent.example.com/resume",
        metadata={"invoice_id": 1024},
    )
)

result = inbox.requests.wait_for_resolution(request.id, timeout="1h")
if result.status == "approved":
    print("Approved — proceeding")

# Verify incoming resume webhooks
valid = inbox.webhooks.verify(headers, raw_body, webhook_secret)
```

## API

Mirrors the TypeScript SDK:

- `requests.create(input)` — create an approval request (idempotent by `key`)
- `requests.get(id)` — fetch a request
- `requests.list(**filters)` — list requests
- `requests.cancel(id)` — cancel a pending request
- `requests.wait_for_resolution(id, timeout="1h")` — poll until resolved
- `webhooks.verify(headers, raw_body, secret)` — verify signed resume webhooks

## License

MIT
