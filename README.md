# VekInbox

**Durable human approval queue for AI agents.** Open-source (MIT), self-hostable, with an optional managed SaaS from [LatticeAG](https://latticeag.com).

Agents submit approval requests, humans review in a web inbox (or Slack/email), and agents resume via signed webhooks or SDK polling.

## Quick start (Docker Compose, ~5 min)

```bash
git clone https://github.com/LatticeAG/VekInbox.git
cd VekInbox
cp .env.example .env

docker compose up --build
```

Open **http://localhost:3001/health** — API is ready when `{"status":"ok"}`.

On first start (`EMPTY_DB=true`), the entrypoint seeds demo data and prints an API key to the logs:

```bash
docker compose logs api | grep "API Key"
```

Save that key — it is shown only once.

| Service       | URL                        |
|---------------|----------------------------|
| API           | http://localhost:3001/v1   |
| Health        | http://localhost:3001/health |
| Mailcatcher   | http://localhost:1080      |
| Postgres      | localhost:5432             |
| Redis         | localhost:6379             |

## SDK example (TypeScript)

```bash
npm install @latticeag/vekinbox
```

```typescript
import { VekInbox } from "@latticeag/vekinbox";

const inbox = new VekInbox({
  apiKey: process.env.VEKINBOX_API_KEY!,
  baseUrl: "http://localhost:3001/v1",
});

const request = await inbox.requests.create({
  workspaceId: "ws_...",
  agentId: "agent_...",
  key: "invoice.pay.001",
  title: "Approve $450 invoice payment?",
  resumeWebhook: "https://my-agent.example.com/resume",
});

const result = await inbox.requests.waitForResolution(request.id, { timeout: "1h" });
if (result.status === "approved") {
  console.log("Approved — proceeding");
}
```

## Python SDK

```bash
cd packages/sdk-python
pip install -e .
```

```python
from vekinbox import VekInbox
from vekinbox.types import CreateRequestInput

inbox = VekInbox(api_key="vk_live_...", base_url="http://localhost:3001/v1")
req = inbox.requests.create(CreateRequestInput(
    workspace_id="ws_...",
    key="deploy.prod.001",
    title="Deploy to production?",
))
result = inbox.requests.wait_for_resolution(req.id, timeout="1h")
```

See [packages/sdk-python/README.md](packages/sdk-python/README.md).

## CLI

```bash
npm install -g @latticeag/vekinbox-cli

# Session + optional API key (stored in ~/.vekinbox/)
vekinbox auth login --email admin@localhost --api-key vk_live_... --workspace ws_...
vekinbox auth status

# Workspaces & agents (session auth)
vekinbox workspace create --name "My Workspace"
vekinbox workspace list
vekinbox agent create --name "Payments Agent"
vekinbox agent key create agent_...

# Policies & channels
vekinbox policy list
vekinbox policy create --name "Default" --steps '[{"delay_ms":3600000,"notify":{}}]'
vekinbox channel list
vekinbox channel add --name "Ops Email" --type email

# Requests (API key to create/cancel; session to resolve)
vekinbox request create --title "Deploy?" --key "deploy.001" --agent agent_...
vekinbox request list --status pending
vekinbox request show req_...
vekinbox request resolve req_... --action approve --note "LGTM"
vekinbox request cancel req_...

# Local webhook receiver with signature verification
vekinbox dev --forward-to http://localhost:3000/resume --port 4040 --secret whsec_...
```

## Framework examples

| Example | Path | Description |
|---------|------|-------------|
| LangGraph (Python) | [examples/langgraph-python/](examples/langgraph-python/) | Approval gate before risky tool |
| OpenAI Agents (TS) | [examples/openai-agents-ts/](examples/openai-agents-ts/) | Tool with `waitForResolution` |
| CrewAI (Python) | [examples/crewai-python/](examples/crewai-python/) | Deploy tool with approval |

## Worker

Background jobs (timeouts, escalations, email/Slack notifications, webhook retries) run in `apps/worker`:

```bash
# Requires Redis + Postgres (docker compose up postgres redis -d)
pnpm worker:dev
```

The worker shares the same `DATABASE_URL` and `REDIS_URL` as the API.

## Testing

Integration tests use Vitest against a real Postgres database:

```bash
docker compose up postgres redis -d
export DATABASE_URL=postgresql://vekinbox:vekinbox@localhost:5432/vekinbox
pnpm db:migrate
pnpm test          # run once
pnpm test:watch    # watch mode
```

Tests cover idempotent request creation, agent vs session auth, tenant isolation, cancel, timeout processing, and webhook signature verification.

## API documentation

OpenAPI 3.1 spec: [packages/shared/openapi.yaml](packages/shared/openapi.yaml)

## Self-host configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string | — |
| `REDIS_URL` | Redis for queues/workers | `redis://localhost:6379` |
| `SESSION_SECRET` | Cookie/session signing secret | — |
| `PORT` / `API_PORT` | HTTP listen port | `3001` |
| `WEB_URL` | Web UI origin (CORS) | `http://localhost:3001` |
| `EMPTY_DB` | Seed demo data on startup | `false` |
| `SMTP_HOST` / `SMTP_PORT` | Email notifications | `localhost:1025` |

## Architecture

```
┌─────────────┐     HTTPS      ┌──────────────┐     SQL      ┌──────────┐
│ Agent SDK   │───────────────▶│  VekInbox    │─────────────▶│ Postgres │
│ / CLI       │                │  API :3001   │              └──────────┘
└─────────────┘                │              │     queue    ┌──────────┐
                               │              │─────────────▶│  Redis   │
┌─────────────┐     HTTPS      │              │              └────┬─────┘
│  Reviewer   │───────────────▶│  Web inbox   │                   │
│  Browser    │                └──────────────┘                   ▼
└─────────────┘                                            ┌──────────────┐
                                                           │ apps/worker  │
                                                           └──────────────┘
```

**Monorepo layout**

```
apps/
  api/              Hono API (Node 22)
  web/              React + Vite reviewer inbox
  worker/           BullMQ background processors
packages/
  sdk/              @latticeag/vekinbox (TypeScript)
  sdk-python/       vekinbox (Python)
  cli/              @latticeag/vekinbox-cli
  shared/           Types, Zod schemas, OpenAPI, webhook crypto
  db/               Drizzle schema + migrations
examples/
  langgraph-python/
  openai-agents-ts/
  crewai-python/
```

## Development

**Requirements:** Node 22+, pnpm 10+, Docker (Postgres/Redis), Python 3.10+ (for Python SDK).

```bash
pnpm install
docker compose up postgres redis mailcatcher -d
cp .env.example .env
export DATABASE_URL=postgresql://vekinbox:vekinbox@localhost:5432/vekinbox
pnpm db:migrate
pnpm db:seed
pnpm dev              # API + web + packages
pnpm worker:dev       # background worker (separate terminal)
pnpm build
pnpm test
```

## Packages

| Package | Name | Description |
|---------|------|-------------|
| `packages/sdk` | `@latticeag/vekinbox` | TypeScript SDK |
| `packages/sdk-python` | `vekinbox` | Python SDK |
| `packages/cli` | `@latticeag/vekinbox-cli` | `vekinbox` CLI |
| `packages/shared` | `@latticeag/vekinbox-shared` | Shared types + OpenAPI |
| `packages/db` | `@latticeag/vekinbox-db` | Drizzle ORM schema |

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 LatticeAG.
