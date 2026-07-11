import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@latticeag/vekinbox-shared";

export function hmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  const signature = hmacSha256(secret, `${timestamp}.${body}`);
  return `sha256=${signature}`;
}

export function secureCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export const webhookHeaders = {
  signature: WEBHOOK_SIGNATURE_HEADER,
  timestamp: WEBHOOK_TIMESTAMP_HEADER,
  deliveryId: WEBHOOK_DELIVERY_ID_HEADER,
} as const;
