import { describe, expect, it } from "vitest";
import {
  isSafeLegacyDecisionAction,
  isSafeLegacyTimeoutOutcome,
  normalizeLegacyTimeoutOutcome,
  partitionLegacyDecisionActions,
  redactLegacyAuditPayload,
} from "../src/lib/approval-safety";

describe("legacy approval safety rails", () => {
  it("fails closed for unsafe or unknown timeout outcomes", () => {
    expect(isSafeLegacyTimeoutOutcome("decline")).toBe(true);
    expect(isSafeLegacyTimeoutOutcome("escalate")).toBe(true);
    expect(isSafeLegacyTimeoutOutcome("approve")).toBe(false);
    expect(isSafeLegacyTimeoutOutcome("anything_else")).toBe(false);

    expect(normalizeLegacyTimeoutOutcome("escalate")).toBe("escalate");
    expect(normalizeLegacyTimeoutOutcome("approve")).toBe("decline");
    expect(normalizeLegacyTimeoutOutcome(undefined)).toBe("decline");
  });

  it("does not expose custom legacy actions whose outcomes are undefined", () => {
    expect(isSafeLegacyDecisionAction("approve")).toBe(true);
    expect(isSafeLegacyDecisionAction("decline")).toBe(true);
    expect(isSafeLegacyDecisionAction("request_changes")).toBe(true);
    expect(isSafeLegacyDecisionAction("retry_with_override")).toBe(false);

    expect(
      partitionLegacyDecisionActions([
        { name: "approve", label: "Approve" },
        { name: "retry_with_override", label: "Retry with override" },
        { name: "decline", label: "Decline" },
      ]),
    ).toEqual({
      safeActions: [
        { name: "approve", label: "Approve" },
        { name: "decline", label: "Decline" },
      ],
      blockedActionNames: ["retry_with_override"],
    });
  });

  it("redacts credentials and bounds legacy technical payloads", () => {
    const longMessage = "x".repeat(2_100);
    const payload = redactLegacyAuditPayload({
      authorization: "Bearer top-secret",
      nested: {
        api_key: "vk_live_secret",
        accessToken: "also-hidden",
        safe: "visible",
      },
      items: ["first", { password: "hidden" }],
      message: longMessage,
    });

    expect(payload).toMatchObject({
      authorization: "[redacted]",
      nested: {
        api_key: "[redacted]",
        accessToken: "[redacted]",
        safe: "visible",
      },
      items: ["first", { password: "[redacted]" }],
    });
    expect(payload.message).toBe(`${longMessage.slice(0, 2_000)}… [truncated]`);
  });
});
