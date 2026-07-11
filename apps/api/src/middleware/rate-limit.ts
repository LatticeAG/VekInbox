import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { VekInboxError } from "@latticeag/vekinbox-shared";
import { verifyApiKey } from "../services/api-key.service.js";
import { getRedis } from "../lib/redis.js";
import { SESSION_COOKIE, verifySessionToken } from "./session.js";

const DEFAULT_LIMIT = 60;

async function checkRateLimit(
  apiKeyId: string,
  limitPerMinute: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const windowMs = 60_000;
  const windowKey = Math.floor(Date.now() / windowMs);
  const key = `ratelimit:${apiKeyId}:${windowKey}`;
  const limit = limitPerMinute > 0 ? limitPerMinute : DEFAULT_LIMIT;

  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 60);
    }
    if (count > limit) {
      const retryAfter = Math.ceil((windowMs - (Date.now() % windowMs)) / 1000);
      return { allowed: false, retryAfter };
    }
    return { allowed: true, retryAfter: 0 };
  } catch {
    return { allowed: true, retryAfter: 0 };
  }
}

export async function rateLimit(c: Context, next: Next) {
  const sessionToken = getCookie(c, SESSION_COOKIE);
  if (sessionToken) {
    const session = await verifySessionToken(sessionToken);
    if (session) {
      await next();
      return;
    }
  }

  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    await next();
    return;
  }

  const rawKey = header.slice(7).trim();
  if (!rawKey.startsWith("vk_live_") && !rawKey.startsWith("vk_test_")) {
    await next();
    return;
  }

  const auth = await verifyApiKey(rawKey);
  if (!auth) {
    await next();
    return;
  }

  const { allowed, retryAfter } = await checkRateLimit(
    auth.apiKeyId,
    auth.rateLimitPerMinute,
  );

  if (!allowed) {
    c.header("Retry-After", String(retryAfter));
    throw new VekInboxError(
      "validation_error",
      `Rate limit exceeded (${auth.rateLimitPerMinute} requests per minute)`,
      429,
    );
  }

  await next();
}
