import { and, eq, inArray, lte } from "drizzle-orm";
import { requests } from "@latticeag/vekinbox-db";
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

  // Silence is never approval. Legacy policies allowed arbitrary strings here,
  // and the old action mapper treated unknown actions as approved. Until a v3
  // policy engine supplies an explicit safe timeout outcome, workers always
  // decline an unanswered request.
  const defaultAction = "decline";

  const now = new Date();
  const newStatus = actionToStatus(defaultAction);
  if (!newStatus) {
    throw new Error("The built-in timeout action must map to a terminal status");
  }
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
    .where(
      and(
        eq(requests.id, requestId),
        inArray(requests.status, ["pending", "escalated"]),
        // A request may have been rescheduled after this worker read it. Keep
        // the timeout transition conditional on the deadline still being due
        // so an old delayed job cannot override the newer schedule.
        lte(requests.timeoutAt, now),
      ),
    )
    .returning();

  // A human decision or cancellation won the race after our read. Do not add
  // a contradictory timeout audit record or resume webhook.
  if (!updated) {
    return;
  }

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
