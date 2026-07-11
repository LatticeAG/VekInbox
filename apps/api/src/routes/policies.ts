import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { createPolicySchema } from "@latticeag/vekinbox-shared";
import { escalationPolicies } from "@latticeag/vekinbox-db";
import { generateId } from "@latticeag/vekinbox-shared";
import { requireSession } from "../middleware/session.js";
import { assertWorkspaceMembership } from "../middleware/workspace-scope.js";
import { getDb } from "../lib/db.js";

export const policyRoutes = new Hono();

policyRoutes.use("*", requireSession());

policyRoutes.get("/workspaces/:id/policies", async (c) => {
  const session = c.get("sessionAuth");
  const workspaceId = c.req.param("id");
  await assertWorkspaceMembership(session.userId, workspaceId);

  const db = getDb();
  const rows = await db
    .select()
    .from(escalationPolicies)
    .where(eq(escalationPolicies.workspaceId, workspaceId))
    .orderBy(desc(escalationPolicies.createdAt));

  return c.json({
    data: rows.map((p) => ({
      id: p.id,
      workspace_id: p.workspaceId,
      name: p.name,
      steps: p.steps,
      default_action_on_timeout: p.defaultActionOnTimeout,
      created_at: p.createdAt.toISOString(),
      updated_at: p.updatedAt.toISOString(),
    })),
  });
});

policyRoutes.post("/workspaces/:id/policies", async (c) => {
  const session = c.get("sessionAuth");
  const workspaceId = c.req.param("id");
  await assertWorkspaceMembership(session.userId, workspaceId);

  const body = createPolicySchema.parse(await c.req.json());
  const db = getDb();
  const now = new Date();
  const id = generateId("pol");

  const [policy] = await db
    .insert(escalationPolicies)
    .values({
      id,
      workspaceId,
      name: body.name,
      steps: body.steps,
      defaultActionOnTimeout: body.default_action_on_timeout ?? "decline",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return c.json(
    {
      id: policy!.id,
      workspace_id: policy!.workspaceId,
      name: policy!.name,
      steps: policy!.steps,
      default_action_on_timeout: policy!.defaultActionOnTimeout,
      created_at: policy!.createdAt.toISOString(),
      updated_at: policy!.updatedAt.toISOString(),
    },
    201,
  );
});
