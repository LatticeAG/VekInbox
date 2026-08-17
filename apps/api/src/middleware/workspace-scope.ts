import { and, eq } from "drizzle-orm";
import { memberships } from "@latticeag/vekinbox-db";
import { VekInboxError } from "@latticeag/vekinbox-shared";
import { getDb } from "../lib/db.js";

const ADMIN_WORKSPACE_ROLES = new Set(["admin", "owner"]);

/**
 * Channel configuration changes can disclose or redirect approval notices.
 * Keep the role check explicit and shared so reviewer/viewer memberships
 * cannot gain configuration authority through a route-level regression.
 */
export function isAdminWorkspaceRole(role: string): boolean {
  return ADMIN_WORKSPACE_ROLES.has(role);
}

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
  if (!isAdminWorkspaceRole(membership.role)) {
    throw new VekInboxError("forbidden", "Admin access required", 403);
  }
  return membership;
}

/** View-only workspace membership is deliberately not decision authority. */
export async function assertReviewerMembership(userId: string, workspaceId: string) {
  const membership = await assertWorkspaceMembership(userId, workspaceId);
  if (membership.role === "viewer") {
    throw new VekInboxError("forbidden", "Reviewer access required", 403);
  }
  return membership;
}
