import { and, eq } from "drizzle-orm";
import {
  notificationChannels,
  requestNotifications,
  requests,
  users,
} from "@latticeag/vekinbox-db";
import { generateId } from "@latticeag/vekinbox-shared";
import { getDb } from "../lib/db.js";
import {
  createConfiguredNotificationProviders,
  type DeliveryOutcome,
  MultiChannelNotificationDelivery,
  type NotificationEndpointSnapshot,
  type NotificationProviderKey,
} from "./notifications/index.js";
import { buildLegacyApprovalNotification } from "./notifications/legacy-request-notification.js";

function getNotificationDelivery(slackWebhookUrl?: string): MultiChannelNotificationDelivery {
  return new MultiChannelNotificationDelivery(
    createConfiguredNotificationProviders(process.env, undefined, { slackWebhookUrl }),
  );
}

async function dispatchLegacyProviderNotification(params: {
  request: typeof requests.$inferSelect;
  requestId: string;
  channelId: string | null;
  provider: NotificationProviderKey;
  endpoint: NotificationEndpointSnapshot;
  slackWebhookUrl?: string;
}): Promise<void> {
  const db = getDb();
  const notificationId = generateId("ntf");

  await db.insert(requestNotifications).values({
    id: notificationId,
    requestId: params.requestId,
    channelId: params.channelId,
    channelType: params.provider,
    status: "pending",
  });

  let outcome: DeliveryOutcome;
  try {
    outcome = await getNotificationDelivery(params.slackWebhookUrl).deliver({
      endpoint: params.endpoint,
      notification: buildLegacyApprovalNotification(params.request, notificationId),
    });
  } catch (error) {
    await db
      .update(requestNotifications)
      .set({ status: "failed", error: "provider_dispatch_error" })
      .where(eq(requestNotifications.id, notificationId));
    throw error;
  }

  const sent = outcome.state === "accepted" || outcome.state === "delivered";
  await db
    .update(requestNotifications)
    .set({
      status: sent ? "sent" : "failed",
      sentAt: sent ? new Date() : null,
      error: sent ? null : outcome.errorCode ?? outcome.state,
    })
    .where(eq(requestNotifications.id, notificationId));

  if (outcome.state === "failed_retryable") {
    throw new Error(`Notification delivery is retryable: ${outcome.errorCode ?? "unknown_error"}`);
  }
}

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

  await dispatchLegacyProviderNotification({
    request,
    requestId: params.requestId,
    channelId: params.channelId,
    provider: "email",
    endpoint: {
      id: `legacy-email:${params.channelId}:${user.id}`,
      version: 1,
      provider: "email",
      destination: user.email,
      // Existing user/email and administrator-configured channel records are
      // a compatibility source only; v3 endpoint verification is introduced
      // separately with its own persisted model.
      verified: true,
      consented: true,
    },
  });
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

  const config = (channel.config as { channel_id?: string; webhook_url?: string }) ?? {};
  await dispatchLegacyProviderNotification({
    request,
    requestId: params.requestId,
    channelId: params.channelId,
    provider: "slack",
    endpoint: {
      id: `legacy-slack:${params.channelId}`,
      version: 1,
      provider: "slack",
      // Incoming webhooks target the configured governed channel. The value is
      // retained only as a redacted endpoint hint and is never sent as an
      // action identity.
      destination: config.channel_id ?? params.channelId,
      verified: true,
      consented: true,
    },
    // A channel-owned webhook is preferred over a process-wide fallback. The
    // adapter validates its HTTPS Slack host before any network request.
    slackWebhookUrl: config.webhook_url,
  });
}

/**
 * SMS has no legacy channel schema yet. This processor makes the placeholder
 * reachable through the same queue/registry boundary so a future endpoint
 * implementation is auditable and cannot grow a direct-approval bypass.
 */
export async function processSmsNotification(params: {
  requestId: string;
  userId?: string;
  phoneNumber: string;
  channelId?: string;
}) {
  const db = getDb();
  const [request] = await db.select().from(requests).where(eq(requests.id, params.requestId)).limit(1);
  if (!request) {
    throw new Error(`Request not found: ${params.requestId}`);
  }

  await dispatchLegacyProviderNotification({
    request,
    requestId: params.requestId,
    channelId: params.channelId ?? null,
    provider: "sms",
    endpoint: {
      id: params.channelId ?? `legacy-sms:${params.userId ?? "recipient"}`,
      version: 1,
      provider: "sms",
      destination: params.phoneNumber,
      verified: true,
      consented: true,
    },
  });
}
