import { describe, expect, it } from "vitest";
import {
  DeadSimpleEmailProviderAdapter,
  MultiChannelNotificationDelivery,
  SlackWebhookProviderAdapter,
  SmsPlaceholderProviderAdapter,
  createConfiguredNotificationProviders,
  renderNeutralSms,
  renderNotification,
  type ApprovalNotification,
  type FetchLike,
  type ProviderDeliveryInput,
} from "./index.js";
import { buildLegacyApprovalNotification } from "./legacy-request-notification.js";

const notification: ApprovalNotification = {
  deliveryId: "dly_01",
  intentId: "ntf_01",
  caseId: "case_01",
  stageId: "engineering",
  riskClass: "R3",
  classification: "public",
  urgency: "high",
  expiresAt: "2030-01-01T00:00:00.000Z",
  title: "Deploy production service",
  summary: "Artifact sha256:abc API_KEY=top-secret",
  contextExcerpt: "Rollback ticket https://tickets.example/123?token=private-token",
  deepLink: "https://app.vekinbox.example/decision/opaque-intent",
  actionIntent: { nonce: "opaque-intent", expiresAt: "2030-01-01T00:00:00.000Z" },
};

function input(provider: ProviderDeliveryInput["endpoint"]["provider"]): ProviderDeliveryInput {
  return {
    endpoint: {
      id: `ep_${provider}`,
      version: 1,
      provider,
      destination: provider === "email" ? "reviewer@example.com" : provider === "slack" ? "C123456" : "+447700900001",
      verified: true,
      consented: true,
    },
    notification,
  };
}

describe("v3 notification rendering", () => {
  it("uses the authenticated inbox route for legacy compatibility deep links", () => {
    const previousWebUrl = process.env["WEB_URL"];
    process.env["WEB_URL"] = "https://app.vekinbox.example/";

    try {
      expect(
        buildLegacyApprovalNotification(
          {
            id: "req_01",
            title: "Review deployment",
            description: "",
            priority: "normal",
            timeoutAt: null,
          },
          "dly_legacy_01",
        ).deepLink,
      ).toBe("https://app.vekinbox.example/inbox/req_01");
    } finally {
      if (previousWebUrl === undefined) {
        delete process.env["WEB_URL"];
      } else {
        process.env["WEB_URL"] = previousWebUrl;
      }
    }
  });

  it("redacts credential-shaped content before rendering public email/chat summaries", () => {
    const rendered = renderNotification("email", notification);

    expect(rendered.text).toContain("[REDACTED]");
    expect(rendered.text).not.toContain("top-secret");
    expect(rendered.text).not.toContain("private-token");
    expect(rendered.action).toBe("open_securely");
  });

  it("never sends confidential or restricted context outside the web inbox", () => {
    const restricted = renderNotification("slack", {
      ...notification,
      classification: "restricted",
      title: "Payroll export for Alice",
      summary: "Account: 123-456-789",
      contextExcerpt: "very sensitive log body",
    });

    expect(restricted.text).toContain("Approval requires your attention");
    expect(restricted.text).not.toContain("Payroll export");
    expect(restricted.text).not.toContain("123-456-789");
    expect(restricted.text).not.toContain("very sensitive");
  });

  it("makes every SMS message neutral and open-only", () => {
    const rendered = renderNeutralSms({
      ...notification,
      classification: "restricted",
      title: "Delete regulated records",
      summary: "customer PII",
      contextExcerpt: "secret content",
    });

    expect(rendered.text).toContain("VekInbox approval requires your attention");
    expect(rendered.text).toContain(notification.deepLink);
    expect(rendered.text).not.toContain("Delete regulated records");
    expect(rendered.text).not.toContain("PII");
    expect(rendered.action).toBe("open_securely");
  });
});

describe("Dead Simple Email provider", () => {
  it("uses Dead Simple's configured inbox send endpoint and a redacted payload", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "msg_01", status: "delivered" }), { status: 201 });
    };
    const provider = new DeadSimpleEmailProviderAdapter({
      apiKey: "dse_not-for-logs",
      inboxId: "inb_01",
      apiBaseUrl: "https://api.deadsimple.email/v1",
      fetch: fetchFn,
    });

    const outcome = await provider.deliver(input("email"));
    const call = calls[0];
    const body = JSON.parse(String(call?.init?.body)) as { to: string; subject: string; body: string };

    expect(outcome).toMatchObject({ state: "delivered", providerMessageId: "msg_01" });
    expect(call?.url).toBe("https://api.deadsimple.email/v1/inboxes/inb_01/send");
    expect(call?.init?.headers).toMatchObject({
      Authorization: "Bearer dse_not-for-logs",
      "Idempotency-Key": "dly_01",
    });
    expect(body.to).toBe("reviewer@example.com");
    expect(body.body).not.toContain("top-secret");
    expect(body.body).not.toContain("private-token");
    expect(provider.redactForLogs(input("email"))).not.toMatchObject({ api_key: "dse_not-for-logs" });
    expect(JSON.stringify(provider.redactForLogs(input("email")))).not.toContain("reviewer@example.com");
  });

  it("classifies provider rate limits as retryable without exposing a raw response", async () => {
    const provider = new DeadSimpleEmailProviderAdapter({
      apiKey: "dse_key",
      inboxId: "inb_01",
      fetch: async () => new Response("provider body with secret", { status: 429, headers: { "retry-after": "3" } }),
    });

    await expect(provider.deliver(input("email"))).resolves.toMatchObject({
      state: "failed_retryable",
      errorCode: "http_429",
      retryAfterMs: 3_000,
    });
  });

  it("is optional until both Dead Simple credentials are configured", () => {
    expect(DeadSimpleEmailProviderAdapter.fromEnvironment({ DEADSIMPLE_API_KEY: "dse_only" })).toBeUndefined();
    expect(DeadSimpleEmailProviderAdapter.fromEnvironment({ DEADSIMPLE_INBOX_ID: "inb_only" })).toBeUndefined();
  });
});

describe("Slack webhook provider", () => {
  it("posts a redacted open-only Slack message", async () => {
    let posted: Record<string, unknown> | undefined;
    const provider = new SlackWebhookProviderAdapter({
      webhookUrl: "https://hooks.slack.com/services/a/b/c",
      fetch: async (_url, init) => {
        posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response("ok", { status: 200 });
      },
    });

    const outcome = await provider.deliver(input("slack"));
    const serialized = JSON.stringify(posted);

    expect(outcome.state).toBe("accepted");
    expect(serialized).toContain("Open in VekInbox");
    expect(serialized).toContain(notification.deepLink);
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("approve");
    expect(provider.capabilities.supportsInboundActions).toBe(false);
  });

  it("refuses non-Slack webhook hosts", () => {
    expect(() => new SlackWebhookProviderAdapter({ webhookUrl: "https://example.com/hook" })).toThrow(
      "Slack webhook URL",
    );
  });

  it("refuses credential-bearing Slack webhook URLs", () => {
    expect(() =>
      new SlackWebhookProviderAdapter({
        webhookUrl: "https://token:secret@hooks.slack.com/services/example",
      }),
    ).toThrow("Slack webhook URL");
  });
});

describe("SMS placeholder and optional provider registry", () => {
  it("records an explicit suppressed outcome and exposes no direct action capability", async () => {
    const provider = new SmsPlaceholderProviderAdapter();
    const outcome = await provider.deliver(input("sms"));

    expect(outcome).toMatchObject({ state: "suppressed", errorCode: "sms_provider_not_configured" });
    expect(provider.configured).toBe(false);
    expect(provider.capabilities.supportsInboundActions).toBe(false);
    expect(provider.capabilities.allowedRiskForInlineAction).toEqual([]);
  });

  it("keeps optional integrations absent when configuration is not supplied", () => {
    const providers = createConfiguredNotificationProviders({});

    expect(providers.email).toBeUndefined();
    expect(providers.slack).toBeUndefined();
    expect(providers.sms).toBeInstanceOf(SmsPlaceholderProviderAdapter);
  });

  it("prefers a channel-owned Slack webhook over the process-wide fallback", async () => {
    let postedTo: string | undefined;
    const providers = createConfiguredNotificationProviders(
      { SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/global/default" },
      async (url) => {
        postedTo = String(url);
        return new Response("ok", { status: 200 });
      },
      { slackWebhookUrl: "https://hooks.slack.com/services/channel/preferred" },
    );

    await providers.slack!.deliver(input("slack"));

    expect(postedTo).toBe("https://hooks.slack.com/services/channel/preferred");
  });

  it("records an explicit suppressed outcome when a configured channel is unavailable", async () => {
    const delivery = new MultiChannelNotificationDelivery({});

    await expect(delivery.deliver(input("email"))).resolves.toMatchObject({
      provider: "email",
      state: "suppressed",
      errorCode: "provider_not_configured",
    });
  });

  it("suppresses an expired intent before it reaches a provider", async () => {
    let delivered = false;
    const delivery = new MultiChannelNotificationDelivery({
      email: {
        providerKey: "email",
        configured: true,
        capabilities: {
          endpointKinds: ["email_address"],
          supportsDeliveryReceipts: false,
          supportsReadReceipts: false,
          supportsInboundActions: false,
          supportsThreadUpdates: false,
          maxPayloadBytes: 1,
          allowedRiskForInlineAction: [],
        },
        deliver: async () => {
          delivered = true;
          return { provider: "email", deliveryId: "dly_01", state: "accepted" };
        },
        redactForLogs: () => ({}),
      },
    });

    await expect(
      delivery.deliver({
        ...input("email"),
        notification: { ...notification, expiresAt: "2020-01-01T00:00:00.000Z" },
      }),
    ).resolves.toMatchObject({ state: "suppressed", errorCode: "notification_expired" });
    expect(delivered).toBe(false);
  });
});
