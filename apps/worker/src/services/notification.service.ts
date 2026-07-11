import { and, eq } from "drizzle-orm";
import {
  agents,
  notificationChannels,
  requestNotifications,
  requests,
  users,
} from "@latticeag/vekinbox-db";
import { generateId } from "@latticeag/vekinbox-shared";
import { getDb } from "../lib/db.js";
import { sendRequestNotificationEmail } from "./email.service.js";
import { sendRequestSlackNotification } from "./slack.service.js";

export async function processEmailNotification(params: {
  requestId: string;
  channelId: string;
  userId: string;
}) {
  const db = getDb();
  const [request] = await db.select().from(requests).where(eq(requests.id, params.requestId)).limit(1);
  if (!request) {
    throw new Error(`Request not found: ${params.requestId}`);
  }

  const [user] = await db.select().from(users).where(eq(users.id, params.userId)).limit(1);
  if (!user) {
    throw new Error(`User not found: ${params.userId}`);
  }

  const [channel] = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.id, params.channelId),
        eq(notificationChannels.enabled, true),
      ),
    )
    .limit(1);

  if (!channel || channel.type !== "email") {
    throw new Error(`Email channel not found: ${params.channelId}`);
  }

  const [agent] = await db.select().from(agents).where(eq(agents.id, request.agentId)).limit(1);
  const notificationId = generateId("ntf");

  await db.insert(requestNotifications).values({
    id: notificationId,
    requestId: params.requestId,
    channelId: params.channelId,
    channelType: "email",
    status: "pending",
  });

  try {
    await sendRequestNotificationEmail({
      to: user.email,
      userId: user.id,
      requestId: request.id,
      title: request.title,
      description: request.description,
      priority: request.priority,
      agentName: agent?.name ?? request.agentId,
      actions: (request.actions as { name: string; label?: string }[]) ?? [],
      metadata: (request.metadata as Record<string, unknown>) ?? {},
      timeoutAt: request.timeoutAt?.toISOString() ?? null,
    });

    await db
      .update(requestNotifications)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(requestNotifications.id, notificationId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db
      .update(requestNotifications)
      .set({ status: "failed", error: message })
      .where(eq(requestNotifications.id, notificationId));
    throw err;
  }
}

export async function processSlackNotification(params: {
  requestId: string;
  channelId: string;
}) {
  const db = getDb();
  const [request] = await db.select().from(requests).where(eq(requests.id, params.requestId)).limit(1);
  if (!request) {
    throw new Error(`Request not found: ${params.requestId}`);
  }

  const [channel] = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.id, params.channelId),
        eq(notificationChannels.enabled, true),
      ),
    )
    .limit(1);

  if (!channel || channel.type !== "slack") {
    throw new Error(`Slack channel not found: ${params.channelId}`);
  }

  const config = channel.config as { channel_id?: string; bot_token?: string };
  if (!config.channel_id) {
    throw new Error("Slack channel missing channel_id in config");
  }

  const [agent] = await db.select().from(agents).where(eq(agents.id, request.agentId)).limit(1);
  const notificationId = generateId("ntf");

  await db.insert(requestNotifications).values({
    id: notificationId,
    requestId: params.requestId,
    channelId: params.channelId,
    channelType: "slack",
    status: "pending",
  });

  try {
    await sendRequestSlackNotification({
      requestId: request.id,
      title: request.title,
      description: request.description,
      priority: request.priority,
      agentName: agent?.name ?? request.agentId,
      actions: (request.actions as { name: string; label?: string }[]) ?? [],
      metadata: (request.metadata as Record<string, unknown>) ?? {},
      timeoutAt: request.timeoutAt?.toISOString() ?? null,
      channelConfig: {
        channel_id: config.channel_id,
        bot_token: config.bot_token,
      },
    });

    await db
      .update(requestNotifications)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(requestNotifications.id, notificationId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db
      .update(requestNotifications)
      .set({ status: "failed", error: message })
      .where(eq(requestNotifications.id, notificationId));
    throw err;
  }
}
