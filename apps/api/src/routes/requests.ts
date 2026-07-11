import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  cancelRequestSchema,
  createRequestSchema,
  listRequestsQuerySchema,
  notFound,
  resolveRequestSchema,
} from "@latticeag/vekinbox-shared";
import { requests } from "@latticeag/vekinbox-db";
import { requireApiKey } from "../middleware/auth.js";
import { getWorkspaceIdForRequest, requireReviewerOrApiKey } from "../middleware/dual-auth.js";
import { requireSession } from "../middleware/session.js";
import { assertWorkspaceMembership } from "../middleware/workspace-scope.js";
import { getDb } from "../lib/db.js";
import {
  cancelRequest,
  createRequest,
  getRequest,
  getRequestEvents,
  listRequests,
  listRequestsForApiKey,
  resolveRequest,
} from "../services/request.service.js";

export const requestRoutes = new Hono();

requestRoutes.post("/", requireApiKey(), async (c) => {
  const body = createRequestSchema.parse(await c.req.json());
  const auth = c.get("apiKeyAuth");
  const request = await createRequest(auth, body);
  return c.json(request, 201);
});

requestRoutes.get("/", requireReviewerOrApiKey, async (c) => {
  const query = listRequestsQuerySchema.parse(c.req.query());
  const session = c.get("sessionAuth");

  if (session) {
    const workspaceId = getWorkspaceIdForRequest(c);
    await assertWorkspaceMembership(session.userId, workspaceId);
    const result = await listRequests(workspaceId, query);
    return c.json(result);
  }

  const auth = c.get("apiKeyAuth");
  const result = await listRequestsForApiKey(auth, query);
  return c.json(result);
});

requestRoutes.get("/:id", requireReviewerOrApiKey, async (c) => {
  const session = c.get("sessionAuth");
  const requestId = c.req.param("id")!;

  if (session) {
    const db = getDb();
    const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
    if (!row) {
      throw notFound("Request", requestId);
    }
    await assertWorkspaceMembership(session.userId, row.workspaceId);
    const request = await getRequest(row.workspaceId, requestId);
    return c.json(request);
  }

  const auth = c.get("apiKeyAuth");
  const request = await getRequest(auth.workspaceId, requestId);
  return c.json(request);
});

requestRoutes.post("/:id/actions/:action", requireSession(), async (c) => {
  const session = c.get("sessionAuth");
  const body = resolveRequestSchema.parse(await c.req.json().catch(() => ({})));
  const requestId = c.req.param("id")!;
  const action = c.req.param("action")!;

  const db = getDb();
  const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!row) {
    throw notFound("Request", requestId);
  }

  await assertWorkspaceMembership(session.userId, row.workspaceId);

  const request = await resolveRequest({
    workspaceId: row.workspaceId,
    requestId,
    action,
    resolvedBy: session.userId,
    input: body,
  });

  return c.json(request);
});

requestRoutes.post("/:id/cancel", requireApiKey(), async (c) => {
  const auth = c.get("apiKeyAuth");
  const body = cancelRequestSchema.parse(await c.req.json().catch(() => ({})));
  const request = await cancelRequest(auth, c.req.param("id")!, body.reason);
  return c.json(request);
});

requestRoutes.get("/:id/events", requireReviewerOrApiKey, async (c) => {
  const session = c.get("sessionAuth");
  const requestId = c.req.param("id")!;

  if (session) {
    const db = getDb();
    const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
    if (!row) {
      throw notFound("Request", requestId);
    }
    await assertWorkspaceMembership(session.userId, row.workspaceId);
    const events = await getRequestEvents(row.workspaceId, requestId);
    return c.json({ data: events });
  }

  const auth = c.get("apiKeyAuth");
  const events = await getRequestEvents(auth.workspaceId, requestId);
  return c.json({ data: events });
});
