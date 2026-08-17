export {
  DEAD_SIMPLE_EMAIL_API_BASE_URL,
  DeadSimpleEmailProviderAdapter,
  type DeadSimpleEmailProviderConfig,
} from "./deadsimple-email.provider.js";
export {
  redactText,
  renderNeutralSms,
  renderNotification,
  type RenderedNotification,
} from "./redaction.js";
export {
  MultiChannelNotificationDelivery,
  type NotificationProviderRegistry,
} from "./delivery.service.js";
export { SlackWebhookProviderAdapter, type SlackWebhookProviderConfig } from "./slack-webhook.provider.js";
export { SmsPlaceholderProviderAdapter } from "./sms-placeholder.provider.js";
export type {
  ApprovalNotification,
  ApprovalRiskClass,
  ContentClassification,
  DeliveryOutcome,
  DeliveryState,
  FetchLike,
  NotificationEndpointSnapshot,
  NotificationProviderAdapter,
  NotificationProviderKey,
  NotificationUrgency,
  OpaqueProviderActionIntent,
  ProviderCapabilities,
  ProviderDeliveryInput,
} from "./types.js";

import { DeadSimpleEmailProviderAdapter } from "./deadsimple-email.provider.js";
import { SlackWebhookProviderAdapter } from "./slack-webhook.provider.js";
import { SmsPlaceholderProviderAdapter } from "./sms-placeholder.provider.js";
import type { FetchLike } from "./types.js";

export interface ConfiguredNotificationProviders {
  email?: DeadSimpleEmailProviderAdapter;
  slack?: SlackWebhookProviderAdapter;
  /** Present even when unconfigured so SMS routing failures are explicit. */
  sms: SmsPlaceholderProviderAdapter;
}

export interface NotificationProviderOverrides {
  /** A project/channel Slack connection takes precedence over a process-wide default. */
  slackWebhookUrl?: string;
}

/** Optional providers are absent until their credentials/configuration exist. */
export function createConfiguredNotificationProviders(
  env: Record<string, string | undefined> = process.env,
  fetchFn?: FetchLike,
  overrides: NotificationProviderOverrides = {},
): ConfiguredNotificationProviders {
  return {
    email: DeadSimpleEmailProviderAdapter.fromEnvironment(env, fetchFn),
    slack: overrides.slackWebhookUrl
      ? new SlackWebhookProviderAdapter({ webhookUrl: overrides.slackWebhookUrl, fetch: fetchFn })
      : SlackWebhookProviderAdapter.fromEnvironment(env, fetchFn),
    sms: new SmsPlaceholderProviderAdapter(),
  };
}
