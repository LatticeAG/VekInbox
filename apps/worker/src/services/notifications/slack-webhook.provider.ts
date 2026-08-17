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

export interface SlackWebhookProviderConfig {
  webhookUrl: string;
  fetch?: FetchLike;
}

function assertSlackWebhookUrl(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const supportedHosts = new Set(["hooks.slack.com", "hooks.slack-gov.com"]);
  if (url.protocol !== "https:" || url.username || url.password || !supportedHosts.has(hostname)) {
    throw new Error("Slack webhook URL must be an HTTPS hooks.slack.com URL");
  }
  return url.toString();
}

function retryAfterMs(value: string | null): number | undefined {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

/** Incoming-webhook adapter. It only opens the web inbox; it cannot approve. */
export class SlackWebhookProviderAdapter implements NotificationProviderAdapter {
  readonly providerKey = "slack" as const;
  readonly configured = true;
  readonly capabilities = {
    endpointKinds: ["provider_user", "governed_team_channel"],
    supportsDeliveryReceipts: false,
    supportsReadReceipts: false,
    supportsInboundActions: false,
    supportsThreadUpdates: false,
    maxPayloadBytes: 30_000,
    allowedRiskForInlineAction: [] as const,
  };

  private readonly webhookUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(config: SlackWebhookProviderConfig) {
    this.webhookUrl = assertSlackWebhookUrl(config.webhookUrl);
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  static fromEnvironment(
    env: Record<string, string | undefined> = process.env,
    fetchFn?: FetchLike,
  ): SlackWebhookProviderAdapter | undefined {
    const webhookUrl = env["SLACK_WEBHOOK_URL"];
    return webhookUrl ? new SlackWebhookProviderAdapter({ webhookUrl, fetch: fetchFn }) : undefined;
  }

  redactForLogs(input: ProviderDeliveryInput): Record<string, unknown> {
    return redactedDeliveryLog(this.providerKey, input.notification, input.endpoint.destination);
  }

  async deliver(input: ProviderDeliveryInput): Promise<DeliveryOutcome> {
    if (input.endpoint.provider !== "slack") {
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

    const message = renderNotification("slack", input.notification);
    try {
      const response = await this.fetchFn(this.webhookUrl, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "X-VekInbox-Delivery-Id": input.notification.deliveryId,
        },
        body: JSON.stringify({
          text: message.text,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: message.text },
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Open in VekInbox" },
                  url: message.deepLink,
                  action_id: "open_vekinbox",
                },
              ],
            },
          ],
        }),
      });

      if (response.ok) {
        return {
          provider: this.providerKey,
          deliveryId: input.notification.deliveryId,
          state: "accepted",
          acceptedAt: new Date().toISOString(),
          providerMetadata: { http_status: response.status },
        };
      }
      return {
        provider: this.providerKey,
        deliveryId: input.notification.deliveryId,
        state: response.status === 429 || response.status >= 500 ? "failed_retryable" : "failed_terminal",
        errorCode: `http_${response.status}`,
        retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
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
