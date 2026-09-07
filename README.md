# VekInbox 📬

<p align="center">
  <a href="https://github.com/LatticeAG/VekInbox/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/LatticeAG/VekInbox?style=for-the-badge" alt="License" />
  </a>
  <a href="https://github.com/LatticeAG/VekInbox">
    <img src="https://img.shields.io/badge/TypeScript-5.7%2B-blue?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  </a>
  <a href="https://github.com/LatticeAG/VekInbox">
    <img src="https://img.shields.io/badge/Python-3.10%2B-blue?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
  </a>
  <a href="https://github.com/LatticeAG/VekInbox/stargazers">
    <img src="https://img.shields.io/github/stars/LatticeAG/VekInbox?style=for-the-badge" alt="GitHub stars" />
  </a>
  <a href="https://github.com/LatticeAG/VekInbox/issues">
    <img src="https://img.shields.io/github/issues/LatticeAG/VekInbox?style=for-the-badge" alt="GitHub issues" />
  </a>
  <a href="https://github.com/LatticeAG/VekInbox">
    <img src="https://img.shields.io/github/languages/top/LatticeAG/VekInbox?style=for-the-badge" alt="Top language" />
  </a>
</p>

<p align="center">
  <b>Durable human approval queue for AI agents.</b><br/>
  Submit. Review. Resume. In production.
</p>

<p align="center">
  <a href="#quick-start-docker--5-min">Quick Start</a> ·
  <a href="#why-vekinbox">Why VekInbox</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#sdk-examples">SDK Examples</a> ·
  <a href="#features">Features</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#self-host-configuration">Configuration</a> ·
  <a href="#testing">Testing</a> ·
  <a href="#known-issues">Known Issues</a>
</p>

---

VekInbox is a durable approval queue where AI agents submit requests for human review and resume via signed webhooks or SDK polling. Open-source (MIT), self-hostable with Docker Compose, with an optional managed SaaS from LatticeAG.

Built for production agent deployments that need a reliable human-in-the-loop layer -- approving payments, confirming destructive operations, validating outputs -- without coupling to a specific agent framework.

## Why VekInbox

- **Framework-agnostic human approval** - works with LangGraph, CrewAI, OpenAI Agents SDK, or any custom agent. One approval API, all frameworks.
- **Durable by design** - requests persist in Postgres, survive agent restarts, and include automatic timeout and escalation policies.
- **Multi-channel review** - humans approve in the built-in web inbox, via CLI, email, or Slack (coming). Meet your team where they work.
- **Signed webhooks, guaranteed delivery** - on resolution, VekInbox fires a signed webhook to your agent with the verdict. Retry with backoff until acknowledged.
- **Declarative policy steps** - each request type defines delay, escalation, and notification rules. Same policy language, any request shape.

### How VekInbox is different

- **Not a one-off approve widget** - VekInbox is a durable queue with Postgres persistence, timeout processing, escalation chains, and audit logging. It does not forget.
- **Agent SDK-first** - the primary integration surface is the SDK (`@latticeag/vekinbox` or `vekinbox` Python), not a webhook config panel. Agents create and wait for resolutions programmatically.
- **Multi-tenant from day one** - workspaces isolate agents, requests, and channel configurations. Different teams, different policies, shared infrastructure.

## Quick Start (Docker Compose, ~5 min)

```bash
git clone https://github.com/LatticeAG/VekInbox.git
cd VekInbox
cp .env.example .env

docker compose up --build
```

Open **http://localhost:3001/health** -- API is ready when `{"status":"ok"}`.

On first start (`EMPTY_DB=true`), the entrypoint seeds demo data and prints an API key to the logs:

```bash
docker compose logs api | grep "API Key"
```

Save that key -- it is shown only once.

| Service | URL | Published to host |
|-------------|-----|-------------------|
| API | http://localhost:3001/v1 | Yes (`3001:3001`) |
| Health | http://localhost:3001/health | Yes (same API service) |
| Mailcatcher | http://localhost:1080 | Yes (`1080:1080`, SMTP `1025:1025`) |
| Postgres | Internal only (`postgres:5432`) | No -- override with `docker-compose.override.yml` for local psql |
| Redis | Internal only (`redis:6379`) | No |

## How It Works

```mermaid
flowchart TD
  SDK["Agent SDK / CLI"] -->|create request| API["VekInbox API :3001"]
  API --> PG[("Postgres\ndurable requests")]
  API --> Redis[("Redis\nqueues")]
  Redis --> Worker["apps/worker\ntimeouts, escalation, email"]
  Browser["Reviewer browser\nweb inbox"] -->|approve / reject / cancel| API
  API -->|signed webhook x-vekinbox-signature| AgentHook["Agent resume endpoint"]
  SDK -->|waitForResolution polling| API
```

1. Agent creates a durable request via SDK or CLI (`key`-based idempotency dedupes retries).
2. Request persists in Postgres; timeout/escalation jobs enqueue in Redis.
3. Human approves, rejects, or cancels in the web inbox, CLI, or email.
4. API fires an HMAC-signed webhook (`x-vekinbox-signature`) to the agent's `resumeWebhook`, retrying with backoff until acknowledged -- or the SDK's `waitForResolution` poll loop picks up the verdict.

## SDK Examples

### TypeScript

```bash
npm install @latticeag/vekinbox
```

```typescript
import { VekInbox } from "@latticeag/vekinbox";

const inbox = new VekInbox({
  apiKey: "vk_live_...",
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
  console.log("Approved -- proceeding");
}
```

`waitForResolution` polls every 2s by default (configurable `pollInterval`) and resolves once the request leaves `pending`/`escalated`, or throws on timeout (default 1h).

### Python

```bash
pip install vekinbox  # or: cd packages/sdk-python && pip install -e .
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

## Features

### Core

| Feature | Description |
|---------|------------|
| **Approval queue** | Agents create durable requests; humans approve, reject, or cancel. |
| **Wait-for-resolution** | SDK blocks (with timeout) until a decision is made. Polling or webhooks. |
| **Signed webhooks** | `resumeWebhook` fires with HMAC-SHA256 signature (`x-vekinbox-signature` header) on resolution. |
| **Idempotent creation** | `key`-based idempotency prevents duplicate requests for the same action. |
| **Timeout & escalation** | Policy-driven delay before escalation to fallback channel. |
| **Multi-tenant workspaces** | Isolated agents, policies, and channel configurations per workspace. |

### SDK & CLI

| Feature | Description |
|---------|------------|
| **TypeScript SDK** | `@latticeag/vekinbox` (v0.1.0) -- `create`, `get`, `list`, `cancel`, `waitForResolution` |
| **Python SDK** | `vekinbox` (v0.1.0) -- `create`, `get`, `list`, `cancel`, `wait_for_resolution` |
| **CLI** | `vekinbox` (`@latticeag/vekinbox-cli`) -- `auth`, `workspace`, `agent`, `policy`, `channel`, `request`, `dev` |
| **Framework examples** | LangGraph (Python), OpenAI Agents (TS), CrewAI (Python) |

### Reviewer Experience

| Feature | Description |
|---------|------------|
| **Web inbox** | React + Vite reviewer UI for approving/rejecting requests |
| **Slack & email** | Upcoming notification channels with in-channel approve/reject |
| **Policies** | Configurable delay, notification, and escalation rules per request type |
| **Audit trail** | Every resolution logged with reviewer identity and note |

## Commands

```bash
# Auth
vekinbox auth login --email admin@localhost --api-key vk_live_... --workspace ws_...
vekinbox auth status

# Workspaces & agents
vekinbox workspace create --name "My Workspace"
vekinbox workspace list
vekinbox agent create --name "Payments Agent"
vekinbox agent key create agent_...

# Policies & channels
vekinbox policy list
vekinbox policy create --name "Default" --steps '[{"delay_ms":3600000,"notify":{}}]'
vekinbox channel list
vekinbox channel add --name "Ops Email" --type email

# Requests
vekinbox request create --title "Deploy?" --key "deploy.001" --agent agent_...
vekinbox request list --status pending
vekinbox request show req_...
vekinbox request resolve req_... --action approve --note "LGTM"
vekinbox request cancel req_...

# Local webhook forwarding
vekinbox dev --forward-to http://localhost:3000/resume --port 4040 --secret whsec_...
```

## Monorepo Layout

```text
vekinbox/
├── apps/
│   ├── api/             Hono API (Node 22)
│   ├── web/             React + Vite reviewer inbox
│   └── worker/          BullMQ background processors
├── packages/
│   ├── sdk/             @latticeag/vekinbox (TypeScript)
│   ├── sdk-python/      vekinbox (Python)
│   ├── cli/             @latticeag/vekinbox-cli
│   ├── shared/          Types, Zod schemas, OpenAPI, webhook crypto
│   └── db/              Drizzle schema + migrations
├── examples/
│   ├── langgraph-python/   LangGraph approval gate
│   ├── openai-agents-ts/   OpenAI Agents SDK tool
│   └── crewai-python/      CrewAI deploy tool with approval
├── SPEC.md              Full implementation specification
├── LICENSE              MIT
└── README.md            This file
```

## Self-Host Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string | -- |
| `REDIS_URL` | Redis for queues/workers | `redis://localhost:6379` |
| `SESSION_SECRET` | Cookie/session signing secret | -- |
| `PORT` / `API_PORT` | HTTP listen port | `3001` |
| `WEB_URL` | Web UI origin (CORS) | `http://localhost:3001` |
| `EMPTY_DB` | Seed demo data on startup | `false` |
| `SMTP_HOST` / `SMTP_PORT` | Email notifications | `localhost:1025` |

## Testing

```bash
docker compose up postgres redis -d
export DATABASE_URL=postgresql://vekinbox:***@localhost:5432/vekinbox
pnpm db:migrate
pnpm test          # run once
pnpm test:watch    # watch mode
```

Unit suite runs without Docker: **74 passed** across 20 files (`npx vitest run`). The 16 skipped tests in 4 files (`requests`, `timeout`, `v3-approvals`, `legacy-safety` integration suites) require a live Postgres + Redis.

Tests cover idempotent request creation, agent vs session auth, tenant isolation, cancel, timeout processing, and webhook signature verification.

## Development

**Requirements:** Node 22+, pnpm 10+, Docker (Postgres/Redis), Python 3.10+.

```bash
pnpm install
docker compose up postgres redis mailcatcher -d
cp .env.example .env
export DATABASE_URL=postgresql://vekinbox:***@localhost:5432/vekinbox
pnpm db:migrate
pnpm db:seed
pnpm dev              # API + web + packages
pnpm worker:dev       # background worker (separate terminal)
pnpm build
pnpm test
```

## Known Issues

- **API key shown once** - The initial API key is printed to container logs on first start only. If lost, reset with `docker compose run api pnpm db:seed --reset`.
- **Worker requires Redis** - Timeout processing and email notifications depend on a running Redis instance. Without it, requests never expire or escalate.
- **SMTP required for email notifications** - No built-in sendmail. Configure an SMTP relay or use Mailpit/Mailcatcher for local development.
- **Postgres/Redis not on host ports** - Only the API (`3001`) and Mailcatcher (`1080`/`1025`) publish host ports. Point local tools at the compose network or add a `docker-compose.override.yml` mapping (e.g. `5433:5432`).

## License

MIT -- see [LICENSE](./LICENSE). Copyright &copy; 2026 LatticeAG.
