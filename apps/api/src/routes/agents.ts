import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createApiKeySchema, notFound } from "@latticeag/vekinbox-shared";
import { agents } from "@latticeag/vekinbox-db";
import { requireSession } from "../middleware/session.js";
import { assertWorkspaceMembership } from "../middleware/workspace-scope.js";
import { createApiKeyForAgent, revokeApiKey } from "../services/api-key.service.js";
import { getDb } from "../lib/db.js";

export const agentRoutes = new Hono();

agentRoutes.use("*", requireSession());

agentRoutes.post("/:id/keys", async (c) => {
  const session = c.get("sessionAuth");
  const agentId = c.req.param("id");
  const body = createApiKeySchema.parse(await c.req.json());

  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    throw notFound("Agent", agentId);
  }

  await assertWorkspaceMembership(session.userId, agent.workspaceId);

  const created = await createApiKeyForAgent(agentId, body.name, body.environment);

  return c.json(
    {
      id: created.id,
      agent_id: created.agentId,
      name: created.name,
      prefix: created.keyPrefix,
      environment: created.environment,
      key: created.key,
      created_at: created.createdAt.toISOString(),
      revoked_at: created.revokedAt ? created.revokedAt.toISOString() : null,
    },
    201,
  );
});

agentRoutes.delete("/:id/keys/:keyId", async (c) => {
  const session = c.get("sessionAuth");
  const agentId = c.req.param("id");
  const keyId = c.req.param("keyId");

  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    throw notFound("Agent", agentId);
  }

  await assertWorkspaceMembership(session.userId, agent.workspaceId);

  const revoked = await revokeApiKey(agentId, keyId);
  if (!revoked) {
    throw notFound("API key", keyId);
  }

  return c.body(null, 204);
});
