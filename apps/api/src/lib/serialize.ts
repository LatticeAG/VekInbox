import type { Context } from "hono";
import type { Database } from "@latticeag/vekinbox-db";
import type { RequestStatus } from "@latticeag/vekinbox-shared";

export type AppVariables = {
  db: Database;
  agentId: string;
  workspaceId: string;
};

export type AppEnv = {
  Variables: AppVariables;
};

export function getDb(c: Context<AppEnv>): Database {
  return c.get("db");
}

export function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export function serializeRequest(row: {
  id: string;
  workspaceId: string;
  agentId: string;
  key: string;
  title: string;
  description: string;
  status: RequestStatus;
  priority: string;
  actions: unknown;
  defaultAction: string | null;
  timeoutAt: Date | null;
  escalationPolicyId: string | null;
  resumeWebhookUrl: string | null;
  metadata: unknown;
  labels: string[] | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionAction: string | null;
  resolutionNote: string | null;
  resolutionPayload: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  const resolutionPayload =
    row.resolutionAction || row.resolutionNote || row.resolutionPayload
      ? {
          action: row.resolutionAction ?? "",
          note: row.resolutionNote ?? undefined,
          ...(row.resolutionPayload &&
          typeof row.resolutionPayload === "object" &&
          row.resolutionPayload !== null
            ? (row.resolutionPayload as Record<string, unknown>)
            : {}),
        }
      : null;

  return {
    id: row.id,
    workspace_id: row.workspaceId,
    agent_id: row.agentId,
    key: row.key,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    actions: row.actions,
    default_action: row.defaultAction,
    timeout_at: toIso(row.timeoutAt),
    escalation_policy_id: row.escalationPolicyId,
    resume_webhook_url: row.resumeWebhookUrl,
    metadata: row.metadata ?? {},
    labels: row.labels ?? [],
    resolved_by: row.resolvedBy,
    resolved_at: toIso(row.resolvedAt),
    resolution_payload: resolutionPayload,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
