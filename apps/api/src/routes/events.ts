import { Hono } from "hono";
import { and, eq, gt } from "drizzle-orm";
import { streamSSE } from "hono/streaming";
import { requests } from "@latticeag/vekinbox-db";
import { requireSession } from "../middleware/session.js";
import { assertWorkspaceMembership } from "../middleware/workspace-scope.js";
import { getDb } from "../lib/db.js";

export const eventsRoutes = new Hono();

eventsRoutes.get("/:id/events/stream", requireSession(), async (c) => {
  const session = c.get("sessionAuth");
  const workspaceId = c.req.param("id")!;
  await assertWorkspaceMembership(session.userId, workspaceId);

  const db = getDb();
  let lastPoll = new Date();

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({ workspace_id: workspaceId }),
    });

    while (!stream.closed) {
      await stream.sleep(5000);

      const rows = await db
        .select({
          id: requests.id,
          status: requests.status,
          updatedAt: requests.updatedAt,
        })
        .from(requests)
        .where(
          and(eq(requests.workspaceId, workspaceId), gt(requests.updatedAt, lastPoll)),
        );

      for (const row of rows) {
        await stream.writeSSE({
          event: "request.updated",
          data: JSON.stringify({
            type: "request.updated",
            request_id: row.id,
            status: row.status,
          }),
        });
      }

      lastPoll = new Date();
    }
  });
});
