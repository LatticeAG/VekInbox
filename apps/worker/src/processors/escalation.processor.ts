import { and, eq } from "drizzle-orm";
import {
  escalationPolicies,
  notificationChannels,
  requests,
  users,
} from "@latticeag/vekinbox-db";
import {
  createQueueConnection,
  enqueueNotification,
  scheduleEscalation,
  type EscalationJobData,
} from "@latticeag/vekinbox-queue";
import type { Job } from "bullmq";
import { getDb } from "../lib/db.js";
import { getRedisUrl } from "../connection.js";
import { appendRequestEvent } from "../services/audit.service.js";

interface EscalationStep {
  delay_ms: number;
  notify?: {
    user_id?: string;
    channel_id?: string;
  };
  message?: string;
}

export async function processEscalation(job: Job<EscalationJobData>) {
  const db = getDb();
  const { requestId, stepIndex } = job.data;

  const [request] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!request) {
    return;
  }

  if (request.status !== "pending" && request.status !== "escalated") {
    return;
  }

  if (!request.escalationPolicyId) {
    return;
  }

  const [policy] = await db
    .select()
    .from(escalationPolicies)
    .where(eq(escalationPolicies.id, request.escalationPolicyId))
    .limit(1);

  if (!policy) {
    return;
  }

  const steps = (policy.steps as EscalationStep[]) ?? [];
  const step = steps[stepIndex];
  if (!step) {
    return;
  }

  if (request.status === "pending") {
    await db
      .update(requests)
      .set({ status: "escalated", updatedAt: new Date() })
      .where(eq(requests.id, requestId));
  }

  const connection = createQueueConnection(getRedisUrl());

  if (step.notify?.user_id) {
    const [user] = await db.select().from(users).where(eq(users.id, step.notify.user_id)).limit(1);
    if (user) {
      const emailChannels = await db
        .select()
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.workspaceId, request.workspaceId),
            eq(notificationChannels.type, "email"),
            eq(notificationChannels.enabled, true),
          ),
        );

      for (const channel of emailChannels) {
        await enqueueNotification(connection, {
          requestId,
          channelId: channel.id,
          channelType: "email",
          userId: user.id,
        });
      }
    }
  }

  if (step.notify?.channel_id) {
    const [channel] = await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, step.notify.channel_id))
      .limit(1);

    if (channel?.enabled) {
      if (channel.type === "email" && step.notify.user_id) {
        await enqueueNotification(connection, {
          requestId,
          channelId: channel.id,
          channelType: "email",
          userId: step.notify.user_id,
        });
      } else if (channel.type === "slack") {
        await enqueueNotification(connection, {
          requestId,
          channelId: channel.id,
          channelType: "slack",
        });
      }
    }
  }

  await appendRequestEvent({
    requestId,
    type: "request.escalated",
    actorType: "system",
    payload: {
      step_index: stepIndex,
      message: step.message,
      notify: step.notify,
    },
  });

  const nextStep = steps[stepIndex + 1];
  if (nextStep) {
    await scheduleEscalation(
      connection,
      { requestId, stepIndex: stepIndex + 1 },
      { delay: nextStep.delay_ms },
    );
  }
}
