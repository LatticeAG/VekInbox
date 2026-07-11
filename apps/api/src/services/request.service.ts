import {
  actionToStatus,
  invalidAction,
  normalizeActions,
  notFound,
  requestAlreadyResolved,
  requestNotResolvable,
  type CreateRequestApiInput,
  type ListRequestsQuery,
  type RequestResponse,
  type ResolveRequestApiInput,
} from "@latticeag/vekinbox-shared";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import {
  requestAssignments,
  requests,
  workspaces,
} from "@latticeag/vekinbox-db";
import { generateId } from "@latticeag/vekinbox-shared";
import { getDb } from "../lib/db.js";
import { appendRequestEvent, listRequestEvents } from "./audit.service.js";
import { queueWebhookDelivery } from "./webhook.service.js";
import type { ApiKeyAuth } from "../middleware/auth.js";

function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function mapRequest(row: typeof requests.$inferSelect): RequestResponse {
  const resolutionPayload =
    row.resolutionPayload ??
    (row.resolutionAction
      ? {
          action: row.resolutionAction,
          note: row.resolutionNote ?? undefined,
        }
      : null);

  return {
    id: row.id,
    workspace_id: row.workspaceId,
    agent_id: row.agentId,
    key: row.key,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    actions: (row.actions as RequestResponse["actions"]) ?? [],
    default_action: row.defaultAction,
    timeout_at: toIso(row.timeoutAt),
    escalation_policy_id: row.escalationPolicyId,
    resume_webhook_url: row.resumeWebhookUrl,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    labels: row.labels ?? [],
    resolved_by: row.resolvedBy,
    resolved_at: toIso(row.resolvedAt),
    resolution_payload: resolutionPayload as Record<string, unknown> | null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function createRequest(
  auth: ApiKeyAuth,
  input: CreateRequestApiInput,
): Promise<RequestResponse> {
  const db = getDb();

  if (input.workspace_id !== auth.workspaceId) {
    throw notFound("Workspace", input.workspace_id);
  }

  const [existing] = await db
    .select()
    .from(requests)
    .where(and(eq(requests.workspaceId, input.workspace_id), eq(requests.key, input.key)))
    .limit(1);

  if (existing) {
    if (input.return_existing) {
      await db
        .update(requests)
        .set({
          idempotencyReusedCount: sql`${requests.idempotencyReusedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(requests.id, existing.id));
      return mapRequest(existing);
    }
    throw requestAlreadyResolved(existing.id, existing.status);
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, input.workspace_id))
    .limit(1);

  if (!workspace) {
    throw notFound("Workspace", input.workspace_id);
  }

  const actions = normalizeActions(input.actions);
  const now = new Date();
  const id = generateId("req");

  const [created] = await db
    .insert(requests)
    .values({
      id,
      organizationId: workspace.organizationId,
      workspaceId: input.workspace_id,
      agentId: auth.agentId,
      key: input.key,
      title: input.title,
      description: input.description ?? "",
      status: "pending",
      priority: input.priority ?? "normal",
      actions,
      defaultAction: input.default_action,
      timeoutAt: input.timeout_at ? new Date(input.timeout_at) : null,
      escalationPolicyId: input.escalation_policy_id,
      resumeWebhookUrl: input.resume_webhook_url,
      metadata: input.metadata ?? {},
      labels: input.labels ?? [],
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (input.assignees?.length) {
    await db.insert(requestAssignments).values(
      input.assignees.map((userId) => ({
        id: generateId("asg"),
        requestId: id,
        userId,
      })),
    );
  }

  await appendRequestEvent({
    requestId: id,
    type: "request.created",
    actorType: "agent",
    actorId: auth.agentId,
    payload: { key: input.key, title: input.title },
  });

  return mapRequest(created!);
}

export async function listRequests(
  workspaceId: string,
  query: ListRequestsQuery,
): Promise<{ data: RequestResponse[]; next_cursor: string | null }> {
  const db = getDb();
  const conditions = [eq(requests.workspaceId, workspaceId)];

  if (query.status) {
    conditions.push(eq(requests.status, query.status));
  }
  if (query.priority) {
    conditions.push(eq(requests.priority, query.priority));
  }
  if (query.agent_id) {
    conditions.push(eq(requests.agentId, query.agent_id));
  }
  if (query.cursor) {
    conditions.push(lt(requests.createdAt, new Date(query.cursor)));
  }

  const rows = await db
    .select()
    .from(requests)
    .where(and(...conditions))
    .orderBy(desc(requests.createdAt))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const data = (hasMore ? rows.slice(0, query.limit) : rows).map(mapRequest);
  const next_cursor = hasMore ? data[data.length - 1]!.created_at : null;

  return { data, next_cursor };
}

export async function getRequest(workspaceId: string, requestId: string): Promise<RequestResponse> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(requests)
    .where(and(eq(requests.id, requestId), eq(requests.workspaceId, workspaceId)))
    .limit(1);

  if (!row) {
    throw notFound("Request", requestId);
  }

  return mapRequest(row);
}

export async function resolveRequest(params: {
  workspaceId: string;
  requestId: string;
  action: string;
  resolvedBy: string;
  input: ResolveRequestApiInput;
}): Promise<RequestResponse> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(requests)
    .where(and(eq(requests.id, params.requestId), eq(requests.workspaceId, params.workspaceId)))
    .limit(1);

  if (!row) {
    throw notFound("Request", params.requestId);
  }

  if (row.status !== "pending" && row.status !== "changes_requested") {
    if (row.status === "approved" || row.status === "declined" || row.status === "cancelled") {
      throw requestAlreadyResolved(params.requestId, row.status);
    }
    throw requestNotResolvable(params.requestId, row.status);
  }

  const actionList = (row.actions as { name: string }[]) ?? [];
  const allowedActions = actionList.map((a) => a.name);
  if (!allowedActions.includes(params.action)) {
    throw invalidAction(params.requestId, params.action);
  }

  const newStatus = actionToStatus(params.action) as typeof row.status;
  const now = new Date();
  const resolutionPayload = {
    action: params.action,
    note: params.input.note,
    payload: params.input.payload,
  };

  const [updated] = await db
    .update(requests)
    .set({
      status: newStatus,
      resolvedBy: params.resolvedBy,
      resolvedAt: now,
      resolutionAction: params.action,
      resolutionNote: params.input.note,
      resolutionPayload,
      updatedAt: now,
    })
    .where(eq(requests.id, params.requestId))
    .returning();

  await appendRequestEvent({
    requestId: params.requestId,
    type: "request.resolved",
    actorType: "user",
    actorId: params.resolvedBy,
    payload: resolutionPayload,
  });

  const result = mapRequest(updated!);

  if (row.resumeWebhookUrl) {
    await queueWebhookDelivery({
      requestId: params.requestId,
      agentId: row.agentId,
      url: row.resumeWebhookUrl,
      payload: {
        request_id: result.id,
        workspace_id: result.workspace_id,
        agent_id: result.agent_id,
        key: result.key,
        status: result.status,
        action: params.action,
        resolved_by: params.resolvedBy,
        resolved_at: result.resolved_at ?? now.toISOString(),
        note: params.input.note,
        metadata: result.metadata,
      },
    });
  }

  return result;
}

export async function cancelRequest(
  auth: ApiKeyAuth,
  requestId: string,
  reason?: string,
): Promise<RequestResponse> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.id, requestId),
        eq(requests.workspaceId, auth.workspaceId),
        eq(requests.agentId, auth.agentId),
      ),
    )
    .limit(1);

  if (!row) {
    throw notFound("Request", requestId);
  }

  if (row.status !== "pending" && row.status !== "changes_requested") {
    throw requestNotResolvable(requestId, row.status);
  }

  const now = new Date();
  const [updated] = await db
    .update(requests)
    .set({
      status: "cancelled",
      resolvedAt: now,
      resolutionAction: "cancel",
      resolutionNote: reason,
      resolutionPayload: { action: "cancel", reason },
      updatedAt: now,
    })
    .where(eq(requests.id, requestId))
    .returning();

  await appendRequestEvent({
    requestId,
    type: "request.cancelled",
    actorType: "agent",
    actorId: auth.agentId,
    payload: { reason },
  });

  return mapRequest(updated!);
}

export async function getRequestEvents(workspaceId: string, requestId: string) {
  await getRequest(workspaceId, requestId);
  const events = await listRequestEvents(requestId);
  return events.map((e) => ({
    id: e.id,
    request_id: e.requestId,
    type: e.type,
    actor_type: e.actorType,
    actor_id: e.actorId,
    payload: (e.payload as Record<string, unknown>) ?? {},
    created_at: e.createdAt.toISOString(),
  }));
}

export async function listRequestsForApiKey(auth: ApiKeyAuth, query: ListRequestsQuery) {
  return listRequests(auth.workspaceId, { ...query, agent_id: query.agent_id ?? auth.agentId });
}
