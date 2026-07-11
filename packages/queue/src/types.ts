import type { ResumeWebhookPayload } from "@latticeag/vekinbox-shared";

export const QUEUE_NAMES = {
  WEBHOOKS: "webhooks",
  NOTIFICATIONS: "notifications",
  ESCALATION: "escalation",
  TIMEOUT: "timeout",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const WEBHOOK_JOB = "deliver" as const;
export const NOTIFICATION_EMAIL_JOB = "email" as const;
export const NOTIFICATION_SLACK_JOB = "slack" as const;
export const ESCALATION_JOB = "escalate" as const;
export const TIMEOUT_JOB = "timeout" as const;

export interface WebhookDeliveryJobData {
  requestId: string;
  agentId: string;
  url: string;
  payload: ResumeWebhookPayload;
  deliveryId?: string;
}

export interface NotificationEmailJobData {
  requestId: string;
  channelId: string;
  channelType: "email";
  userId: string;
}

export interface NotificationSlackJobData {
  requestId: string;
  channelId: string;
  channelType: "slack";
}

export type NotificationJobData = NotificationEmailJobData | NotificationSlackJobData;

export interface EscalationJobData {
  requestId: string;
  stepIndex: number;
}

export interface TimeoutJobData {
  requestId: string;
}

export const WEBHOOK_RETRY_DELAYS_MS = [0, 60_000, 300_000, 900_000, 3_600_000, 21_600_000] as const;
