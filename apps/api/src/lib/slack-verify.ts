import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

export function verifySlackSignature(
  signingSecret: string,
  signature: string | undefined,
  timestamp: string | undefined,
  rawBody: string,
): boolean {
  if (!signature || !timestamp) {
    return false;
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;

  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
