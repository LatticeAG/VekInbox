import {
  actionToStatus,
  generateId,
  invalidAction,
  normalizeActions,
  notFound,
  requestAlreadyResolved,
  requestNotResolvable,
  validationError,
  type CreateRequestApiInput,
  type ListRequestsQuery,
  type RequestResponse,
  type ResolveRequestApiInput,
} from "@latticeag/vekinbox-shared";
import { createQueueConnection, scheduleRequestJobs } from "@latticeag/vekinbox-queue";
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  escalationPolicies,
  memberships,
  requestAssignments,
  requests,
  workspaces,
} from "@latticeag/vekinbox-db";
import { getDb } from "../lib/db.js";
import { shouldRecordView } from "../lib/viewed-debounce.js";
import { appendRequestEvent, listRequestEvents } from "./audit.service.js";
import { queueWebhookDelivery } from "./webhook.service.js";
import type { ApiKeyAuth } from "../middleware/auth.js";

function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

async function loadAssigneesForRequests(
  requestIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (requestIds.length === 0) {
    return map;
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(requestAssignments)
    .where(inArray(requestAssignments.requestId, requestIds));

  for (const row of rows) {
    const existing = map.get(row.requestId) ?? [];
    existing.push(row.userId);
    map.set(row.requestId, existing);
  }

  return map;
}

function mapRequest(
  row: typeof requests.$inferSelect,
  assignees: string[] = [],
): RequestResponse {
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
    assignees,
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
      return mapRequest(existing, (await loadAssigneesForRequests([existing.id])).get(existing.id) ?? []);
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
  if (input.escalation_policy_id) {
    const [policy] = await db
      .select({ id: escalationPolicies.id })
      .from(escalationPolicies)
      .where(
        and(
          eq(escalationPolicies.id, input.escalation_policy_id),
          eq(escalationPolicies.workspaceId, input.workspace_id),
        ),
      )
      .limit(1);
    if (!policy) {
      throw validationError("escalation_policy_id must belong to the request workspace");
    }
  }

  const assignees = [...new Set(input.assignees ?? [])];
  if (assignees.length !== (input.assignees?.length ?? 0)) {
    throw validationError("assignees cannot contain duplicates");
  }
  if (assignees.length > 0) {
    const assigneeMemberships = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, input.workspace_id),
          inArray(memberships.userId, assignees),
        ),
      );
    if (assigneeMemberships.length !== assignees.length) {
      throw validationError("every assignee must be a member of the request workspace");
    }
  }
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

  if (assignees.length) {
    await db.insert(requestAssignments).values(
      assignees.map((userId) => ({
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

  const redisUrl = process.env["REDIS_URL"];
  if (redisUrl) {
    const connection = createQueueConnection(redisUrl);
    await scheduleRequestJobs(connection, getDb(), id);
  }

  return mapRequest(created!, assignees);
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
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const assigneeMap = await loadAssigneesForRequests(page.map((r) => r.id));
  const data = page.map((row) => mapRequest(row, assigneeMap.get(row.id) ?? []));
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

  const assigneeMap = await loadAssigneesForRequests([requestId]);
  return mapRequest(row, assigneeMap.get(requestId) ?? []);
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

  if (
    row.status !== "pending" &&
    row.status !== "changes_requested" &&
    row.status !== "escalated"
  ) {
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

  const newStatus = actionToStatus(params.action);
  if (!newStatus) {
    // A legacy custom action has no policy-authored outcome mapping. Reject it
    // rather than defaulting to approval.
    throw invalidAction(params.requestId, params.action);
  }
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
    .where(
      and(
        eq(requests.id, params.requestId),
        eq(requests.workspaceId, params.workspaceId),
        eq(requests.status, row.status),
      ),
    )
    .returning();

  if (!updated) {
    throw requestNotResolvable(params.requestId, "state_changed");
  }

  await appendRequestEvent({
    requestId: params.requestId,
    type: "request.resolved",
    actorType: "user",
    actorId: params.resolvedBy,
    payload: resolutionPayload,
  });

  const assigneeMap = await loadAssigneesForRequests([params.requestId]);
  const result = mapRequest(updated!, assigneeMap.get(params.requestId) ?? []);

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
    .where(
      and(
        eq(requests.id, requestId),
        eq(requests.workspaceId, auth.workspaceId),
        eq(requests.agentId, auth.agentId),
        eq(requests.status, row.status),
      ),
    )
    .returning();

  if (!updated) {
    throw requestNotResolvable(requestId, "state_changed");
  }

  await appendRequestEvent({
    requestId,
    type: "request.cancelled",
    actorType: "agent",
    actorId: auth.agentId,
    payload: { reason },
  });

  const assigneeMap = await loadAssigneesForRequests([requestId]);
  return mapRequest(updated!, assigneeMap.get(requestId) ?? []);
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

export async function recordRequestViewed(
  workspaceId: string,
  requestId: string,
  userId: string,
): Promise<void> {
  await getRequest(workspaceId, requestId);

  const shouldRecord = await shouldRecordView(userId, requestId);
  if (!shouldRecord) {
    return;
  }

  await appendRequestEvent({
    requestId,
    type: "request.viewed",
    actorType: "user",
    actorId: userId,
    payload: {},
  });
}

export async function listRequestsForApiKey(auth: ApiKeyAuth, query: ListRequestsQuery) {
  return listRequests(auth.workspaceId, { ...query, agent_id: query.agent_id ?? auth.agentId });
}

/**
 * Marks pending requests past their timeout as timed_out.
 * Intended for the background worker; exposed for integration tests.
 */
export async function processExpiredRequests(): Promise<number> {
  const db = getDb();
  const now = new Date();

  const expired = await db
    .select()
    .from(requests)
    .where(
      and(
        inArray(requests.status, ["pending", "escalated"]),
        isNotNull(requests.timeoutAt),
        lt(requests.timeoutAt, now),
      ),
    );

  let processed = 0;
  for (const row of expired) {
    const [updated] = await db
      .update(requests)
      .set({
        status: "timed_out",
        resolvedAt: now,
        resolutionAction: "timeout",
        resolutionNote: "Request timed out",
        resolutionPayload: { action: "timeout" },
        updatedAt: now,
      })
      .where(
        and(
          eq(requests.id, row.id),
          inArray(requests.status, ["pending", "escalated"]),
          lt(requests.timeoutAt, now),
        ),
      )
      .returning();

    if (!updated) {
      continue;
    }
    processed += 1;

    await appendRequestEvent({
      requestId: row.id,
      type: "request.timed_out",
      actorType: "system",
      actorId: null,
      payload: { timeout_at: row.timeoutAt?.toISOString() },
    });

    if (row.resumeWebhookUrl) {
      const result = mapRequest(updated);
      await queueWebhookDelivery({
        requestId: row.id,
        agentId: row.agentId,
        url: row.resumeWebhookUrl,
        payload: {
          request_id: result.id,
          workspace_id: result.workspace_id,
          agent_id: result.agent_id,
          key: result.key,
          status: result.status,
          action: "timeout",
          resolved_at: result.resolved_at ?? now.toISOString(),
          metadata: result.metadata,
        },
      });
    }
  }

  return processed;
}
