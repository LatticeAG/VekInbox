import { createHmac, timingSafeEqual } from "node:crypto";
import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_MAX_TIMESTAMP_SKEW_MS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "./types.js";

export function hmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  const signature = hmacSha256(secret, `${timestamp}.${body}`);
  return `sha256=${signature}`;
}

export const webhookHeaders = {
  signature: WEBHOOK_SIGNATURE_HEADER,
  timestamp: WEBHOOK_TIMESTAMP_HEADER,
  deliveryId: WEBHOOK_DELIVERY_ID_HEADER,
} as const;

export type WebhookHeaders = Record<string, string | string[] | undefined>;

function getHeader(headers: WebhookHeaders, name: string): string | undefined {
  const lower = name.toLowerCase();
  const direct = headers[lower] ?? headers[name];
  if (Array.isArray(direct)) {
    return direct[0];
  }
  return direct;
}

/**
 * Verify an incoming VekInbox resume webhook signature.
 *
 * Signature format: `sha256=<hex>` over `${timestamp}.${rawBody}` using HMAC-SHA256.
 * Rejects payloads with timestamps outside ±5 minutes.
 */
export function verifyWebhookSignature(
  headers: WebhookHeaders,
  rawBody: string | Buffer,
  secret: string,
): boolean {
  const signature = getHeader(headers, WEBHOOK_SIGNATURE_HEADER);
  const timestamp = getHeader(headers, WEBHOOK_TIMESTAMP_HEADER);

  if (!signature || !timestamp) {
    return false;
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }

  const skew = Math.abs(Date.now() - ts * 1000);
  if (skew > WEBHOOK_MAX_TIMESTAMP_SKEW_MS) {
    return false;
  }

  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const signedPayload = `${timestamp}.${body}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  const provided = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;

  if (provided.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
