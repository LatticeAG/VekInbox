import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createAgentSchema, createWorkspaceSchema } from "@latticeag/vekinbox-shared";
import {
  agents,
  memberships,
  organizations,
  workspaces,
} from "@latticeag/vekinbox-db";
import { generateId } from "@latticeag/vekinbox-shared";
import { requireSession } from "../middleware/session.js";
import { assertWorkspaceMembership } from "../middleware/workspace-scope.js";
import { generateWebhookSecret } from "../lib/crypto.js";
import { getDb } from "../lib/db.js";
import { slugify } from "../lib/ids.js";

export const workspaceRoutes = new Hono();

workspaceRoutes.use("*", requireSession());

workspaceRoutes.get("/", async (c) => {
  const session = c.get("sessionAuth");
  const db = getDb();

  const rows = await db
    .select({
      workspace: workspaces,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, session.userId));

  return c.json({
    data: rows.map((r) => ({
      id: r.workspace.id,
      name: r.workspace.name,
      slug: r.workspace.slug,
      role: r.role,
      created_at: r.workspace.createdAt.toISOString(),
      updated_at: r.workspace.updatedAt.toISOString(),
    })),
  });
});

workspaceRoutes.post("/", async (c) => {
  const session = c.get("sessionAuth");
  const body = createWorkspaceSchema.parse(await c.req.json());
  const db = getDb();

  const orgId = generateId("org");
  const workspaceId = generateId("ws");
  const membershipId = generateId("mbr");
  const slug = body.slug ?? slugify(body.name);
  const now = new Date();

  await db.insert(organizations).values({
    id: orgId,
    name: body.name,
    createdAt: now,
    updatedAt: now,
  });

  const [workspace] = await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      organizationId: orgId,
      name: body.name,
      slug,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(memberships).values({
    id: membershipId,
    userId: session.userId,
    workspaceId,
    role: "owner",
    createdAt: now,
  });

  return c.json(
    {
      id: workspace!.id,
      name: workspace!.name,
      slug: workspace!.slug,
      created_at: workspace!.createdAt.toISOString(),
      updated_at: workspace!.updatedAt.toISOString(),
    },
    201,
  );
});

workspaceRoutes.get("/:id/agents", async (c) => {
  const session = c.get("sessionAuth");
  const workspaceId = c.req.param("id");
  await assertWorkspaceMembership(session.userId, workspaceId);

  const db = getDb();
  const rows = await db.select().from(agents).where(eq(agents.workspaceId, workspaceId));

  return c.json({
    data: rows.map((a) => ({
      id: a.id,
      workspace_id: a.workspaceId,
      name: a.name,
      description: a.description,
      permissions: (a.permissions as Record<string, unknown>) ?? {},
      created_at: a.createdAt.toISOString(),
      updated_at: a.updatedAt.toISOString(),
    })),
  });
});

workspaceRoutes.post("/:id/agents", async (c) => {
  const session = c.get("sessionAuth");
  const workspaceId = c.req.param("id");
  await assertWorkspaceMembership(session.userId, workspaceId);

  const body = createAgentSchema.parse(await c.req.json());
  const db = getDb();
  const now = new Date();
  const id = generateId("agent");

  const [agent] = await db
    .insert(agents)
    .values({
      id,
      workspaceId,
      name: body.name,
      description: body.description ?? "",
      permissions: body.permissions ?? {},
      webhookSecret: generateWebhookSecret(),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return c.json(
    {
      id: agent!.id,
      workspace_id: agent!.workspaceId,
      name: agent!.name,
      description: agent!.description,
      permissions: (agent!.permissions as Record<string, unknown>) ?? {},
      created_at: agent!.createdAt.toISOString(),
      updated_at: agent!.updatedAt.toISOString(),
    },
    201,
  );
});
