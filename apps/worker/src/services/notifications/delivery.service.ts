import { redactedDeliveryLog } from "./redaction.js";
import type {
  DeliveryOutcome,
  NotificationProviderAdapter,
  NotificationProviderKey,
  ProviderDeliveryInput,
} from "./types.js";

export type NotificationProviderRegistry = Partial<
  Record<NotificationProviderKey, NotificationProviderAdapter>
>;

/**
 * Provider-neutral dispatch point for durable notification intents. The caller
 * persists the returned outcome; this service never converts delivery/view
 * state into an approval decision.
 */
export class MultiChannelNotificationDelivery {
  constructor(private readonly providers: NotificationProviderRegistry) {}

  async deliver(input: ProviderDeliveryInput): Promise<DeliveryOutcome> {
    const expiry = Date.parse(input.notification.expiresAt);
    if (Number.isNaN(expiry) || expiry <= Date.now()) {
      return {
        provider: input.endpoint.provider,
        deliveryId: input.notification.deliveryId,
        state: "suppressed",
        errorCode: Number.isNaN(expiry) ? "notification_expiry_invalid" : "notification_expired",
      };
    }
    const provider = this.providers[input.endpoint.provider];
    if (!provider) {
      return {
        provider: input.endpoint.provider,
        deliveryId: input.notification.deliveryId,
        state: "suppressed",
        errorCode: "provider_not_configured",
      };
    }
    return provider.deliver(input);
  }

  redactForLogs(input: ProviderDeliveryInput): Record<string, unknown> {
    const provider = this.providers[input.endpoint.provider];
    return provider
      ? provider.redactForLogs(input)
      : redactedDeliveryLog(input.endpoint.provider, input.notification, input.endpoint.destination);
  }
}
