# VekInbox — SPEC.md

> Async human approval queue for AI agents.
> Series: **Vek** (agent APIs / data & state)
> Pattern: MIT OSS CLI/SDK + invite-only hosted SaaS

---

## 1. Problem & User Value

AI agents increasingly need to perform actions that are expensive, irreversible, or legally sensitive: sending money, deleting data, making purchases, sending emails on a user's behalf, updating production configs, or invoking tools outside their sandbox. Current agent frameworks handle this with hard-coded `human_in_the_loop` prompts that:

- Block the agent process until a human responds
- Offer no persistence, audit trail, or retry logic
- Have no centralized queue for teams
- Cannot escalate when the primary reviewer is unavailable
- Mix approval UX into agent code, making it hard to reuse or govern

**VekInbox** decouples the agent from the human. It gives agents an async approval API and gives humans a clean queue (web, Slack, email) to review, approve, decline, or escalate requests. Agents continue running other work while waiting; approvals resume them via webhooks.

### Value proposition

- For **agent builders**: Drop-in approval primitive with SDK + HTTP API; stop building ad-hoc human-in-the-loop plumbing.
- For **operators / platform teams**: Centralized queue, audit log, escalation, and timeout policies across all agents.
- For **approvers**: Familiar inbox UX, Slack/email notifications, one-click actions, clear context.
- For **executives / compliance**: Immutable request history, policy enforcement, and self-hosted option.

---

## 2. Target Users

1. **AI-agent engineering teams** building autonomous systems that touch real money, data, or customer-facing actions.
2. **Internal-tooling / platform teams** who want to wrap risky agent operations with a governance layer.
3. **SMBs using off-the-shelf agent frameworks** (OpenAI Agents, LangGraph, CrewAI, AutoGen, Mastra) that lack durable approval queues.
4. **Enterprise security / compliance reviewers** who need immutable audit trails and policy-based escalation.

---

## 3. Product Positioning

| Dimension | Decision |
|---|---|
| **Series** | Vek — agent as an API / durable agent state |
| **Pattern** | Open-source CLI and SDK under MIT + invite-only hosted SaaS |
| **Trust model** | Source is open; speed/moat is the managed hosted tier |
| **Deployment** | Self-hostable (single binary / Docker); managed cloud by invitation |
| **Pricing** | OSS free forever; SaaS free tier (1k approvals/mo), then per-request + seat-based |
| **Primary language** | TypeScript SDK first; CLI in Rust or TypeScript (decision: see Open Questions) |

### Why this positioning wins

- **Trust via OSS**: Approvals involve sensitive actions; users want to read the code and self-host.
- **Speed via SaaS**: Hosted queue, notifications, and escalation reduce operational burden.
- **Defensible moat**: Hosted version adds SSO, audit retention, analytics, and multi-region resilience that are painful to self-host.

---

## 4. Core Concepts

### Request
The central entity. An agent submits a `Request` when it needs human approval.

- `id` (uuid)
- `key` (string, agent-defined stable identifier, e.g. `invoice.pay.2026-07-11.001`)
- `title` (short human-readable summary)
- `description` (longer markdown context)
- `agent_id` (who created it)
- `workspace_id` / `organization_id` (scoping)
- `status`: `pending` → `approved` \| `declined` \| `timed_out` \| `escalated` \| `cancelled`
- `priority`: `low` | `normal` | `high` | `critical`
- `timeout_at` (ISO timestamp; optional)
- `escalation_policy_id` (optional)
- `metadata` (agent-provided JSON)
- `actions` (declared allowed outcomes: `approve`, `decline`, plus custom)
- `resume_webhook_url` (where to POST the result)
- `created_at`, `updated_at`, `resolved_at`, `resolved_by`

### Action
A possible outcome for a request. Default actions:

- `approve` — allow the agent to proceed
- `decline` — deny; agent should stop or fallback
- `request_changes` — send context back to the agent without finalizing
- Custom actions defined per workspace (e.g. `approve_with_limit`, `send_to_legal`)

### Inbox
A human-facing queue scoped to a user or team. Inboxes filter requests by:

- Assigned reviewer
- Tags / labels
- Priority
- Status
- Source agent / workspace

### Notification Channel
A way to reach a reviewer:

- Email
- Slack DM or channel
- Web UI (default)
- SMS / PagerDuty for critical (future)

### Escalation Policy
Rules that re-route a request if not resolved in time:

- If no response in `t`, notify secondary reviewer
- If still no response, notify manager / team channel
- If timeout reached, auto-resolve with default action (`decline` by default, or `approve` for low-risk)

### Agent Identity
Agents authenticate with API keys. An agent is registered under a workspace and has:

- `id`, `name`, `description`
- `permissions` (which request types it can create)
- `trusted_ips` (optional)
- `rate_limit` (requests per minute)

---

## 5. Core Features (MVP)

### F1. Submit a request (agent → VekInbox)
Agents create approval requests via HTTP API or SDK. Request is persisted and immediately visible in the inbox.

### F2. Reviewer inbox (web UI)
A minimal but polished web app where reviewers see:

- Pending, approved, declined, escalated tabs
- Search and filter
- Request detail with metadata and action buttons
- Audit trail per request

### F3. Resolve a request (human → VekInbox)
Reviewer approves, declines, or picks a custom action. VekInbox records the decision and optionally POSTs to the agent's `resume_webhook_url`.

### F4. Resume webhook (VekInbox → agent)
When a request is resolved, VekInbox POSTs a signed payload to the agent:

```json
{
  "request_id": "req_...",
  "status": "approved",
  "action": "approve",
  "resolved_by": "user_...",
  "resolved_at": "2026-07-11T12:34:56Z",
  "signature": "sha256=..."
}
```

Agent SDK verifies signature and resumes execution.

### F5. Slack notifications
Approvers receive Slack DM or channel message with request summary and interactive approve/decline buttons.

### F6. Email notifications
HTML/text email with approve/decline links that authenticate the reviewer briefly via signed token.

### F7. Escalation and timeout
Per-request or workspace-level policies. Timeouts and escalations are scheduled server-side.

### F8. Audit log
Immutable event stream:

- `request.created`
- `request.notified`
- `request.viewed`
- `request.resolved`
- `request.escalated`
- `request.timed_out`
- `request.cancelled`

### F9. Workspaces and multi-tenancy
Organizations, workspaces, and teams isolate requests and reviewers. SaaS uses this for billing and scoping.

### F10. CLI
A command-line tool to:

- Submit requests from scripts / CI
- List, inspect, and resolve requests
- Manage workspaces, agents, and API keys
- Stream webhook events locally for development

---

## 6. Non-Goals (MVP)

These are intentionally out of scope for the MVP to preserve velocity:

- Real-time collaborative request commenting (threaded discussion)
- Native mobile apps
- Advanced analytics dashboards
- Fine-grained RBAC beyond workspace owner / admin / reviewer
- Custom UI branding / white-label hosted UI
- On-premise enterprise SSO (SaaS starts with GitHub/Google OAuth)
- Support for non-HTTP agent transports (e.g. gRPC, WebSocket control plane)
- Billing/payment self-serve UI (manual invoicing in invite-only SaaS)
- AI-suggested approval (auto-approve heuristics)

---

## 7. Data Model

### Entities

```
Organization
  └── Workspace
        ├── User (reviewer, admin, owner)
        ├── Agent
        ├── ApiKey
        ├── EscalationPolicy
        ├── NotificationChannel
        ├── Request
        │     ├── RequestEvent (audit log)
        │     ├── RequestAssignment
        │     └── RequestNotification
        └── InboxView
```

### Key schemas (high-level)

**Request**
- id: uuid PK
- workspace_id: uuid FK
- agent_id: uuid FK
- key: string (unique per workspace)
- title: string
- description: text (markdown)
- status: enum
- priority: enum
- actions: jsonb
- default_action: string
- timeout_at: timestamp nullable
- escalation_policy_id: uuid FK nullable
- resume_webhook_url: text nullable
- metadata: jsonb
- resolved_by: uuid FK nullable
- resolved_at: timestamp nullable
- created_at, updated_at: timestamps

**RequestEvent**
- id: uuid PK
- request_id: uuid FK
- type: enum
- actor_id: uuid nullable
- payload: jsonb
- created_at: timestamp

**EscalationPolicy**
- id: uuid PK
- workspace_id: uuid FK
- name: string
- steps: jsonb [{ delay_ms, notify_user_id or channel_id, action }]
- default_action_on_timeout: string

---

## 8. API Surface

Base URL:

- SaaS: `https://api.vekinbox.latticeag.com/v1`
- Self-hosted: configured by operator

### Authentication
API key via header: `Authorization: Bearer vk_...`

### Endpoints

#### Requests

| Method | Path | Description |
|---|---|---|
| POST | `/requests` | Create a request |
| GET | `/requests` | List requests (filter by status, priority, agent, assignee) |
| GET | `/requests/:id` | Get request detail |
| POST | `/requests/:id/actions/:action` | Resolve a request |
| POST | `/requests/:id/cancel` | Cancel pending request |
| GET | `/requests/:id/events` | Audit log |

#### Workspaces & Agents

| Method | Path | Description |
|---|---|---|
| GET | `/workspaces` | List workspaces for caller |
| POST | `/workspaces` | Create workspace |
| GET | `/workspaces/:id/agents` | List agents |
| POST | `/workspaces/:id/agents` | Register agent |
| POST | `/agents/:id/keys` | Rotate API key |

#### Users & Channels

| Method | Path | Description |
|---|---|---|
| GET | `/workspaces/:id/users` | List users |
| POST | `/workspaces/:id/users` | Invite user |
| GET | `/workspaces/:id/channels` | List notification channels |
| POST | `/workspaces/:id/channels` | Add channel |

#### Escalation Policies

| Method | Path | Description |
|---|---|---|
| GET | `/workspaces/:id/policies` | List policies |
| POST | `/workspaces/:id/policies` | Create policy |
| PUT | `/policies/:id` | Update policy |

#### Webhooks

| Method | Path | Description |
|---|---|---|
| POST | `/webhooks/resume` (agent endpoint) | Agent receives resolution payloads |

### SDK (TypeScript)

```ts
import { VekInbox } from "@latticeag/vekinbox";

const inbox = new VekInbox({ apiKey: process.env.VEKINBOX_API_KEY });

const request = await inbox.requests.create({
  workspaceId: "ws_...",
  agentId: "agent_...",
  key: "invoice.pay.001",
  title: "Approve $450 invoice payment?",
  description: "Vendor: Acme Corp. Invoice #1024.",
  priority: "high",
  timeout: "1h",
  actions: ["approve", "decline", "request_changes"],
  resumeWebhook: "https://my-agent.example.com/resume",
  metadata: { invoice_id: 1024 },
});

// Block until resolved
const result = await request.waitForResolution({ timeout: "1h" });
if (result.status === "approved") {
  await payInvoice(result.metadata.invoice_id);
}
```

### CLI examples

```bash
# Configure
vekinbox auth login
vekinbox workspace use ws_...

# Submit request
vekinbox request create \
  --agent agent_... \
  --title "Approve $450 invoice payment?" \
  --priority high \
  --timeout 1h \
  --resume-webhook https://my-agent.example.com/resume

# List pending
vekinbox request list --status pending

# Resolve
vekinbox request resolve req_... --action approve

# Stream local webhook events
vekinbox dev --forward-to http://localhost:3000/resume
```

---

## 9. CLI Commands

```
vekinbox auth login              # OAuth / token login
vekinbox auth logout
vekinbox auth status

vekinbox workspace list
vekinbox workspace create --name "Engineering"
vekinbox workspace use <id>

vekinbox agent list
vekinbox agent create --name "billing-agent"
vekinbox agent key rotate <agent-id>

vekinbox request create [flags]
vekinbox request list [filters]
vekinbox request show <id>
vekinbox request resolve <id> --action <action>
vekinbox request cancel <id>
vekinbox request events <id>

vekinbox policy list
vekinbox policy create --name "after-hours" --from-file policy.yaml

vekinbox channel add-slack --workspace-id <id> --channel #approvals
vekinbox channel add-email --user-id <id>

vekinbox dev --forward-to <url>  # Local webhook tunnel
```

---

## 10. Security Model

### Threat model priorities

1. **Spoofed approvals**: An attacker must not be able to approve their own request.
2. **Webhook tampering**: Resume payloads must be signed and verifiable.
3. **Privilege escalation**: Agents can only create requests; reviewers can only resolve requests in their workspace.
4. **Secret leakage**: API keys and OAuth tokens encrypted at rest, never logged.
5. **Tenant isolation**: Workspace data must never leak across tenants.

### Authentication & authorization

- API keys: `vk_live_...` / `vk_test_...` prefixes, workspace-scoped, rotatable.
- Human auth: OAuth 2.0 via GitHub / Google (SaaS); self-hosted supports OIDC.
- Reviewer actions require active session + workspace membership.
- Signed email action links expire after use and after a short TTL.

### Webhook security

- HMAC-SHA256 signature in `X-VekInbox-Signature` header.
- Timestamp tolerance (`X-VekInbox-Timestamp`) to prevent replay.
- SDK provides verification helper.

### Data handling

- TLS 1.3 for all transport.
- PII encrypted at rest.
- Audit log append-only; operators can stream to external SIEM.

---

## 11. Deployment Model

### Self-hosted

- Single container image (`ghcr.io/latticeag/vekinbox`)
- Requires Postgres 15+ and Redis 7+
- Stateless API servers; horizontal scaling supported
- Environment-variable configuration
- No external SaaS dependency

### Hosted SaaS (invite-only)

- Multi-region Cloudflare / AWS deployment
- Managed Postgres, Redis, queues
- Built-in Slack app and email provider
- SSO and audit retention as paid add-ons

### Local development

- `docker compose up` spins API, web UI, Postgres, Redis, and a local mail catcher
- CLI includes `vekinbox dev --forward-to` for webhook tunneling

---

## 12. Architecture (MVP)

### Backend

- HTTP API server (Node/TypeScript with Fastify or Hono, or Rust with Axum — see Open Questions)
- Job queue (BullMQ on Redis) for notifications, escalation, timeouts
- Postgres for persistence
- Object/file storage not required for MVP

### Web UI

- React + Vite + Tailwind CSS
- Server-side session or token auth
- Real-time inbox via polling (WebSocket future)

### CLI

- Rust (clap) or Node (oclif). Decision in Open Questions.

### SDK

- TypeScript first; Python second (after launch).

---

## 13. 6-Day MVP Milestones

### Day 1 — Foundation
- Finalize tech stack decisions (see Open Questions)
- Set up repo, CI, linting, tests
- Postgres schema migrations for organizations, workspaces, users, agents, requests, events

### Day 2 — Core API
- Implement `POST /requests`, `GET /requests`, `GET /requests/:id`, `POST /requests/:id/actions/:action`, `POST /requests/:id/cancel`
- API key authentication
- Basic audit events

### Day 3 — Web UI
- Reviewer inbox with list/detail views
- Login and workspace switching
- Approve / decline / request-changes flows

### Day 4 — Resume Webhooks & SDK
- Signed resume webhook delivery
- Retry with exponential backoff
- TypeScript SDK with `waitForResolution` polling

### Day 5 — Notifications & Escalation
- Email notifications via Resend / SMTP
- Slack app with interactive buttons
- Escalation policy engine and timeout scheduler

### Day 6 — CLI, Docs & Polish
- CLI commands for create/list/resolve/dev
- README, API docs, SDK docs
- End-to-end smoke tests
- Private hosted preview deployed

---

## 14. Pricing & Positioning

### OSS
- Free, MIT licensed.
- Self-hosted with no usage limits.
- Community support via GitHub issues.

### SaaS (invite-only)

| Tier | Monthly approvals | Seats | Price |
|---|---|---|---|
| Starter | 1,000 | 3 | Free |
| Team | 10,000 | 10 | $49/mo + $0.005 per extra approval |
| Growth | 100,000 | 50 | $199/mo + overages |
| Enterprise | Unlimited | Unlimited | Custom |

### Add-ons
- SSO (SAML/OIDC): $50/mo per workspace
- Extended audit retention (1 year+): $30/mo
- Priority support: 20% of plan cost

### Positioning statement

> "VekInbox is the durable human approval layer for AI agents. Open-source it, self-host it, or let us run it for you — either way, your agents never act alone on something that matters."

---

## 15. Success Metrics

- **Adoption**: GitHub stars, SDK downloads, self-hosted deployments
- **Usage**: Requests created, time-to-resolution, escalation rate
- **Reliability**: Webhook delivery success rate, uptime
- **SaaS conversion**: Teams moving from self-hosted to invite-only hosted

---

## 16. Open Questions

1. **Backend language**: TypeScript/Hono on Node vs Rust/Axum? Rust is consistent with other Vek tools; TypeScript accelerates SDK sharing.
2. **CLI language**: Rust (clap) for standalone binary distribution, or Node (oclif) to share code with SDK?
3. **Queue implementation**: BullMQ (Node) or a language-agnostic scheduler? Decision depends on backend language.
4. **Slack app hosting**: Use Slack Bolt or implement OAuth + interactions manually?
5. **Email provider**: Resend for SaaS, SMTP-configurable for self-hosted?
6. **Final repo name**: `VekInbox` (camel) vs `vekinbox` (lowercase). Use `VekInbox` to match LatticeAG product naming.
7. **UI framework**: React + Tailwind confirmed; confirm component library (Radix/Shadcn vs headless).
8. **Initial supported agent frameworks**: SDK examples for OpenAI Agents, LangGraph, and CrewAI at launch?

---

## 17. Naming & Identifiers

Use consistently across all layers:

- Product name: **VekInbox**
- Repo slug: `VekInbox`
- Full repo path: `github.com/LatticeAG/VekInbox`
- npm scope: `@latticeag/vekinbox`
- Crate name (if Rust CLI): `vekinbox-cli`
- Docker image: `ghcr.io/latticeag/vekinbox`
- API key prefix: `vk_`
- Cookie name prefix: `vekinbox_`
- URL slug on latticeag.com: `/products/vekinbox`

---

*Spec version 0.1.0 — initial draft.*
