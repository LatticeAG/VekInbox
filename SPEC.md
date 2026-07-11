# VekInbox — Product & Engineering Specification

> **Async human approval queue for AI agents.**
>
> Series: **Vek** (agent APIs / durable agent state & data)
> Org: **LatticeAG** (`latticeag.com`)
> Pattern: **Hybrid — MIT OSS core + invite-only managed SaaS**
> Spec version: **0.2.0** (planning expansion)
> Status: **Planning only — no implementation yet**

---

## 0. Executive Decision: OSS vs SaaS vs Hybrid?

### Recommendation (locked): **Hybrid**

**Ship an MIT-licensed, self-hostable core (API + web UI + CLI + SDKs), and sell a managed, invite-only SaaS that runs that same core with hosted notifications, SSO, retention, and ops.**

| Model | Verdict | Why it fails or wins for VekInbox |
|---|---|---|
| **Pure OSS** | Reject | Approvals are high-trust but low willingness-to-maintain for most teams. Pure OSS gets stars, not revenue; LatticeAG still pays for Slack/email infra, support, and compliance narratives with no capture. |
| **Pure SaaS** | Reject | Approval systems touch money, PII, and irreversible actions. Many agent platforms (esp. enterprise / regulated) will refuse a closed black box. Pure SaaS also loses the distribution flywheel agent builders expect from primitives. |
| **Hybrid (OSS + SaaS)** | **Adopt** | Trust via readable/self-hostable code; speed via managed queue + Slack/email; moat via SSO, audit retention, multi-region, analytics, and support. Matches PostHog / Cal.com / Sentry / Temporal community patterns that agent teams already trust. |

### Why Hybrid is specifically right for *approval* infrastructure

1. **Trust asymmetry**: Reviewers are authorizing irreversible actions. Being able to read the webhook signer, audit log, and policy engine is not a nice-to-have — it is the product.
2. **Deployment asymmetry**: Indie agent builders want `npm i` + hosted URL in 5 minutes. Banks/health/fintech want VPC / air-gapped. Hybrid serves both without forking the product story.
3. **Moat asymmetry**: The open core is a *commodity primitive* (create request → wait → resume). The hosted differentiators are painful to self-operate: Slack app distribution, reliable email deliverability, escalation schedulers across regions, SIEM export, SSO, SOC2 evidence packs.
4. **Series consistency**: Vek products are agent infrastructure. Infrastructure that agents depend on should be inspectable and self-hostable; LatticeAG monetizes convenience and governance.

### Hybrid boundary (what is OSS vs what is SaaS-only)

| Layer | OSS (MIT) | Hosted SaaS |
|---|---|---|
| HTTP API + Postgres schema | Yes | Same binary/image |
| Web reviewer inbox | Yes | Same UI, LatticeAG branding + multi-tenant cloud |
| TypeScript / Python SDKs | Yes | Point at `api.vekinbox.latticeag.com` by default |
| CLI | Yes | Auth against SaaS or self-host URL |
| Slack / email adapters | Yes (bring-your-own credentials) | Pre-wired Slack app + Resend |
| Escalation / timeout engine | Yes | Same |
| Multi-tenant billing, invite gating, usage metering | No (SaaS control plane) | Yes |
| Managed SSO (SAML), audit retention policies, SIEM shipping | Self-host DIY | Productized add-ons |
| SOC2 / DPA / BAAs | N/A | SaaS enterprise |

**License recommendation (locked):** MIT for all OSS packages and the self-hostable server. Do **not** use AGPL or a source-available “fair code” license for MVP — agent builders will not adopt a viral license into their agent runtimes. Capture value with hosted convenience, not license traps. Revisit only if a well-funded clone becomes a real threat *after* product-market fit.

**Trademark:** Keep “VekInbox” and “LatticeAG” trademarks; OSS can say “powered by VekInbox”; hosted product is the canonical brand.

---

## 1. Problem & User Value

### Problem

AI agents increasingly need to perform actions that are expensive, irreversible, or legally sensitive: sending money, deleting data, making purchases, sending emails on a user's behalf, updating production configs, or invoking tools outside their sandbox.

Current agent frameworks handle this with ad-hoc `human_in_the_loop` prompts that:

- **Block** the agent process until a human responds (no durable wait)
- Offer **no persistence**, audit trail, or retry logic
- Have **no centralized queue** for teams
- Cannot **escalate** when the primary reviewer is unavailable
- Mix approval UX into agent code, making it hard to **reuse or govern**
- Provide **no signed resume contract**, so agents cannot safely trust callbacks
- Have **no idempotency**, so retries create duplicate approval spam

### Solution

**VekInbox** decouples the agent from the human:

1. Agent submits an approval **Request** (HTTP / SDK / CLI) and continues other work (or awaits via SDK helper).
2. Humans review in a durable **Inbox** (web, Slack, email).
3. Resolution is recorded immutably and delivered to the agent via **signed resume webhook** (and/or SDK poll).
4. Escalation policies, timeouts, and audit logs make this operable for teams and compliance.

### Value proposition

| Audience | Value |
|---|---|
| **Agent builders** | Drop-in approval primitive; stop building HITL plumbing. |
| **Operators / platform teams** | Centralized queue, audit, escalation, timeout policies across agents. |
| **Approvers** | Familiar inbox UX, Slack/email, one-click actions, clear context. |
| **Executives / compliance** | Immutable history, policy enforcement, self-host option. |

### Positioning statement (locked)

> “VekInbox is the durable human approval layer for AI agents. Open-source it, self-host it, or let us run it for you — either way, your agents never act alone on something that matters.”

---

## 2. Target Users & Jobs To Be Done

### Primary personas

1. **Agent engineer (builder)** — Shipping an agent that must ask before high-impact tools. JTBD: “When my agent hits a risky tool call, I want a durable approve/deny gate so I don’t block the process or invent HITL myself.”
2. **Platform / internal tooling engineer** — Wrapping many agents under one governance layer. JTBD: “When any agent in our org needs human sign-off, I want one queue, one audit log, one Slack channel.”
3. **On-call / ops reviewer** — Approves or declines from Slack/email under time pressure. JTBD: “When I’m paged with an approval, I want enough context and one tap to decide safely.”
4. **Security / compliance reviewer** — Needs evidence of who approved what, when, under which policy. JTBD: “When auditors ask, I want an immutable trail of agent requests and human decisions.”

### Secondary personas (post-MVP)

- Founders of agent startups evaluating infrastructure primitives
- Enterprise IT provisioning SSO and data residency
- Framework maintainers integrating VekInbox as an official HITL backend

### Anti-personas (do not optimize for)

- Teams that only need synchronous CLI `y/n` prompts in a single developer terminal
- Fully autonomous agents with no human governance requirement
- Generic human task queues / ticketing systems (we are not Linear/Jira)

---

## 3. Product Positioning

| Dimension | Decision (locked unless marked open) |
|---|---|
| **Series** | Vek — agent-as-API / durable agent state |
| **Business model** | **Hybrid**: MIT OSS + invite-only hosted SaaS |
| **Trust model** | Source is open; speed/moat is managed hosted tier |
| **Deployment** | Self-hostable (Docker Compose / single image) + managed cloud by invitation |
| **Pricing** | OSS free forever; SaaS free tier then per-request + seats |
| **Primary language** | **TypeScript** for API, SDK, web, CLI (monorepo) |
| **Secondary SDK** | Python after launch (agents live in Python ecosystems) |
| **Brand home** | `latticeag.com/products/vekinbox` |
| **API host** | `https://api.vekinbox.latticeag.com/v1` |

### Competitive landscape (planning lens)

| Alternative | Gap VekInbox fills |
|---|---|
| Framework-native HITL (LangGraph interrupt, OpenAI approval) | Not durable, not multi-agent/team, not Slack-first, not auditable across frameworks |
| Generic queues / Temporal signals | Powerful but heavy; not approval UX; not reviewer-native |
| Ticketing (Jira/Linear/ServiceNow) | Human workflows, not agent resume contracts / signed webhooks |
| ChatOps bots | Ephemeral, no first-class request entity or SDK wait |
| Homegrown Postgres + Slack | Everyone rebuilds the same fragile thing |

**Moat thesis:** Be the *standard approval wire protocol* for agents (idempotent request + signed resume + audit), then win ops with hosted Slack/email/escalation/SSO.

---

## 4. Core Concepts

### Request

Central entity. An agent submits a `Request` when it needs human approval.

| Field | Notes |
|---|---|
| `id` | Prefixed uuid, e.g. `req_...` |
| `key` | Agent-defined stable idempotency key (unique per workspace), e.g. `invoice.pay.2026-07-11.001` |
| `title` | Short human-readable summary (≤120 chars recommended) |
| `description` | Longer markdown context |
| `agent_id` | Creating agent |
| `workspace_id` | Scoping |
| `status` | `pending` → `approved` \| `declined` \| `timed_out` \| `escalated` \| `cancelled` \| `changes_requested` |
| `priority` | `low` \| `normal` \| `high` \| `critical` |
| `timeout_at` | Optional absolute deadline |
| `escalation_policy_id` | Optional |
| `metadata` | Agent-provided JSON (displayed; size-capped) |
| `actions` | Declared allowed outcomes |
| `default_action` | Applied on timeout if configured |
| `resume_webhook_url` | Where to POST the result |
| `assignees` | Optional explicit reviewers |
| `labels` | Freeform tags |
| `created_at`, `updated_at`, `resolved_at`, `resolved_by` | Lifecycle |

**Idempotency (locked recommendation):** `POST /requests` with the same `(workspace_id, key)` returns the existing request if still pending or already resolved (configurable: `return_existing` default true). This prevents double-spend approval spam when agents retry.

### Action

Possible outcomes:

- `approve` — proceed
- `decline` — stop / fallback
- `request_changes` — return context to agent without finalizing (status → `changes_requested`; agent may amend via new request or `PATCH` with new key)
- Custom workspace actions (e.g. `approve_with_limit`, `send_to_legal`) with optional payload schema

### Inbox

Human-facing queue scoped to user or team. Filters: assignee, labels, priority, status, agent, workspace, created range.

### Notification Channel

Email, Slack DM/channel, Web UI (always on). Future: SMS / PagerDuty / Microsoft Teams.

### Escalation Policy

Ordered steps: delay → notify secondary → notify manager/channel → auto-resolve with default action.

### Agent Identity

API-key authenticated principal under a workspace:

- `id`, `name`, `description`
- `permissions` (which request types / max priority it may create)
- `trusted_ips` (optional)
- `rate_limit`
- `webhook_secret` (for signing resumes)

### Workspace / Organization

Multi-tenant boundary. Organization owns billing (SaaS); workspaces isolate agents and reviewers.

---

## 5. Features

### 5.1 MVP (ship first)

| ID | Feature | Notes |
|---|---|---|
| **F1** | Submit request (API/SDK) | Idempotent by `key` |
| **F2** | Reviewer inbox (web) | Tabs: pending / resolved / escalated; search; detail; actions |
| **F3** | Resolve request | Approve / decline / request_changes / custom |
| **F4** | Signed resume webhook | HMAC + timestamp; retries with backoff |
| **F5** | Slack notifications | DM or channel + interactive buttons |
| **F6** | Email notifications | HTML + signed one-click action links |
| **F7** | Escalation + timeout | Server-side scheduler |
| **F8** | Audit log | Append-only `RequestEvent` stream |
| **F9** | Workspaces + multi-tenancy | Org → workspace → members |
| **F10** | CLI | create/list/show/resolve/cancel/dev tunnel |
| **F11** | API keys | `vk_live_` / `vk_test_`, rotate, revoke |
| **F12** | OAuth login (SaaS) | GitHub + Google |
| **F13** | Docker Compose self-host | API + web + Postgres + Redis + mailcatcher |
| **F14** | TypeScript SDK | create + `waitForResolution` + webhook verify |
| **F15** | Docs site MVP | Quickstart, API reference, self-host guide |

### 5.2 V1 (soon after MVP)

- Python SDK
- Framework examples: LangGraph, OpenAI Agents, CrewAI, Mastra
- Webhook delivery dashboard (success/fail, redliver)
- Request templates (reusable title/description/action sets)
- Assignee rules (round-robin, on-call schedule basic)
- Soft real-time inbox (SSE or WebSocket)
- Export audit log (JSONL / CSV)
- Self-hosted OIDC login
- Usage metering hooks for SaaS

### 5.3 V2 (later)

- SAML SSO, SCIM
- PagerDuty / Teams / Discord channels
- Policy-as-code (who can approve which metadata shapes)
- AI-assisted risk summary (optional, never auto-approve by default)
- Multi-region active-active for SaaS
- Mobile-friendly PWA (not native apps)
- Approval analytics (MTTR, bottleneck reviewers)
- White-label / embeddable review widget
- gRPC or long-poll control plane (only if customers demand)

### 5.4 Explicit non-goals (MVP)

- Threaded collaborative commenting on requests
- Native iOS/Android apps
- Advanced BI dashboards
- Fine-grained RBAC beyond `owner` / `admin` / `reviewer` / `viewer`
- Custom hosted UI branding / white-label
- Enterprise SAML at day one (OIDC self-host yes in V1; SAML in V2)
- Non-HTTP agent transports
- Self-serve billing UI (invite-only SaaS uses manual invites + Stripe later)
- Auto-approve ML heuristics as default behavior
- Replacing general ticketing systems

---

## 6. User Journeys (MVP)

### J1 — Agent engineer first success (happy path)

1. Create SaaS workspace (or `docker compose up`).
2. Register agent; copy `vk_test_...` key.
3. `npm i @latticeag/vekinbox`; create request with webhook or `waitForResolution`.
4. Open web inbox (or Slack); approve.
5. Agent resumes; engineer sees signed payload verified.

### J2 — Reviewer via Slack

1. Request created with `priority: high`.
2. Slack DM with title, amount/metadata preview, Approve / Decline buttons.
3. Click Approve → modal confirm → VekInbox resolves → webhook fires.
4. Slack message updates to “Approved by @user”.

### J3 — Timeout & escalation

1. Request with 30m timeout and policy: 10m → secondary, 20m → #approvals, 30m → `decline`.
2. No response → escalations fire → timeout auto-declines → agent webhook gets `timed_out` / default action.

### J4 — Idempotent retry

1. Agent crashes after `POST /requests` but before persisting `request_id`.
2. Agent retries with same `key`.
3. API returns existing request; no duplicate Slack spam.

### J5 — Self-host operator

1. Clone repo; set `DATABASE_URL`, `REDIS_URL`, `SMTP_*`, Slack tokens.
2. Migrate; run API + web.
3. Point SDK `baseUrl` at internal URL.
4. Export audit events to stdout / webhook for SIEM.

---

## 7. UX Principles (Web + Slack)

**Locked recommendations:**

1. **Inbox first, not dashboard first.** The primary screen is a queue of decisions, not charts.
2. **One decision per view.** Detail page: title, context, metadata, risk cues, actions. No card clutter in the hero of the product UI.
3. **Context over chrome.** Show agent name, key, metadata, and description above the fold; settings live elsewhere.
4. **Irreversibility cues.** Destructive/high-priority requests use clear visual weight (not purple glow kitsch — use typography/hierarchy and restrained semantic color).
5. **Slack parity.** Anything you can do in web approve/decline must work in Slack for MVP actions.
6. **Empty states teach.** First-run inbox explains how to create a request via SDK snippet.
7. **Accessibility.** Keyboard approve flows, sufficient contrast, don’t rely on color alone for status.
8. **Design system.** **shadcn/ui + Radix + Tailwind** for speed and quality; expressive typography (not Inter/Roboto defaults) — recommend **Geist Sans / Geist Mono** or **IBM Plex** for a technical LatticeAG feel; avoid cream/terracotta and purple-gradient AI clichés.

---

## 8. Data Model

### Entity tree

```
Organization
  └── Workspace
        ├── Membership (user ↔ role)
        ├── User
        ├── Agent
        ├── ApiKey
        ├── EscalationPolicy
        ├── NotificationChannel
        ├── RequestTemplate (V1)
        ├── Request
        │     ├── RequestEvent      (audit, append-only)
        │     ├── RequestAssignment
        │     └── RequestNotification
        └── InboxView (saved filters; V1)
```

### Request (detail)

```
id                        text PK          -- req_...
organization_id           uuid FK
workspace_id              uuid FK
agent_id                  uuid FK
key                       text             -- unique (workspace_id, key)
title                     text
description               text
status                    enum
priority                  enum
actions                   jsonb            -- [{ name, label, schema? }]
default_action            text null
timeout_at                timestamptz null
escalation_policy_id      uuid FK null
resume_webhook_url        text null
metadata                  jsonb
labels                    text[]
resolved_by               uuid FK null
resolved_at               timestamptz null
resolution_payload        jsonb null       -- action + optional reviewer note
idempotency_reused_count  int default 0
created_at / updated_at   timestamptz
```

Indexes: `(workspace_id, status, created_at desc)`, `(workspace_id, key)` unique, `(timeout_at)` where pending, GIN on `labels`.

### RequestEvent

```
id, request_id, type, actor_type (user|agent|system),
actor_id, payload jsonb, created_at
```

Types: `request.created`, `request.notified`, `request.viewed`, `request.assigned`, `request.resolved`, `request.escalated`, `request.timed_out`, `request.cancelled`, `request.webhook_delivered`, `request.webhook_failed`.

### EscalationPolicy

```
id, workspace_id, name,
steps jsonb  -- [{ delay_ms, notify: {user_id|channel_id}, message? }],
default_action_on_timeout text,  -- decline | approve | custom
created_at, updated_at
```

### Hard limits (MVP recommendations)

| Resource | Limit |
|---|---|
| `metadata` JSON size | 32 KB |
| `description` | 20 KB markdown |
| Actions per request | 8 |
| Title | 200 chars |
| Webhook URL | HTTPS only (HTTP allowed only in self-host/dev) |
| API list page size | 100 max |

---

## 9. API Surface

### Base URLs

- SaaS: `https://api.vekinbox.latticeag.com/v1`
- Self-hosted: operator-configured

### Auth

- Agents / automation: `Authorization: Bearer vk_live_...` or `vk_test_...`
- Humans (web): session cookie (`vekinbox_session`) after OAuth/OIDC
- Signed email links: short-TTL HMAC tokens, single-use for resolve

### Endpoints (MVP)

#### Requests

| Method | Path | Description |
|---|---|---|
| POST | `/requests` | Create (idempotent by `key`) |
| GET | `/requests` | List + filters |
| GET | `/requests/:id` | Detail |
| POST | `/requests/:id/actions/:action` | Resolve |
| POST | `/requests/:id/cancel` | Cancel pending |
| GET | `/requests/:id/events` | Audit log |

#### Workspaces & Agents

| Method | Path | Description |
|---|---|---|
| GET/POST | `/workspaces` | List / create |
| GET/POST | `/workspaces/:id/agents` | List / register |
| POST | `/agents/:id/keys` | Create/rotate key |
| DELETE | `/agents/:id/keys/:keyId` | Revoke |

#### Users & Channels

| Method | Path | Description |
|---|---|---|
| GET/POST | `/workspaces/:id/users` | List / invite |
| GET/POST | `/workspaces/:id/channels` | List / add |

#### Policies

| Method | Path | Description |
|---|---|---|
| GET/POST | `/workspaces/:id/policies` | List / create |
| PUT | `/policies/:id` | Update |

### Error shape (locked)

```json
{
  "error": {
    "code": "request_already_resolved",
    "message": "Request req_... is already approved",
    "request_id": "req_...",
    "docs_url": "https://latticeag.com/docs/vekinbox/errors/request_already_resolved"
  }
}
```

### Resume webhook payload (locked)

```http
POST {resume_webhook_url}
Content-Type: application/json
X-VekInbox-Signature: sha256=...
X-VekInbox-Timestamp: 1710000000
X-VekInbox-Delivery-Id: del_...
```

```json
{
  "request_id": "req_...",
  "workspace_id": "ws_...",
  "agent_id": "agent_...",
  "key": "invoice.pay.001",
  "status": "approved",
  "action": "approve",
  "resolved_by": "user_...",
  "resolved_at": "2026-07-11T12:34:56Z",
  "note": "Looks good",
  "metadata": { "invoice_id": 1024 }
}
```

**Delivery semantics (locked):** at-least-once; agent must be idempotent on `request_id` + `status`. Retries: exponential backoff (1m, 5m, 15m, 1h, 6h) then dead-letter with `request.webhook_failed` event. Manual redeliver in V1 UI.

---

## 10. SDK Design

### TypeScript (MVP, locked package: `@latticeag/vekinbox`)

```ts
import { VekInbox } from "@latticeag/vekinbox";

const inbox = new VekInbox({
  apiKey: process.env.VEKINBOX_API_KEY!,
  // baseUrl optional; defaults to SaaS
});

const request = await inbox.requests.create({
  workspaceId: "ws_...",
  key: "invoice.pay.001",
  title: "Approve $450 invoice payment?",
  description: "Vendor: Acme Corp. Invoice #1024.",
  priority: "high",
  timeout: "1h",
  actions: ["approve", "decline", "request_changes"],
  resumeWebhook: "https://my-agent.example.com/resume",
  metadata: { invoice_id: 1024 },
});

const result = await request.waitForResolution({ timeout: "1h" });
if (result.status === "approved") {
  await payInvoice(result.metadata.invoice_id);
}
```

Also export:

- `verifyWebhookSignature(headers, rawBody, secret)`
- Framework helpers later (`withApproval(fn)`) as thin wrappers, not core

### Python (V1)

`pip install vekinbox` — mirror TS surface; critical because LangGraph/CrewAI users are Python-first.

### SDK principles

- Thin HTTP clients; no heavy runtime
- Explicit timeouts; never hang forever without opt-in
- Types generated from OpenAPI
- Test mode keys never hit production SaaS routing

---

## 11. CLI

**Package / binary:** `vekinbox`  
**Implementation (locked):** TypeScript (citty or oclif) in the monorepo — share types/client with SDK. Ship as npm package `@latticeag/vekinbox-cli`; optional later Rust rewrite only if binary size/distribution becomes a support burden.

```
vekinbox auth login | logout | status
vekinbox workspace list | create | use <id>
vekinbox agent list | create | key rotate
vekinbox request create | list | show | resolve | cancel | events
vekinbox policy list | create --from-file
vekinbox channel add-slack | add-email
vekinbox dev --forward-to <url>   # local webhook tunnel
vekinbox doctor                   # check config / connectivity
```

---

## 12. Notifications

### Email (locked)

- **SaaS:** Resend
- **Self-host:** SMTP env vars (`SMTP_HOST`, etc.)
- Templates: request created, escalated, resolved (to watchers)
- One-click action links: signed, single-use, ≤30m TTL, require confirmation page for `critical`

### Slack (locked)

- Slack Bolt app
- SaaS: LatticeAG-managed Slack app install flow
- Self-host: bring your own Slack app credentials
- Interactive Approve / Decline / Open in VekInbox
- Message updates on resolution (no stale buttons)

### Web

- Badge counts; polling every 5–15s MVP; SSE in V1

### Notification rules (MVP)

- Notify assignees if set; else workspace default channel / on-call role
- Critical → Slack + email always
- Respect user mute / quiet hours in V1 (not MVP)

---

## 13. Escalation & Timeout Engine

**Locked approach:** Redis-backed delayed jobs (BullMQ) with Postgres as source of truth for policy + request state.

Algorithm:

1. On create, schedule timeout job if `timeout_at` set; schedule step-1 escalation if policy present.
2. On resolve/cancel, cancel pending jobs.
3. On escalation step, write `request.escalated` event, notify, schedule next step.
4. On timeout, set status `timed_out`, apply `default_action` if configured (record as system actor), deliver webhook.

**Safety recommendation:** Default timeout action is **`decline`**, never `approve`, unless workspace explicitly opts into auto-approve for low-priority templates.

---

## 14. Security Model

### Threat priorities

1. Spoofed approvals
2. Webhook tampering / replay
3. Cross-tenant data leak
4. Privilege escalation (agent approving as human)
5. Secret leakage in logs
6. CSRF on cookie session UI
7. Slack interaction forgery

### Controls (locked recommendations)

| Control | Detail |
|---|---|
| API keys | `vk_live_` / `vk_test_`; hashed at rest (only prefix stored plaintext for display); rotatable |
| Human auth | SaaS: GitHub + Google OAuth; Self-host V1: OIDC |
| RBAC MVP | `owner`, `admin`, `reviewer`, `viewer` |
| Agents | Can create/cancel own requests; **cannot** resolve |
| Webhooks | HMAC-SHA256 (`X-VekInbox-Signature`), timestamp skew ±5m, unique delivery ids |
| Email actions | Single-use tokens; critical requires re-auth or confirm |
| Transport | TLS 1.3 |
| Tenancy | Every query constrained by `workspace_id` from auth context; automated tenant isolation tests |
| CSRF | SameSite cookies + CSRF token for browser mutations |
| Slack | Verify signing secret on all interactions |
| PII | Encrypt sensitive columns optional flag; never log metadata bodies at info level |
| Audit | Append-only events; no UPDATE/DELETE in app path |

### Compliance posture (roadmap)

- MVP: security.md + responsible disclosure
- SaaS Team+: DPA template
- Enterprise: SOC2 Type II journey after revenue; SAML; audit retention add-on

---

## 15. Architecture

### Monorepo layout (recommendation)

```
apps/
  api/          # Hono on Node 22 (or Bun — see open questions)
  web/          # React + Vite + Tailwind + shadcn
  docs/         # optional early; can be Mintlify later
packages/
  sdk-ts/
  cli/
  shared/       # zod schemas, error codes, types
  db/           # Drizzle schema + migrations
```

### Tech stack (locked unless noted)

| Layer | Choice | Why |
|---|---|---|
| API | **Hono + TypeScript** | Shares types with SDK; fast enough; LatticeAG agent ecosystem is TS-heavy; ships faster than Rust for this product surface |
| Validation | **Zod** | Shared request/response schemas |
| ORM | **Drizzle** | Type-safe, migration-friendly, SQL-close |
| DB | **Postgres 16** | Relational audit + tenancy |
| Queue | **Redis 7 + BullMQ** | Delays, retries, escalation |
| Web | **React 19 + Vite + Tailwind + shadcn** | Fast polished inbox |
| Auth (SaaS) | **Arctic / better-auth or Lucia-style sessions** | Keep simple; avoid Auth0 tax early |
| Email | **Resend** (SaaS) + SMTP (self-host) | |
| Slack | **Bolt** | |
| Observability | **OpenTelemetry** + structured JSON logs; Sentry for SaaS errors | |
| Packaging | Docker multi-stage; `ghcr.io/latticeag/vekinbox` | |
| CI | GitHub Actions: lint, typecheck, unit, integration (testcontainers) | |

**Rejected for MVP:** Rust API (slower iteration; revisit if CPU-bound at scale), GraphQL (REST is clearer for agents), Kafka (overkill), MongoDB (audit/relational fit is Postgres).

### Runtime topology

```
[Agent SDK/CLI] --HTTPS--> [API] --SQL--> Postgres
                              |--queue--> Redis/BullMQ workers
                              |           ├─ notify email/slack
                              │           ├─ escalate
                              │           └─ deliver webhook
[Reviewer Browser] --> [Web] --> [API]
[Slack] <--> [API interactions endpoint]
```

### Hosting recommendation (SaaS)

- **API + workers:** Fly.io or Railway (long-lived workers matter; pure serverless is awkward for BullMQ). Prefer **Fly.io** for multi-region later.
- **Web UI:** same origin reverse-proxy from API host *or* Vercel — recommendation: **serve web from same Docker image** behind Fly to keep self-host = SaaS parity.
- **Postgres:** Neon or Managed Postgres on Fly/AWS
- **Redis:** Upstash only if compatible with BullMQ needs; prefer **Redis on Fly** for workers reliability
- **CDN/DNS:** Cloudflare in front

Self-host: single `docker compose` with api, worker, web, postgres, redis.

---

## 16. Multi-Tenancy & Isolation

- **SaaS:** shared DB, strict `workspace_id` / `organization_id` on every row; row-level defense in depth via query helpers.
- **Self-host:** typically single org; still keep workspace model for parity.
- **Dangerous ops:** delete workspace = soft-delete + delayed purge.
- **Rate limits:** per API key and per workspace; Redis token bucket.

---

## 17. Observability & Reliability

| Signal | Target (SaaS) |
|---|---|
| API availability | 99.9% monthly |
| Webhook eventual delivery | ≥99.5% within 24h |
| p95 create request | <200ms (excl. cold start) |
| p95 inbox list | <300ms |
| Escalation scheduling accuracy | ±5s |

Emit metrics: requests_created, resolved, escalated, webhook_success/fail, time_to_resolution histogram.

SaaS: Sentry + OTel traces; status page later.

---

## 18. Testing Strategy

1. **Unit:** zod schemas, signature verify, policy step scheduling math
2. **Integration:** API + Postgres + Redis via testcontainers
3. **Contract:** OpenAPI → SDK type tests
4. **E2E:** Playwright approve flow on web
5. **Chaos-ish:** webhook endpoint 500s → retry behavior
6. **Security:** tenant isolation suite (create in wsA, ensure wsB 404)
7. **Load (pre-public):** 100 RPS create + resolve smoke

---

## 19. Documentation Plan

MVP docs (can live in repo README + `/docs`):

1. Why VekInbox / Hybrid model
2. 5-minute quickstart (SaaS + Docker)
3. Concepts (Request, Action, Escalation)
4. API reference (OpenAPI)
5. SDK TS guide
6. Slack setup (SaaS install vs self-host app manifest)
7. Security (webhooks, keys)
8. Self-hosting production checklist

Tone: precise, agent-engineer oriented, copy-paste first.

---

## 20. Pricing & Packaging

### OSS

- Free, MIT, unlimited self-host usage
- Community support via GitHub Issues / Discord (optional)

### SaaS (invite-only at first)

| Tier | Monthly approvals | Seats | Price |
|---|---|---|---|
| Starter | 1,000 | 3 | Free |
| Team | 10,000 | 10 | $49/mo + $0.005 / extra approval |
| Growth | 100,000 | 50 | $199/mo + overages |
| Enterprise | Custom | Custom | Custom (SSO, retention, DPA, support) |

### Add-ons

- SSO (SAML/OIDC): $50/mo per workspace (or Enterprise-bundled)
- Extended audit retention (1y+): $30/mo
- Priority support: ~20% of plan

### Invite-only rationale

Control support load, gather qualitative feedback, avoid drive-by abuse of free Slack/email sending, and keep quality bar for LatticeAG brand.

---

## 21. Go-to-Market (planning)

1. **Launch narrative:** “Human-in-the-loop that doesn’t block your agent.”
2. **Channels:** GitHub repo, LatticeAG site, agent framework discords, HN/Show HN when MVP is real, Twitter/X demos of Slack approve → agent resume.
3. **Integrations as distribution:** LangGraph / OpenAI Agents examples in-repo.
4. **Design partners:** 5 invite-only teams before public SaaS.
5. **Content:** one canonical architecture post — durable approvals vs interrupts.

---

## 22. Success Metrics

| Category | Metrics |
|---|---|
| Adoption | GitHub stars, Docker pulls, npm downloads, self-host reports |
| Usage | Requests created, TTR (time to resolution), escalation rate, Slack vs web resolve mix |
| Reliability | Webhook success, uptime, failed delivery age |
| Business | Invite → active workspace, Starter → Team conversion, logos |
| Product quality | Duplicate request rate (idempotency working), reviewer CSAT qualitative |

North star: **weekly resolved requests by non-LatticeAG workspaces**.

---

## 23. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Frameworks ship “good enough” HITL | Differentiate on durability, audit, Slack, multi-agent governance |
| Abuse of free SaaS email/Slack | Invite-only; rate limits; test keys |
| Self-host divergence from SaaS | Same image; feature flags only for billing/SSO control plane |
| Approving the wrong thing | Rich context + confirm on critical + decline-default timeouts |
| Webhook SSRF from resume URLs | URL allowlist optional; block link-local/metadata IPs; timeout; size limits |
| Scope creep into ticketing | Guard non-goals ruthlessly |

---

## 24. Delivery Plan (phased — not calendar estimates)

> Replace the prior “6-day MVP” framing with capability phases. Duration depends on staffing; phases are sequencing constraints.

### Phase A — Foundation

- Lock stack (this spec)
- Monorepo scaffold, CI, lint, Drizzle migrations for org/workspace/user/agent/request/event
- Config via env; health endpoints

### Phase B — Core API

- Auth API keys
- CRUD-ish requests + resolve + cancel + events
- Idempotency on `key`
- Tenant isolation tests

### Phase C — Web Inbox

- OAuth login (SaaS mode) + passwordless/dev login for self-host
- List/detail/resolve
- Audit timeline on detail

### Phase D — Resume path

- Signed webhooks + retries
- TS SDK create + wait + verify
- `vekinbox dev` tunnel

### Phase E — Notifications & escalation

- Email + Slack interactive
- Policy engine + timeout jobs

### Phase F — CLI, Compose, Docs, Private preview

- CLI essentials
- `docker compose` path
- Docs quickstarts
- Invite-only SaaS deploy

### Phase G — V1 hardening

- Python SDK, framework examples, SSE, OIDC self-host, metering, webhook dashboard

---

## 25. Naming & Identifiers (locked)

| Item | Value |
|---|---|
| Product | **VekInbox** |
| Repo | `github.com/LatticeAG/VekInbox` |
| npm SDK | `@latticeag/vekinbox` |
| npm CLI | `@latticeag/vekinbox-cli` |
| Docker | `ghcr.io/latticeag/vekinbox` |
| API keys | `vk_live_...` / `vk_test_...` |
| Cookies | `vekinbox_*` |
| Site path | `/products/vekinbox` |
| API | `api.vekinbox.latticeag.com` |

---

## 26. Open Questions (need your input)

Only items that still meaningfully benefit from your call. Everything else above is a **recommendation treated as default** until you override.

1. **SaaS worker host:** Fly.io (recommended) vs Railway vs AWS ECS? Any existing LatticeAG infra preference?
2. **Auth library:** Prefer **better-auth** vs hand-rolled OAuth + sessions for SaaS web?
3. **Runtime:** Node 22 vs Bun for API/workers? (Recommendation: **Node 22** for boring reliability; Bun later if you want.)
4. **Brand domain:** Confirm `vekinbox.latticeag.com` vs `inbox.vek.dev` or similar for product vanity URL.
5. **Design partners:** Do you already have 3–5 agent teams to invite, or should GTM assume cold start?
6. **Python SDK timing:** Immediately after TS MVP, or strictly post-first design-partner feedback?
7. **Auto-approve policies:** Keep hard non-goal for 6 months, or do regulated customers already ask for conditional auto-approve?
8. **Series coupling:** Should VekInbox share auth/org tables with other Vek products now, or stay standalone DB until a LatticeAG accounts service exists? (**Recommendation: standalone now**, shared “LatticeAG Account” later.)

### Questions already answered by this spec (defaults)

| Former open question | Default now |
|---|---|
| Backend language | TypeScript + Hono |
| CLI language | TypeScript (shared client) |
| Queue | BullMQ on Redis |
| Slack | Bolt |
| Email | Resend + SMTP |
| Repo name | `VekInbox` |
| UI kit | shadcn/ui + Radix + Tailwind |
| Launch examples | LangGraph, OpenAI Agents, CrewAI (Phase G) |
| OSS vs SaaS | **Hybrid** |

---

## 27. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-11 | Hybrid MIT OSS + invite-only SaaS | Trust + distribution + monetization fit for approval infra |
| 2026-07-11 | TypeScript monorepo (API/SDK/CLI/web) | Ship speed + shared types; Rust not required for MVP |
| 2026-07-11 | Idempotent `key` per workspace | Agent retries must not duplicate human work |
| 2026-07-11 | Default timeout action = decline | Fail-safe for irreversible agent tools |
| 2026-07-11 | Agents cannot resolve requests | Separates machine proposer from human authorizer |
| 2026-07-11 | Same Docker image for self-host and SaaS app tier | Prevent feature drift |

---

## 28. Out-of-Scope Reminder

This document is **planning only**. No application code, infra provisioning, or billing implementation should start until Phase A is explicitly kicked off and open questions you care about are answered or explicitly deferred.

---

*Spec version 0.2.0 — detailed planning expansion with Hybrid model locked and engineering defaults recommended.*
