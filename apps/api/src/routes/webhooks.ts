import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { notFound, requestNotResolvable } from "@latticeag/vekinbox-shared";
import { requests } from "@latticeag/vekinbox-db";
import { requireSession } from "../middleware/session.js";
import {
  assertAdminMembership,
  assertWorkspaceMembership,
} from "../middleware/workspace-scope.js";
import { getDb } from "../lib/db.js";
import { listWebhookDeliveries, redeliverWebhook } from "../services/webhook.service.js";

export const webhookRoutes = new Hono();

webhookRoutes.use("*", requireSession());

webhookRoutes.get("/:id/webhooks", async (c) => {
  const session = c.get("sessionAuth");
  const requestId = c.req.param("id")!;
  const db = getDb();

  const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!row) {
    throw notFound("Request", requestId);
  }

  await assertWorkspaceMembership(session.userId, row.workspaceId);
  const deliveries = await listWebhookDeliveries(requestId);
  return c.json({ data: deliveries });
});

webhookRoutes.post("/:id/webhooks/redeliver", async (c) => {
  const session = c.get("sessionAuth");
  const requestId = c.req.param("id")!;
  const db = getDb();

  const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!row) {
    throw notFound("Request", requestId);
  }

  await assertAdminMembership(session.userId, row.workspaceId);

  if (row.status === "pending" || row.status === "changes_requested") {
    throw requestNotResolvable(requestId, row.status);
  }

  if (!row.resumeWebhookUrl) {
    return c.json({ error: { code: "validation_error", message: "Request has no resume webhook URL" } }, 400);
  }

  const resolutionPayload = row.resolutionPayload as { action?: string; note?: string } | null;
  const action = row.resolutionAction ?? resolutionPayload?.action ?? row.status;

  const result = await redeliverWebhook({
    requestId,
    agentId: row.agentId,
    url: row.resumeWebhookUrl,
    action,
    resolvedBy: row.resolvedBy,
    note: row.resolutionNote ?? resolutionPayload?.note,
    request: {
      id: row.id,
      workspaceId: row.workspaceId,
      agentId: row.agentId,
      key: row.key,
      status: row.status,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      resolvedAt: row.resolvedAt,
    },
  });

  return c.json({ ok: true, ...result }, 202);
});
