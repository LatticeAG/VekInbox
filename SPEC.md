# VekInbox — OSS Product & Engineering Specification

> **Durable human approval queue for AI agents.**
>
> Series: **Vek** (agent APIs / durable agent state)
> Org: **LatticeAG** (`latticeag.com`)
> License: **MIT**
> Spec version: **0.3.0 — OSS-first**
> Status: **Phase A–F in progress (foundation + core API + web + SDK/CLI shipped)**

---

## 0. Strategic Scope: OSS First

### Decision (locked)

**Build and ship the full MIT-licensed, self-hostable OSS product first.** Hosted SaaS is a future commercial layer on the same codebase — not in scope for the current build phase.

| Phase | Scope | Status |
|---|---|---|
| **OSS v0.1** (now) | API, web inbox, SDK, CLI, Docker Compose, Postgres schema, inline webhooks | **Shipped (MVP skeleton)** |
| **OSS v0.2** (next) | BullMQ worker, email + Slack notifications, escalation/timeout engine, integration tests | Planned |
| **OSS v0.3** | OIDC login, webhook dashboard, Python SDK, framework examples | Planned |
| **Hosted SaaS** | Invite-only cloud, billing, managed Slack app, SSO add-ons | **Deferred** — same Docker image, separate control plane later |

### Why OSS-first

1. **Trust**: Approval infra must be inspectable before enterprises adopt it.
2. **Distribution**: Agent engineers evaluate via `docker compose up` and `npm i @latticeag/vekinbox`.
3. **Velocity**: One codebase, one image, no SaaS/billing divergence during product discovery.
4. **Series fit**: Vek products are primitives; OSS is the primitive, SaaS is convenience later.

### Long-term business model (context only — not building now)

Hybrid MIT OSS + invite-only SaaS remains the long-term LatticeAG strategy. SaaS adds managed notifications, SSO, retention, and ops. **None of that blocks OSS completion.**

---

## 1. Problem & Solution

### Problem

AI agents need human approval for irreversible or high-impact actions. Framework-native HITL is:

- Blocking (no durable async wait)
- Ephemeral (no audit trail)
- Non-team (no shared inbox)
- Non-governed (no escalation, timeout, policy)
- Non-contractual (no signed resume webhooks)
- Non-idempotent (retries spam reviewers)

### Solution

**VekInbox** is a self-hosted approval service:

```
Agent ──POST /requests──► VekInbox ──notify──► Reviewer (web / Slack / email)
  ▲                            │
  └── signed resume webhook ◄──┘ (on approve/decline/timeout)
```

1. Agent creates **Request** (idempotent `key`) via API/SDK/CLI.
2. Reviewer resolves in **web inbox** (or notification channel in v0.2).
3. VekInbox records immutable **audit events** and delivers **signed resume webhook**.
4. Agent verifies signature and continues (or SDK `waitForResolution` polls).

### Positioning

> "VekInbox is the durable human approval layer for AI agents. Self-host it in five minutes — your agents never act alone on something that matters."

---

## 2. Target Users (OSS)

| Persona | JTBD |
|---|---|
| **Agent engineer** | Drop-in approval gate with SDK + webhook resume |
| **Platform engineer** | One queue + audit log across all agents in a workspace |
| **Reviewer / on-call** | Clear context, one-click approve/decline |
| **Security / compliance** | Immutable event trail, self-hosted data residency |

### Anti-personas

- Single-dev synchronous `y/n` CLI prompts
- General ticketing (Jira/Linear replacement)
- Fully autonomous agents with zero governance

---

## 3. OSS Product Surface (what we ship)

| Component | Package | Purpose |
|---|---|---|
| **API server** | `@latticeag/vekinbox-api` | HTTP API, auth, request lifecycle, webhooks |
| **Web inbox** | `@latticeag/vekinbox-web` | Reviewer UI |
| **TypeScript SDK** | `@latticeag/vekinbox` | Agent integration |
| **CLI** | `@latticeag/vekinbox-cli` | Scripts, local dev, ops |
| **Shared types** | `@latticeag/vekinbox-shared` | Zod schemas, errors, constants, webhook crypto |
| **Database** | `@latticeag/vekinbox-db` | Drizzle schema, migrations, seed |
| **Docker** | root `Dockerfile` + `docker-compose.yml` | One-command self-host |

### Explicitly NOT in OSS v0.1 (shipped gaps → v0.2)

- BullMQ background workers (webhooks are inline with 3 retries)
- Email/Slack notification delivery
- Escalation/timeout scheduler (policies CRUD only)
- Rate limiting enforcement
- SSRF protection on resume webhook URLs
- Integration test suite
- API serving built web static assets in Docker (API only in compose today)

---

## 4. Repository Layout (as built)

```
/workspace/
├── SPEC.md                          # This document
├── README.md                        # Quickstart
├── LICENSE                          # MIT
├── Dockerfile                       # Multi-stage production image
├── docker-compose.yml               # postgres, redis, mailcatcher, api
├── scripts/docker-entrypoint.sh     # wait → migrate → seed → start
├── package.json                     # pnpm workspaces root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
│
├── apps/
│   ├── api/                         # Hono HTTP server (:3001)
│   │   └── src/
│   │       ├── index.ts             # @hono/node-server entry
│   │       ├── app.ts               # route mounting, CORS
│   │       ├── middleware/          # auth, session, dual-auth, errors
│   │       ├── routes/              # health, requests, workspaces, agents, auth, policies, channels
│   │       ├── services/            # request, webhook, audit, api-key
│   │       └── lib/                 # crypto, db singleton
│   │
│   └── web/                         # React + Vite inbox (:5173 dev)
│       └── src/
│           ├── pages/               # login, inbox, detail, settings
│           ├── components/        # badges, timeline, dialogs, shadcn ui
│           ├── contexts/            # auth, theme
│           └── lib/api.ts           # fetch client w/ cookies
│
└── packages/
    ├── shared/                      # Zod + types + errors + webhook verify
    ├── db/                          # Drizzle schema + migrations + seed
    ├── sdk/                         # VekInbox client
    └── cli/                         # vekinbox binary
```

### Package dependency graph

```
shared ◄── db
  ▲
  ├── api
  ├── sdk ◄── cli
  └── web (types only, via API responses)
```

---

## 5. Core Domain Model

### ID prefixes (locked)

| Entity | Prefix | Example |
|---|---|---|
| Organization | `org_` | `org_V1StGXR8_Z5jdHi6B` |
| Workspace | `ws_` | `ws_...` |
| User | `user_` | `user_...` |
| Agent | `agent_` | `agent_...` |
| API key record | `key_` | `key_...` |
| Request | `req_` | `req_...` |
| Event | `evt_` | `evt_...` |
| Policy | `pol_` | `pol_...` |
| Channel | `ch_` | `ch_...` |
| Webhook delivery | `del_` | `del_...` |

Generated via `nanoid` in `@latticeag/vekinbox-shared`.

### Request lifecycle

```
                    ┌─────────────┐
                    │   pending   │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     ┌──────────┐   ┌────────────┐   ┌───────────┐
     │ approved │   │  declined  │   │ cancelled │
     └──────────┘   └────────────┘   └───────────┘
           ▲               ▲
           │    ┌──────────┴──────────┐
           │    ▼                     ▼
           │ changes_requested    timed_out
           │    │                     │
           └────┴─────────────────────┘
                    (re-resolve)

     escalated = notification state; request may still be pending
```

**Terminal statuses:** `approved`, `declined`, `timed_out`, `cancelled`.

**Resolvable statuses:** `pending`, `changes_requested`.

### Standard actions → status mapping

| Action | Resulting status |
|---|---|
| `approve` | `approved` |
| `decline` | `declined` |
| `request_changes` | `changes_requested` |
| custom | mapped in `actionToStatus()` in shared |

### Idempotency (locked)

`POST /v1/requests` with same `(workspace_id, key)`:

- If `return_existing: true` (default): return existing request, increment `idempotency_reused_count`.
- If `return_existing: false` and exists: `409 request_already_resolved`.

This prevents duplicate Slack/email spam when agents retry after crashes.

### Authorization model (locked)

| Actor | Can create requests | Can resolve | Can cancel | Can manage workspace |
|---|---|---|---|---|
| Agent API key | Yes (own workspace) | **No** | Own agent's pending | No |
| Reviewer session | No | Yes | No | No |
| Admin session | No | Yes | No | Yes |
| Owner session | No | Yes | No | Yes |

**Agents propose; humans authorize.** Never let API keys resolve requests.

---

## 6. Database Schema (implemented)

All tables in `packages/db/src/schema.ts`. Migration: `packages/db/drizzle/0000_*.sql`.

### Entity relationships

```
organizations
  └── workspaces
        ├── memberships (users ↔ role)
        ├── agents
        │     └── api_keys
        ├── escalation_policies
        ├── notification_channels
        └── requests
              ├── request_events      (append-only audit)
              ├── request_assignments
              ├── request_notifications
              └── webhook_deliveries
```

### Table reference

#### `organizations`
| Column | Type | Notes |
|---|---|---|
| id | text PK | `org_*` |
| name | text | |
| created_at, updated_at | timestamptz | |

#### `workspaces`
| Column | Type | Notes |
|---|---|---|
| id | text PK | `ws_*` |
| organization_id | text FK | cascade delete |
| name | text | |
| slug | text | unique per org |
| settings | jsonb | default `{}` |
| created_at, updated_at | timestamptz | |

#### `users`
| Column | Type | Notes |
|---|---|---|
| id | text PK | `user_*` |
| email | text unique | |
| name | text nullable | |
| avatar_url | text nullable | |
| created_at, updated_at | timestamptz | |

#### `memberships`
| Column | Type | Notes |
|---|---|---|
| id | text PK | |
| workspace_id, user_id | text FK | unique pair |
| role | enum | owner, admin, reviewer, viewer |
| created_at | timestamptz | |

#### `agents`
| Column | Type | Notes |
|---|---|---|
| id | text PK | `agent_*` |
| workspace_id | text FK | |
| name, description | text | |
| webhook_secret | text | HMAC signing secret |
| permissions | jsonb | `{}` for now |
| rate_limit_per_minute | int | default 60, not enforced yet |
| created_at, updated_at | timestamptz | |

#### `api_keys`
| Column | Type | Notes |
|---|---|---|
| id | text PK | `key_*` |
| agent_id | text FK | |
| key_hash | text | SHA-256 of full key |
| key_prefix | text | first 12 chars for display |
| name | text | |
| last_used_at | timestamptz nullable | |
| revoked_at | timestamptz nullable | |
| created_at | timestamptz | |

#### `requests`
| Column | Type | Notes |
|---|---|---|
| id | text PK | `req_*` |
| organization_id, workspace_id, agent_id | text FK | |
| key | text | unique per workspace |
| title | text | max 200 |
| description | text | max 20480 |
| status | enum | see lifecycle |
| priority | enum | low, normal, high, critical |
| actions | jsonb | string[] |
| default_action | text nullable | timeout default |
| timeout_at | timestamptz nullable | |
| escalation_policy_id | text FK nullable | |
| resume_webhook_url | text nullable | HTTPS in prod |
| metadata | jsonb | max 32KB |
| labels | text[] | |
| resolved_by | text FK nullable | |
| resolved_at | timestamptz nullable | |
| resolution_action | text nullable | |
| resolution_note | text nullable | |
| resolution_payload | jsonb nullable | |
| idempotency_reused_count | int | default 0 |
| created_at, updated_at | timestamptz | |

**Indexes:** `(workspace_id, key)` unique, `(workspace_id, status, created_at desc)`, `(timeout_at)` where pending.

#### `request_events` (append-only)
| Column | Type | Notes |
|---|---|---|
| id | text PK | `evt_*` |
| request_id | text FK | |
| type | text | e.g. `request.created` |
| actor_type | enum | user, agent, system |
| actor_id | text nullable | |
| payload | jsonb | |
| created_at | timestamptz | |

**Event types (implemented / planned):**

| Type | When | Status |
|---|---|---|
| `request.created` | Request inserted | ✅ |
| `request.resolved` | Human resolves | ✅ |
| `request.cancelled` | Agent cancels | ✅ |
| `request.notified` | Channel delivery | v0.2 |
| `request.viewed` | Reviewer opens detail | v0.2 |
| `request.escalated` | Policy step fires | v0.2 |
| `request.timed_out` | Timeout reached | v0.2 |
| `request.webhook_delivered` | Resume POST 2xx | v0.2 |
| `request.webhook_failed` | Resume exhausted retries | v0.2 |

#### `webhook_deliveries`
Tracks resume webhook attempts. Inline delivery in v0.1; worker updates in v0.2.

### Seed data (`pnpm db:seed`)

Creates:
- Organization: "Demo Organization"
- Workspace: "demo" (`ws_*`)
- User: `admin@localhost` (owner)
- Agent: "demo-agent"
- API key: printed once to console (`vk_live_...`)

---

## 7. API Specification

**Base path:** `/v1`
**Dev URL:** `http://localhost:3001/v1`
**Health:** `GET /health` → `{ "status": "ok", "version": "0.1.0" }`

### Authentication

#### Agent API keys
```http
Authorization: Bearer vk_live_xxxxxxxxxxxx...
```
- Prefix lookup → SHA-256 compare → attach `agent_id`, `workspace_id` to context.
- Keys shown once on `POST /v1/agents/:id/keys`.

#### Human session (OSS dev mode)
```http
Cookie: vekinbox_session=<signed-jwt>
```
- `POST /v1/auth/dev-login` `{ "email": "admin@localhost" }` — creates/finds user, sets cookie.
- Production self-host: add OIDC in v0.3.

#### Dual auth (read endpoints)
`GET /v1/requests` and `GET /v1/requests/:id` accept **either** session or API key.
- Session requires `?workspace_id=ws_...` query param.
- API key scopes to key's workspace automatically.

### Error envelope (all endpoints)

```json
{
  "error": {
    "code": "request_already_resolved",
    "message": "Request req_abc is already approved",
    "docs_url": "https://latticeag.com/docs/vekinbox/errors/request_already_resolved",
    "request_id": "req_abc"
  }
}
```

| HTTP | Codes |
|---|---|
| 400 | `validation_error`, `invalid_action` |
| 401 | `unauthorized`, `invalid_api_key` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | `request_already_resolved`, `request_not_resolvable`, `conflict` |
| 500 | `internal_error` |

### Endpoints (implemented)

#### Requests

**POST /v1/requests** — Create (API key)

Request body:
```json
{
  "workspace_id": "ws_...",
  "key": "invoice.pay.2026-07-11.001",
  "title": "Approve $450 invoice payment?",
  "description": "Vendor: Acme Corp. Invoice #1024.",
  "priority": "high",
  "actions": ["approve", "decline", "request_changes"],
  "default_action": "decline",
  "timeout": "1h",
  "timeout_at": "2026-07-11T13:34:56Z",
  "escalation_policy_id": "pol_...",
  "resume_webhook_url": "https://my-agent.example.com/resume",
  "metadata": { "invoice_id": 1024 },
  "labels": ["billing"],
  "assignees": ["user_..."],
  "return_existing": true
}
```

Validation limits (from `@latticeag/vekinbox-shared`):
- `title` ≤ 200 chars
- `description` ≤ 20480 bytes
- `metadata` ≤ 32768 bytes JSON
- `actions` ≤ 8 items
- `priority` ∈ low | normal | high | critical

Response: `RequestResponse` (snake_case JSON).

**GET /v1/requests** — List (dual auth)

Query params:
| Param | Type | Notes |
|---|---|---|
| workspace_id | string | Required for session auth |
| status | enum | Filter |
| priority | enum | Filter |
| agent_id | string | Filter |
| limit | int | Default 25, max 100 |
| cursor | string | Opaque pagination cursor |

**GET /v1/requests/:id** — Detail (dual auth)

**POST /v1/requests/:id/actions/:action** — Resolve (session only)

Body:
```json
{
  "note": "Verified with finance team"
}
```

**POST /v1/requests/:id/cancel** — Cancel (API key, pending only)

**GET /v1/requests/:id/events** — Audit log (dual auth)

#### Workspaces (session)

| Method | Path | Description |
|---|---|---|
| GET | `/v1/workspaces` | List caller's workspaces |
| POST | `/v1/workspaces` | Create `{ name, slug? }` |
| GET | `/v1/workspaces/:id/agents` | List agents |
| POST | `/v1/workspaces/:id/agents` | Register agent |

#### Agents

| Method | Path | Description |
|---|---|---|
| POST | `/v1/agents/:id/keys` | Create key → returns full key once |
| DELETE | `/v1/agents/:id/keys/:keyId` | Revoke |

#### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/v1/auth/dev-login` | `{ email }` → session |
| POST | `/v1/auth/logout` | Clear session |
| GET | `/v1/auth/me` | Current user + workspaces |

#### Policies & Channels (CRUD only, scheduler v0.2)

| Method | Path | Description |
|---|---|---|
| GET/POST | `/v1/workspaces/:id/policies` | Escalation policies |
| GET/POST | `/v1/workspaces/:id/channels` | Notification channels |

### Resume webhook contract (implemented)

On resolve/cancel/timeout, VekInbox POSTs to `resume_webhook_url`:

```http
POST https://my-agent.example.com/resume
Content-Type: application/json
X-VekInbox-Signature: sha256=abc123...
X-VekInbox-Timestamp: 1720692896
X-VekInbox-Delivery-Id: del_...
```

Payload:
```json
{
  "request_id": "req_...",
  "workspace_id": "ws_...",
  "agent_id": "agent_...",
  "key": "invoice.pay.001",
  "status": "approved",
  "action": "approve",
  "resolved_by": "user_...",
  "resolved_at": "2026-07-11T12:34:56.000Z",
  "note": "Looks good",
  "metadata": { "invoice_id": 1024 }
}
```

**Signing algorithm (locked):**
```
signature = HMAC-SHA256(
  key = agent.webhook_secret,
  message = "${timestamp}.${rawBody}"
)
header  = "sha256=" + hex(signature)
```

**Verification (SDK):**
```typescript
inbox.webhooks.verify(headers, rawBody, webhookSecret);
// Rejects if timestamp skew > 5 minutes
```

**Delivery semantics:**
- At-least-once; agents MUST idempotently handle duplicate deliveries for same `request_id` + terminal `status`.
- v0.1: inline retries at 0s, 1s, 3s.
- v0.2: BullMQ with backoff 1m, 5m, 15m, 1h, 6h → `request.webhook_failed`.

**Timeout default action (locked):** `decline`. Never auto-approve unless workspace explicitly configures it.

---

## 8. SDK Specification (`@latticeag/vekinbox`)

### Installation

```bash
npm install @latticeag/vekinbox
```

### API

```typescript
import { VekInbox } from "@latticeag/vekinbox";

const inbox = new VekInbox({
  apiKey: process.env.VEKINBOX_API_KEY!,
  baseUrl: "http://localhost:3001/v1", // optional
});

// Create
const request = await inbox.requests.create({
  workspaceId: "ws_...",
  agentId: "agent_...",      // optional if inferred from key
  key: "invoice.pay.001",
  title: "Approve $450 payment?",
  description: "...",
  priority: "high",
  timeout: "1h",             // parsed to timeout_at
  actions: ["approve", "decline"],
  resumeWebhook: "https://...",
  metadata: { invoice_id: 1024 },
});

// Poll until terminal
const result = await inbox.requests.waitForResolution(request.id, {
  timeout: "1h",
  pollInterval: 2000,
});

// Webhook verification in agent HTTP handler
const valid = inbox.webhooks.verify(
  req.headers,
  rawBody,
  process.env.WEBHOOK_SECRET!,
);
```

### Design rules

- Thin `fetch` wrapper; no Node-only deps in core (works in Deno/edge with fetch).
- Types re-exported from shared.
- `waitForResolution` throws on timeout with clear error.
- camelCase in SDK; snake_case on wire.

---

## 9. CLI Specification (`@latticeag/vekinbox-cli`)

Binary: `vekinbox`
Config: `~/.vekinbox/config.json`

```json
{
  "baseUrl": "http://localhost:3001/v1",
  "apiKey": "vk_live_...",
  "workspaceId": "ws_...",
  "email": "admin@localhost"
}
```

### Commands (implemented)

```bash
vekinbox auth login --email admin@localhost --api-key vk_live_... --base-url http://localhost:3001/v1
vekinbox auth status

vekinbox request create --title "..." --key "..." --workspace ws_... --priority high
vekinbox request list --status pending
vekinbox request show req_...
vekinbox request resolve req_... --action approve --note "ok"   # needs session (gap: use web UI for now)
vekinbox request cancel req_...

vekinbox dev --forward-to http://localhost:3000/resume   # local webhook receiver + optional verify
```

### Known gap (v0.2 fix)

`request resolve` requires reviewer **session**, not API key. CLI should add `auth login --session` flow or document using web UI for resolve. Agents must not resolve their own requests.

---

## 10. Web UI Specification (`@latticeag/vekinbox-web`)

### Routes

| Path | Page | Auth |
|---|---|---|
| `/login` | Dev email login | Public |
| `/inbox` | Queue (Pending / Resolved / All tabs) | Protected |
| `/inbox/:id` | Request detail + actions + audit | Protected |
| `/settings` | Workspace, agents, account | Protected |

### Inbox list

- Columns: priority badge, title, agent, status, created, timeout
- Search: title + key (client-side filter)
- Empty state: SDK quickstart snippet with copy button

### Request detail

- Title, markdown description (simple renderer)
- Metadata JSON block
- Action buttons: Approve, Decline, Request Changes
- **Critical priority:** confirmation dialog required
- Audit timeline from `GET /events`

### Design system (locked)

- **Stack:** React 19, Vite 6, Tailwind v4, shadcn/ui
- **Fonts:** IBM Plex Sans + Plex Mono (not Inter)
- **Theme:** Zinc palette, dark mode via `class`, no purple AI gradients
- **A11y:** keyboard-navigable actions, dialog focus trap, semantic badges

### Dev

```bash
pnpm --filter @latticeag/vekinbox-web dev   # :5173, proxies /v1 → :3001
```

---

## 11. OSS v0.2 — Worker & Notifications (spec for next build)

### 11.1 Worker process (`apps/worker`)

**Recommendation:** Separate Node process in same monorepo, shares `@latticeag/vekinbox-db`.

```
apps/worker/src/
  index.ts
  queues/
    notifications.queue.ts
    escalation.queue.ts
    webhooks.queue.ts
  processors/
    send-email.ts
    send-slack.ts
    escalate-request.ts
    timeout-request.ts
    deliver-webhook.ts
```

**Tech:** BullMQ on Redis 7. Job IDs keyed by `request_id` + job type for idempotency.

#### Escalation algorithm

On `request.created`:
1. If `escalation_policy_id` set, schedule step 0 at `now + steps[0].delay_ms`.
2. If `timeout_at` set, schedule timeout job.

On escalation step N:
1. Load policy step N.
2. Notify `notify_user_id` or `notify_channel_id`.
3. Append `request.escalated` event.
4. Schedule step N+1 or stop.

On timeout:
1. If status still `pending`, apply `default_action_on_timeout` (default: `decline`).
2. Set `resolved_by = null`, `actor_type = system`.
3. Append `request.timed_out` event.
4. Queue webhook delivery.

**Safety:** Default timeout action is always `decline` unless workspace `settings.allow_auto_approve_on_timeout = true`.

### 11.2 Email notifications

**Self-host:** Nodemailer → SMTP (`SMTP_*` env vars). Docker compose includes Mailcatcher on `:1080`.

**Template structure:**
- Subject: `[VekInbox] {priority} — {title}`
- Body: title, description excerpt, metadata summary, signed action links
- Action links: `GET /v1/actions/email?token=...` → confirm page → resolve

**Signed email tokens:**
- Payload: `{ request_id, action, exp, user_id }`
- HMAC with `SESSION_SECRET`
- Single-use (store hash in Redis or DB)
- TTL: 30 minutes
- Critical actions: require login confirmation, not one-click

### 11.3 Slack notifications

**Self-host:** Bring-your-own Slack app (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`).

**Message format:**
```
🔔 *Approve $450 invoice payment?*
Agent: demo-agent · Priority: high · Expires: 1h
Vendor: Acme Corp. Invoice #1024.
[Approve] [Decline] [Open in VekInbox]
```

**Interactions:** Bolt handler at `POST /v1/integrations/slack/interactions`. Verify signing secret. Map `action_id` → resolve endpoint.

### 11.4 Webhook worker

Move inline delivery from `webhook.service.ts` to `webhooks` queue.

| Attempt | Delay |
|---|---|
| 1 | immediate |
| 2 | 1m |
| 3 | 5m |
| 4 | 15m |
| 5 | 1h |
| 6 | 6h |

Update `webhook_deliveries` row each attempt. Emit `request.webhook_delivered` or `request.webhook_failed`.

**SSRF protection (v0.2):**
- Block `localhost`, `127.0.0.1`, `10.*`, `172.16-31.*`, `192.168.*`, `169.254.*`, link-local IPv6
- Optional workspace `settings.webhook_url_allowlist: string[]`
- Request timeout: 10s
- Max response body read: 4KB

---

## 12. Security Model (OSS)

### Threat priorities

1. Spoofed approvals
2. Webhook tampering / replay
3. Cross-tenant data leak
4. Agent resolving own requests
5. Secret leakage in logs
6. SSRF via resume webhook URLs (v0.2)
7. Slack interaction forgery

### Controls

| Control | Implementation | Status |
|---|---|---|
| API key hashing | SHA-256 at rest | ✅ |
| Session cookies | JWT via `jose`, httpOnly, sameSite=lax | ✅ |
| Webhook HMAC | SHA-256, 5m timestamp skew | ✅ |
| Tenant isolation | `workspace_id` on every query | ✅ |
| Agents cannot resolve | `requireSession` on resolve route | ✅ |
| CSRF | SameSite + POST-only mutations | ✅ |
| TLS | Operator responsibility self-host | — |
| Rate limiting | Redis token bucket per key | v0.2 |
| Audit immutability | Append-only events table | ✅ |

### RBAC (MVP)

| Role | Resolve | Manage agents | Manage members | Manage policies |
|---|---|---|---|---|
| viewer | No | No | No | No |
| reviewer | Yes | No | No | No |
| admin | Yes | Yes | Yes | Yes |
| owner | Yes | Yes | Yes | Yes |

---

## 13. Deployment (OSS)

### Docker Compose (primary path)

```bash
cp .env.example .env
docker compose up --build
```

| Service | Port | Image |
|---|---|---|
| api | 3001 | built from Dockerfile |
| postgres | 5432 | postgres:16-alpine |
| redis | 6379 | redis:7-alpine |
| mailcatcher | 1080 (UI), 1025 (SMTP) | sj26/mailcatcher |

Entrypoint (`scripts/docker-entrypoint.sh`):
1. Wait for Postgres (`pg_isready`)
2. `pnpm db:migrate`
3. If `EMPTY_DB=true`, `pnpm db:seed` (prints API key)
4. Start API

### Production self-host checklist

- [ ] Set strong `SESSION_SECRET` (32+ random bytes)
- [ ] Use managed Postgres with backups
- [ ] Put Caddy/nginx in front with TLS
- [ ] Set `EMPTY_DB=false` after first boot
- [ ] Configure real SMTP or Slack tokens
- [ ] Restrict Postgres/Redis to internal network
- [ ] Run worker process (v0.2) alongside API
- [ ] Stream audit events to SIEM if required

### Environment variables (complete)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | Postgres connection |
| `REDIS_URL` | v0.2 | `redis://localhost:6379` | BullMQ |
| `SESSION_SECRET` | Yes | — | JWT + email tokens |
| `PORT` | No | `3001` | API port |
| `API_HOST` | No | `0.0.0.0` | Bind address |
| `WEB_URL` | No | `http://localhost:3001` | CORS, email links |
| `EMPTY_DB` | No | `false` | Seed on first boot |
| `SMTP_HOST/PORT/FROM` | v0.2 | mailcatcher | Email |
| `SLACK_BOT_TOKEN` | Optional | — | Slack |
| `SLACK_SIGNING_SECRET` | Optional | — | Slack verify |
| `SENTRY_DSN` | Optional | — | Error tracking |

---

## 14. Development Workflow

### Prerequisites

- Node.js ≥ 22
- pnpm 10+
- Docker (for Postgres/Redis)

### Local dev (without Docker for apps)

```bash
pnpm install
docker compose up -d postgres redis mailcatcher
cp .env.example .env
pnpm db:migrate && pnpm db:seed   # save printed API key

# Terminal 1
pnpm --filter @latticeag/vekinbox-api dev

# Terminal 2
pnpm --filter @latticeag/vekinbox-web dev
```

### Monorepo scripts

| Script | Command |
|---|---|
| Build all | `pnpm build` |
| Dev all | `pnpm dev` |
| Generate migration | `pnpm db:generate` |
| Run migrations | `pnpm db:migrate` |
| Seed demo data | `pnpm db:seed` |

### CI (to add)

```yaml
# .github/workflows/ci.yml
- pnpm install --frozen-lockfile
- pnpm build
- docker compose up -d postgres redis
- pnpm db:migrate
- pnpm test   # when tests exist
```

---

## 15. Testing Strategy

### v0.2 test matrix

| Layer | Tool | Coverage target |
|---|---|---|
| Unit | vitest | webhook crypto, action→status, policy scheduling math |
| Integration | vitest + testcontainers | API + Postgres + Redis |
| Contract | OpenAPI snapshot | request/response shapes |
| E2E | Playwright | login → create (API) → approve (web) → webhook received |
| Security | custom | tenant isolation (wsA cannot read wsB) |
| Load | k6 (pre-release) | 50 RPS create+resolve |

### Critical test cases

1. Idempotent create returns same `req_id` for duplicate `key`
2. Agent key cannot `POST .../actions/approve` (403)
3. Resolved request cannot be resolved again (409)
4. Webhook signature rejected when timestamp skew > 5m
5. Webhook signature rejected when body tampered
6. Session user in workspace A cannot list workspace B requests
7. Cancel only works on `pending`
8. `request_changes` allows re-resolution to `approved`

---

## 16. Implementation Status Tracker

### Shipped in repo (v0.1.0)

| Component | Status | Notes |
|---|---|---|
| Monorepo (pnpm + turbo) | ✅ | |
| Drizzle schema (13 tables) | ✅ | Migration 0000 |
| Seed script | ✅ | Prints API key once |
| Shared package (zod, errors, ids, webhook) | ✅ | |
| API: request CRUD + resolve + cancel | ✅ | |
| API: workspaces, agents, keys | ✅ | |
| API: dev-login session auth | ✅ | |
| API: policies + channels CRUD | ✅ | |
| API: inline webhook delivery | ✅ | 3 retries |
| Web: login, inbox, detail, settings | ✅ | |
| Web: dark mode, shadcn, IBM Plex | ✅ | |
| SDK: create, get, list, cancel, wait, verify | ✅ | TypeScript |
| CLI: auth, request, dev tunnel | ✅ | |
| Docker Compose + Dockerfile | ✅ | API + worker |
| README + LICENSE | ✅ | |

### Shipped in v0.2 / v0.3 (this branch)

| Component | Status | Notes |
|---|---|---|
| `apps/worker` BullMQ processors | ✅ | Timeout, escalation, email, Slack, webhooks |
| CLI session auth for resolve | ✅ | dev-login + `~/.vekinbox/cookies.json` |
| CLI workspace/agent/policy/channel | ✅ | Full ops surface |
| CLI dev webhook receiver | ✅ | Signature verify + formatted output |
| Integration tests (Vitest) | ✅ | Postgres in CI |
| Python SDK | ✅ | `packages/sdk-python` |
| Framework examples | ✅ | LangGraph, OpenAI Agents, CrewAI |
| OpenAPI 3.1 spec | ✅ | `packages/shared/openapi.yaml` |
| CI workflow | ✅ | `.github/workflows/ci.yml` |
| Timeout processor | ✅ | API + worker |

### Next

| Component | Priority | Effort |
|---|---|---|
| Email notifications (SMTP) | P0 | Medium |
| Slack interactive messages | P1 | Medium |
| Escalation scheduler (live) | P0 | Medium |
| Webhook queue w/ long retry | P0 | Low |
| SSRF protection | P0 | Low |
| Rate limiting | P1 | Low |
| API serves web static in Docker | P2 | Low |
| OIDC login for self-host | P2 | Medium |
| Webhook delivery dashboard | P2 | Medium |
| Docs site from OpenAPI | P2 | Low |

### Later

- Hosted SaaS control plane
- Browser OAuth flow for CLI (`vekinbox auth browser-login`)

---

## 17. Framework Integration Examples (v0.3 spec)

### LangGraph (Python)

```python
from vekinbox import VekInbox

inbox = VekInbox(api_key=os.environ["VEKINBOX_API_KEY"])

def risky_tool_node(state):
    req = inbox.requests.create(
        workspace_id="ws_...",
        key=f"tool.{state['run_id']}",
        title=f"Approve {state['tool_name']}?",
        metadata=state["tool_args"],
    )
    result = inbox.requests.wait_for_resolution(req.id, timeout="30m")
    if result.status != "approved":
        raise HumanDeclinedError()
    return execute_tool(state)
```

### OpenAI Agents (TypeScript)

```typescript
import { tool } from "@openai/agents";
import { VekInbox } from "@latticeag/vekinbox";

const inbox = new VekInbox({ apiKey: process.env.VEKINBOX_API_KEY! });

export const payInvoice = tool({
  name: "pay_invoice",
  execute: async (args) => {
    const req = await inbox.requests.create({
      workspaceId: process.env.VEKINBOX_WORKSPACE_ID!,
      key: `pay.${args.invoiceId}`,
      title: `Pay invoice ${args.invoiceId}?`,
      metadata: args,
      resumeWebhook: process.env.AGENT_RESUME_URL,
    });
    const result = await inbox.requests.waitForResolution(req.id, { timeout: "1h" });
    if (result.status !== "approved") throw new Error("Payment not approved");
    return await stripe.pay(args.invoiceId);
  },
});
```

---

## 18. Naming & Identifiers (locked)

| Item | Value |
|---|---|
| Product | **VekInbox** |
| Repo | `github.com/LatticeAG/VekInbox` |
| npm SDK | `@latticeag/vekinbox` |
| npm CLI | `@latticeag/vekinbox-cli` |
| npm shared | `@latticeag/vekinbox-shared` |
| npm db | `@latticeag/vekinbox-db` |
| Docker | `ghcr.io/latticeag/vekinbox` |
| API keys | `vk_live_...` / `vk_test_...` |
| Session cookie | `vekinbox_session` |
| Webhook headers | `X-VekInbox-Signature`, `X-VekInbox-Timestamp`, `X-VekInbox-Delivery-Id` |

---

## 19. Open Questions (for Moses)

Only items that still need your input. Everything else above is a **locked recommendation**.

1. **Worker topology:** Single `apps/worker` process vs worker threads inside API? **Recommendation:** separate `apps/worker` container in compose.
2. **Web in Docker:** Serve `apps/web/dist` from API (one container) vs separate nginx sidecar? **Recommendation:** API serves static in production image.
3. **CLI resolve auth:** Magic-link email login in CLI, or browser OAuth flow storing session in `~/.vekinbox/`? **Recommendation:** `vekinbox auth browser-login` opening web login + localhost callback.
4. **Python SDK timing:** Ship in v0.3 or earlier for LangGraph users?
5. **Design partners:** Any teams to dogfood before public launch announcement?

---

## 20. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-11 | OSS-first; SaaS deferred | Focus shipping self-hostable primitive |
| 2026-07-11 | TypeScript monorepo | Shared types across API/SDK/web |
| 2026-07-11 | Hono + Drizzle + Postgres | Boring, fast, type-safe |
| 2026-07-11 | Agents cannot resolve | Separation of propose vs authorize |
| 2026-07-11 | Idempotent `key` per workspace | Agent crash safety |
| 2026-07-11 | Default timeout = decline | Fail-safe for irreversible tools |
| 2026-07-11 | Dev-login for OSS MVP | No OAuth dependency for first run |
| 2026-07-11 | SHA-256 API key hash | Fast lookup; keys are high-entropy |
| 2026-07-11 | IBM Plex + shadcn | Technical aesthetic, fast UI |

---

*Spec version 0.3.0 — OSS-first. Reflects implemented v0.1 codebase and specifies v0.2/v0.3 work.*
