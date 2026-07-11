import { and, eq, inArray } from "drizzle-orm";
import {
  escalationPolicies,
  memberships,
  notificationChannels,
  requestAssignments,
  requests,
  users,
  type Database,
} from "@latticeag/vekinbox-db";
import type { QueueConnection } from "./connection.js";
import { enqueueNotification, scheduleEscalation, scheduleTimeout } from "./queues.js";

interface EscalationStep {
  delay_ms: number;
  notify?: {
    user_id?: string;
    channel_id?: string;
  };
  message?: string;
}

export async function scheduleRequestJobs(
  connection: QueueConnection,
  db: Database,
  requestId: string,
): Promise<void> {
  const [request] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!request) {
    return;
  }

  const channels = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.workspaceId, request.workspaceId),
        eq(notificationChannels.enabled, true),
      ),
    );

  for (const channel of channels) {
    if (channel.type === "email") {
      const assignees = await db
        .select({ userId: requestAssignments.userId })
        .from(requestAssignments)
        .where(eq(requestAssignments.requestId, requestId));

      const recipientIds =
        assignees.length > 0
          ? assignees.map((a: { userId: string }) => a.userId)
          : (
              await db
                .select({ userId: memberships.userId })
                .from(memberships)
                .where(
                  and(
                    eq(memberships.workspaceId, request.workspaceId),
                    inArray(memberships.role, ["owner", "admin", "reviewer"]),
                  ),
                )
            ).map((m: { userId: string }) => m.userId);

      for (const userId of recipientIds) {
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) {
          continue;
        }
        await enqueueNotification(connection, {
          requestId,
          channelId: channel.id,
          channelType: "email",
          userId,
        });
      }
    }

    if (channel.type === "slack") {
      await enqueueNotification(connection, {
        requestId,
        channelId: channel.id,
        channelType: "slack",
      });
    }
  }

  if (request.escalationPolicyId) {
    const [policy] = await db
      .select()
      .from(escalationPolicies)
      .where(eq(escalationPolicies.id, request.escalationPolicyId))
      .limit(1);

    const steps = (policy?.steps as EscalationStep[] | undefined) ?? [];
    if (steps.length > 0) {
      const firstStep = steps[0]!;
      await scheduleEscalation(
        connection,
        { requestId, stepIndex: 0 },
        { delay: firstStep.delay_ms },
      );
    }
  }

  if (request.timeoutAt) {
    const delay = Math.max(0, request.timeoutAt.getTime() - Date.now());
    await scheduleTimeout(connection, { requestId }, { delay });
  }
}
