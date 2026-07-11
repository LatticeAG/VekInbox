import { and, eq } from "drizzle-orm";
import { memberships } from "@latticeag/vekinbox-db";
import { VekInboxError } from "@latticeag/vekinbox-shared";
import { getDb } from "../lib/db.js";

export async function assertWorkspaceMembership(userId: string, workspaceId: string) {
  const db = getDb();
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);

  if (!membership) {
    throw new VekInboxError("forbidden", "You do not have access to this workspace", 403);
  }

  return membership;
}

export async function assertAdminMembership(userId: string, workspaceId: string) {
  const membership = await assertWorkspaceMembership(userId, workspaceId);
  if (membership.role !== "admin" && membership.role !== "owner") {
    throw new VekInboxError("forbidden", "Admin access required", 403);
  }
  return membership;
}
