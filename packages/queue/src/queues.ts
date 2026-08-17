import { Queue, type Job, type JobsOptions } from "bullmq";
import type { QueueConnection } from "./connection.js";
import {
  ESCALATION_JOB,
  NOTIFICATION_EMAIL_JOB,
  NOTIFICATION_SLACK_JOB,
  NOTIFICATION_SMS_JOB,
  QUEUE_NAMES,
  TIMEOUT_JOB,
  WEBHOOK_JOB,
  WEBHOOK_RETRY_DELAYS_MS,
  type EscalationJobData,
  type NotificationJobData,
  type TimeoutJobData,
  type WebhookDeliveryJobData,
} from "./types.js";

const queueCache = new Map<string, Queue>();

function getQueue(connection: QueueConnection, name: string): Queue {
  const existing = queueCache.get(name);
  if (existing) {
    return existing;
  }

  const queue = new Queue(name, { connection: connection as never });
  queueCache.set(name, queue);
  return queue;
}

export function enqueueWebhookDelivery(
  connection: QueueConnection,
  data: WebhookDeliveryJobData,
): Promise<Job<WebhookDeliveryJobData>> {
  const queue = getQueue(connection, QUEUE_NAMES.WEBHOOKS);
  const jobId = data.deliveryId ? `webhook:${data.deliveryId}` : `webhook:${data.requestId}:${Date.now()}`;

  return queue.add(WEBHOOK_JOB, data, {
    jobId,
    attempts: WEBHOOK_RETRY_DELAYS_MS.length,
    backoff: {
      type: "custom",
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  } as JobsOptions) as Promise<Job<WebhookDeliveryJobData>>;
}

export function enqueueNotification(
  connection: QueueConnection,
  data: NotificationJobData,
): Promise<Job<NotificationJobData>> {
  const queue = getQueue(connection, QUEUE_NAMES.NOTIFICATIONS);

  if (data.channelType === "email") {
    return queue.add(NOTIFICATION_EMAIL_JOB, data, {
      jobId: `notify:email:${data.requestId}:${data.channelId}:${data.userId}`,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    } as JobsOptions) as Promise<Job<NotificationJobData>>;
  }

  if (data.channelType === "slack") {
    return queue.add(NOTIFICATION_SLACK_JOB, data, {
      jobId: `notify:slack:${data.requestId}:${data.channelId}`,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    } as JobsOptions) as Promise<Job<NotificationJobData>>;
  }

  return queue.add(NOTIFICATION_SMS_JOB, data, {
    jobId: `notify:sms:${data.requestId}:${data.channelId ?? data.userId ?? "recipient"}`,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  } as JobsOptions) as Promise<Job<NotificationJobData>>;
}

export function scheduleEscalation(
  connection: QueueConnection,
  data: EscalationJobData,
  options?: { delay?: number },
): Promise<Job<EscalationJobData>> {
  const queue = getQueue(connection, QUEUE_NAMES.ESCALATION);

  return queue.add(ESCALATION_JOB, data, {
    jobId: `escalation:${data.requestId}:${data.stepIndex}`,
    delay: options?.delay ?? 0,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  } as JobsOptions) as Promise<Job<EscalationJobData>>;
}

export function scheduleTimeout(
  connection: QueueConnection,
  data: TimeoutJobData,
  options?: { delay?: number },
): Promise<Job<TimeoutJobData>> {
  const queue = getQueue(connection, QUEUE_NAMES.TIMEOUT);

  return queue.add(TIMEOUT_JOB, data, {
    jobId: `timeout:${data.requestId}`,
    delay: options?.delay ?? 0,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  } as JobsOptions) as Promise<Job<TimeoutJobData>>;
}

export function webhookBackoffStrategy(attemptsMade: number): number {
  const index = Math.min(attemptsMade, WEBHOOK_RETRY_DELAYS_MS.length - 1);
  return WEBHOOK_RETRY_DELAYS_MS[index] ?? WEBHOOK_RETRY_DELAYS_MS[WEBHOOK_RETRY_DELAYS_MS.length - 1]!;
}
