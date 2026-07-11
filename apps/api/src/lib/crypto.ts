import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hmacSha256, signWebhook, webhookHeaders } from "@latticeag/vekinbox-shared";

export { hmacSha256, signWebhook, webhookHeaders };

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function secureCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

