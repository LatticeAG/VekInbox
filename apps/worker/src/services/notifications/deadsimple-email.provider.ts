import {
  redactedDeliveryLog,
  renderNotification,
} from "./redaction.js";
import type {
  DeliveryOutcome,
  FetchLike,
  NotificationProviderAdapter,
  ProviderDeliveryInput,
} from "./types.js";

export const DEAD_SIMPLE_EMAIL_API_BASE_URL = "https://api.deadsimple.email/v1";

export interface DeadSimpleEmailProviderConfig {
  apiKey: string;
  inboxId: string;
  /** Defaults to Dead Simple Email's v1 API, but supports a compatible gateway. */
  apiBaseUrl?: string;
  fetch?: FetchLike;
}

interface DeadSimpleMessageResponse {
  id?: unknown;
  status?: unknown;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const at = Date.parse(value);
  if (!Number.isNaN(at)) {
    return Math.max(0, at - Date.now());
  }
  return undefined;
}

async function responseJson(response: Response): Promise<DeadSimpleMessageResponse> {
  try {
    return (await response.json()) as DeadSimpleMessageResponse;
  } catch {
    return {};
  }
}

function normaliseBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Dead Simple Email API URL must use HTTPS");
  }
  return url.toString().replace(/\/$/, "");
}

/**
 * Dead Simple Email's current documented REST endpoint is
 * POST /v1/inboxes/{inboxId}/send with {to, subject, body}. This adapter
 * uses only a configured API key/inbox and sends a provider idempotency hint.
 */
export class DeadSimpleEmailProviderAdapter implements NotificationProviderAdapter {
  readonly providerKey = "email" as const;
  readonly configured = true;
  readonly capabilities = {
    endpointKinds: ["email_address"],
    supportsDeliveryReceipts: true,
    supportsReadReceipts: false,
    supportsInboundActions: false,
    supportsThreadUpdates: false,
    maxPayloadBytes: 256_000,
    allowedRiskForInlineAction: [] as const,
  };

  private readonly apiBaseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(private readonly config: DeadSimpleEmailProviderConfig) {
    if (!config.apiKey.trim() || !config.inboxId.trim()) {
      throw new Error("Dead Simple Email requires both apiKey and inboxId");
    }
    this.apiBaseUrl = normaliseBaseUrl(config.apiBaseUrl ?? DEAD_SIMPLE_EMAIL_API_BASE_URL);
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  static fromEnvironment(
    env: Record<string, string | undefined> = process.env,
    fetchFn?: FetchLike,
  ): DeadSimpleEmailProviderAdapter | undefined {
    const apiKey = env["DEADSIMPLE_API_KEY"];
    const inboxId = env["DEADSIMPLE_INBOX_ID"];
    if (!apiKey || !inboxId) {
      return undefined;
    }
    return new DeadSimpleEmailProviderAdapter({
      apiKey,
      inboxId,
      apiBaseUrl: env["DEADSIMPLE_API_BASE_URL"],
      fetch: fetchFn,
    });
  }

  redactForLogs(input: ProviderDeliveryInput): Record<string, unknown> {
    return redactedDeliveryLog(this.providerKey, input.notification, input.endpoint.destination);
  }

  async deliver(input: ProviderDeliveryInput): Promise<DeliveryOutcome> {
    if (input.endpoint.provider !== "email") {
      return {
        provider: this.providerKey,
        deliveryId: input.notification.deliveryId,
        state: "failed_terminal",
        errorCode: "endpoint_provider_mismatch",
      };
    }
    if (!input.endpoint.verified || !input.endpoint.consented) {
      return {
        provider: this.providerKey,
        deliveryId: input.notification.deliveryId,
        state: "suppressed",
        errorCode: "endpoint_not_verified_or_consented",
      };
    }

    const message = renderNotification("email", input.notification);
    const url = `${this.apiBaseUrl}/inboxes/${encodeURIComponent(this.config.inboxId)}/send`;

    try {
      const response = await this.fetchFn(url, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.notification.deliveryId,
          "X-VekInbox-Delivery-Id": input.notification.deliveryId,
        },
        body: JSON.stringify({
          to: input.endpoint.destination,
          subject: message.subject,
          body: message.text,
        }),
      });

      const payload = await responseJson(response);
      if (response.ok) {
        const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "accepted";
        return {
          provider: this.providerKey,
          deliveryId: input.notification.deliveryId,
          state: status === "delivered" ? "delivered" : "accepted",
          acceptedAt: new Date().toISOString(),
          providerMessageId: typeof payload.id === "string" ? payload.id : undefined,
          providerMetadata: { http_status: response.status },
        };
      }

      return {
        provider: this.providerKey,
        deliveryId: input.notification.deliveryId,
        state: response.status === 429 || response.status >= 500 ? "failed_retryable" : "failed_terminal",
        errorCode: `http_${response.status}`,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
        providerMetadata: { http_status: response.status },
      };
    } catch {
      return {
        provider: this.providerKey,
        deliveryId: input.notification.deliveryId,
        state: "failed_retryable",
        errorCode: "network_error",
      };
    }
  }
}
