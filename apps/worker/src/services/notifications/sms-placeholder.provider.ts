import {
  redactedDeliveryLog,
  renderNeutralSms,
} from "./redaction.js";
import type {
  DeliveryOutcome,
  NotificationProviderAdapter,
  ProviderDeliveryInput,
} from "./types.js";

/**
 * Explicitly non-delivering placeholder until an SMS provider, consent store,
 * and callback/identity binding flow are installed. Keeping it in the registry
 * makes an attempted SMS route auditable without pretending that it sent.
 */
export class SmsPlaceholderProviderAdapter implements NotificationProviderAdapter {
  readonly providerKey = "sms" as const;
  readonly configured = false;
  readonly capabilities = {
    endpointKinds: ["phone_number"],
    supportsDeliveryReceipts: false,
    supportsReadReceipts: false,
    supportsInboundActions: false,
    supportsThreadUpdates: false,
    maxPayloadBytes: 480,
    allowedRiskForInlineAction: [] as const,
  };

  redactForLogs(input: ProviderDeliveryInput): Record<string, unknown> {
    return redactedDeliveryLog(this.providerKey, input.notification, input.endpoint.destination);
  }

  async deliver(input: ProviderDeliveryInput): Promise<DeliveryOutcome> {
    // Render it here to guarantee the eventual real provider starts from the
    // neutral SMS contract rather than from a general email/chat payload.
    renderNeutralSms(input.notification);
    return {
      provider: this.providerKey,
      deliveryId: input.notification.deliveryId,
      state: "suppressed",
      errorCode: "sms_provider_not_configured",
    };
  }
}
