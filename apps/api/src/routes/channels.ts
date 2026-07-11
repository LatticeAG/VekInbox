import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { createChannelSchema } from "@latticeag/vekinbox-shared";
import { notificationChannels } from "@latticeag/vekinbox-db";
import { generateId } from "@latticeag/vekinbox-shared";
import { requireSession } from "../middleware/session.js";
import { assertWorkspaceMembership } from "../middleware/workspace-scope.js";
import { getDb } from "../lib/db.js";

export const channelRoutes = new Hono();

channelRoutes.use("*", requireSession());

channelRoutes.get("/workspaces/:id/channels", async (c) => {
  const session = c.get("sessionAuth");
  const workspaceId = c.req.param("id");
  await assertWorkspaceMembership(session.userId, workspaceId);

  const db = getDb();
  const rows = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.workspaceId, workspaceId))
    .orderBy(desc(notificationChannels.createdAt));

  return c.json({
    data: rows.map((ch) => {
      const config = (ch.config as Record<string, unknown>) ?? {};
      return {
        id: ch.id,
        workspace_id: ch.workspaceId,
        type: ch.type,
        name: (config["name"] as string) ?? ch.type,
        config,
        enabled: ch.enabled,
        created_at: ch.createdAt.toISOString(),
        updated_at: ch.updatedAt.toISOString(),
      };
    }),
  });
});

channelRoutes.post("/workspaces/:id/channels", async (c) => {
  const session = c.get("sessionAuth");
  const workspaceId = c.req.param("id");
  await assertWorkspaceMembership(session.userId, workspaceId);

  const body = createChannelSchema.parse(await c.req.json());
  const db = getDb();
  const now = new Date();
  const id = generateId("ch");

  const [channel] = await db
    .insert(notificationChannels)
    .values({
      id,
      workspaceId,
      type: body.type,
      config: { name: body.name, ...(body.config ?? {}) },
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const config = (channel!.config as Record<string, unknown>) ?? {};

  return c.json(
    {
      id: channel!.id,
      workspace_id: channel!.workspaceId,
      type: channel!.type,
      name: (config["name"] as string) ?? body.name,
      config,
      enabled: channel!.enabled,
      created_at: channel!.createdAt.toISOString(),
      updated_at: channel!.updatedAt.toISOString(),
    },
    201,
  );
});
