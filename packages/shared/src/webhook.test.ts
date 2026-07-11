import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@latticeag/vekinbox-shared";

function sign(secret: string, timestamp: string, body: string): string {
  const hex = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${hex}`;
}

describe("verifyWebhookSignature", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ request_id: "req_123", status: "approved" });
  const timestamp = String(Math.floor(Date.now() / 1000));

  it("accepts valid signatures", () => {
    const headers = {
      [WEBHOOK_SIGNATURE_HEADER]: sign(secret, timestamp, body),
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
    };
    expect(verifyWebhookSignature(headers, body, secret)).toBe(true);
  });

  it("rejects invalid signatures", () => {
    const headers = {
      [WEBHOOK_SIGNATURE_HEADER]: "sha256=deadbeef",
      [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
    };
    expect(verifyWebhookSignature(headers, body, secret)).toBe(false);
  });

  it("rejects stale timestamps", () => {
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    const headers = {
      [WEBHOOK_SIGNATURE_HEADER]: sign(secret, stale, body),
      [WEBHOOK_TIMESTAMP_HEADER]: stale,
    };
    expect(verifyWebhookSignature(headers, body, secret)).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(verifyWebhookSignature({}, body, secret)).toBe(false);
  });
});
