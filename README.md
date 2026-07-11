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

## SDK example

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
  description: "Vendor: Acme Corp. Invoice #1024.",
  priority: "high",
  resumeWebhook: "https://my-agent.example.com/resume",
  metadata: { invoice_id: 1024 },
});

const result = await inbox.requests.waitForResolution(request.id, {
  timeout: "1h",
});

if (result.status === "approved") {
  console.log("Approved — proceeding with action");
}

// Verify incoming resume webhooks
const valid = inbox.webhooks.verify(headers, rawBody, webhookSecret);
```

## CLI examples

```bash
npm install -g @latticeag/vekinbox-cli

# Configure credentials (~/.vekinbox/config.json)
vekinbox auth login \
  --email admin@localhost \
  --api-key vk_live_... \
  --base-url http://localhost:3001/v1 \
  --workspace ws_...

vekinbox auth status

vekinbox request create \
  --title "Deploy to production?" \
  --key "deploy.prod.001" \
  --workspace ws_... \
  --agent agent_...

vekinbox request list --status pending
vekinbox request show req_...
vekinbox request resolve req_... --action approve --note "LGTM"
vekinbox request cancel req_...

# Local webhook receiver (forwards to your agent resume URL)
vekinbox dev --forward-to http://localhost:3000/resume --secret whsec_...
```

## Self-host configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string | — |
| `REDIS_URL` | Redis for queues/workers | `redis://localhost:6379` |
| `SESSION_SECRET` | Cookie/session signing secret | — |
| `PORT` / `API_PORT` | HTTP listen port | `3001` |
| `WEB_URL` | Web UI origin (CORS) | `http://localhost:3001` |
| `VITE_API_URL` | Web app API base (build-time) | `http://localhost:3001/v1` |
| `EMPTY_DB` | Seed demo data on startup | `false` |
| `SMTP_HOST` | SMTP server | `localhost` |
| `SMTP_PORT` | SMTP port | `1025` |
| `SMTP_FROM` | From address | `noreply@vekinbox.local` |
| `SLACK_BOT_TOKEN` | Slack bot token (optional) | — |
| `SLACK_SIGNING_SECRET` | Slack signing secret | — |
| `GITHUB_CLIENT_ID` | OAuth (optional) | — |
| `GITHUB_CLIENT_SECRET` | OAuth (optional) | — |
| `SENTRY_DSN` | Error monitoring (optional) | — |

## Architecture

```
┌─────────────┐     HTTPS      ┌──────────────┐     SQL      ┌──────────┐
│ Agent SDK   │───────────────▶│  VekInbox    │─────────────▶│ Postgres │
│ / CLI       │                │  API :3001   │              └──────────┘
└─────────────┘                │              │     queue    ┌──────────┐
                               │              │─────────────▶│  Redis   │
┌─────────────┐     HTTPS      │              │              └──────────┘
│  Reviewer   │───────────────▶│  (web static │──┐ notify
│  Browser    │                │   + workers) │  ├─▶ Email / Slack
└─────────────┘                └──────┬───────┘  │
                                      │          └─▶ Signed resume webhook
                                      ▼
                               ┌──────────────┐
                               │ Agent resume │
                               │   endpoint   │
                               └──────────────┘
```

**Monorepo layout**

```
apps/
  api/          Hono API (Node 22)
  web/          React + Vite reviewer inbox
packages/
  sdk/          @latticeag/vekinbox
  cli/          @latticeag/vekinbox-cli
  shared/       Types, Zod schemas, webhook verify
  db/           Drizzle schema + migrations
```

## Development

**Requirements:** Node 22+, pnpm 9+, Docker (for Postgres/Redis).

```bash
pnpm install

# Start dependencies
docker compose up postgres redis mailcatcher -d

cp .env.example .env
export DATABASE_URL=postgresql://vekinbox:vekinbox@localhost:5432/vekinbox

pnpm db:migrate
pnpm db:seed          # prints demo API key

pnpm dev              # turbo dev (api + web + packages)
```

Build all packages:

```bash
pnpm build
```

## Packages

| Package | npm name | Description |
|---------|----------|-------------|
| `packages/sdk` | `@latticeag/vekinbox` | TypeScript SDK — create, list, wait, webhook verify |
| `packages/cli` | `@latticeag/vekinbox-cli` | `vekinbox` CLI for auth, requests, local dev tunnel |
| `packages/shared` | `@latticeag/vekinbox-shared` | Shared types and validation (internal) |
| `packages/db` | `@latticeag/vekinbox-db` | Drizzle ORM schema and migrations (internal) |

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 LatticeAG.
