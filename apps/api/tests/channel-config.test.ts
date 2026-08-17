import { describe, expect, it } from "vitest";
import { redactChannelConfig } from "../src/lib/channel-config.ts";

describe("channel configuration responses", () => {
  it("redacts provider credentials without hiding ordinary routing metadata", () => {
    expect(
      redactChannelConfig({
        name: "Release channel",
        channel_id: "C123",
        bot_token: "xoxb-secret",
        webhook_url: "https://hooks.slack.com/services/secret",
        nested: { api_key: "dse-secret", visible: true },
      }),
    ).toEqual({
      name: "Release channel",
      channel_id: "C123",
      bot_token: "[REDACTED]",
      webhook_url: "[REDACTED]",
      nested: { api_key: "[REDACTED]", visible: true },
    });
  });
});
