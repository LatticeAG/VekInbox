# @latticeag/vekinbox-web

Reviewer inbox UI for self-hosted VekInbox.

## Development

```bash
# From monorepo root
pnpm install
pnpm --filter @latticeag/vekinbox-shared build

# Start API (port 3001) in one terminal
pnpm --filter @latticeag/vekinbox-api dev

# Start web (port 5173) in another
pnpm --filter @latticeag/vekinbox-web dev
```

The dev server proxies `/v1` → `http://localhost:3001`.

## Environment

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `""` (same origin) | API base URL. Empty uses Vite proxy in dev. |

## Routes

| Path | Description |
|---|---|
| `/login` | Dev email login (`POST /v1/auth/dev-login`) |
| `/inbox` | Request queue with Pending / Resolved / All tabs |
| `/inbox/:id` | Request detail with approve/decline/request_changes |
| `/settings` | Workspace info and agents list |

## API endpoints used

- `POST /v1/auth/dev-login` — session cookie auth
- `GET /v1/auth/me` — current user
- `GET /v1/workspaces` — list workspaces
- `GET /v1/workspaces/:id/agents` — list agents
- `GET /v1/requests?workspace_id=...` — list requests (session)
- `GET /v1/requests/:id` — request detail (session)
- `GET /v1/requests/:id/events` — audit timeline (session)
- `POST /v1/requests/:id/actions/:action` — resolve request
