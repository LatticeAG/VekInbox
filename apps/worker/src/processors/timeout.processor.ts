import { eq } from "drizzle-orm";
import { escalationPolicies, requests, workspaces } from "@latticeag/vekinbox-db";
import {
  createQueueConnection,
  enqueueWebhookDelivery,
  type TimeoutJobData,
} from "@latticeag/vekinbox-queue";
import { actionToStatus } from "@latticeag/vekinbox-shared";
import type { Job } from "bullmq";
import { getDb } from "../lib/db.js";
import { getRedisUrl } from "../connection.js";
import { appendRequestEvent } from "../services/audit.service.js";

export async function processTimeout(job: Job<TimeoutJobData>) {
  const db = getDb();
  const { requestId } = job.data;

  const [request] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!request) {
    return;
  }

  if (request.status !== "pending" && request.status !== "escalated") {
    return;
  }

  if (request.timeoutAt && request.timeoutAt.getTime() > Date.now()) {
    return;
  }

  let defaultAction = request.defaultAction ?? "decline";

  if (request.escalationPolicyId) {
    const [policy] = await db
      .select()
      .from(escalationPolicies)
      .where(eq(escalationPolicies.id, request.escalationPolicyId))
      .limit(1);
    if (policy?.defaultActionOnTimeout) {
      defaultAction = policy.defaultActionOnTimeout;
    }
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, request.workspaceId))
    .limit(1);

  const settings = (workspace?.settings as { allow_auto_approve_on_timeout?: boolean }) ?? {};
  if (!settings.allow_auto_approve_on_timeout && defaultAction === "approve") {
    defaultAction = "decline";
  }

  const now = new Date();
  const newStatus = actionToStatus(defaultAction) as typeof request.status;
  const resolutionPayload = {
    action: defaultAction,
    reason: "timeout",
  };

  const [updated] = await db
    .update(requests)
    .set({
      status: newStatus,
      resolvedBy: null,
      resolvedAt: now,
      resolutionAction: defaultAction,
      resolutionNote: "Automatically resolved due to timeout",
      resolutionPayload,
      updatedAt: now,
    })
    .where(eq(requests.id, requestId))
    .returning();

  await appendRequestEvent({
    requestId,
    type: "request.timed_out",
    actorType: "system",
    payload: {
      action: defaultAction,
      timeout_at: request.timeoutAt?.toISOString(),
    },
  });

  if (updated?.resumeWebhookUrl) {
    const connection = createQueueConnection(getRedisUrl());
    await enqueueWebhookDelivery(connection, {
      requestId,
      agentId: request.agentId,
      url: updated.resumeWebhookUrl,
      payload: {
        request_id: updated.id,
        workspace_id: updated.workspaceId,
        agent_id: updated.agentId,
        key: updated.key,
        status: updated.status,
        action: defaultAction,
        resolved_at: now.toISOString(),
        note: "Automatically resolved due to timeout",
        metadata: (updated.metadata as Record<string, unknown>) ?? {},
      },
    });
  }
}
