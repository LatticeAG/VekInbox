import type { Context, Next } from "hono";
import { VekInboxError } from "@latticeag/vekinbox-shared";
import { verifyApiKey } from "../services/api-key.service.js";

export type ApiKeyAuth = {
  type: "api_key";
  agentId: string;
  workspaceId: string;
  apiKeyId: string;
  environment: "live" | "test";
  rateLimitPerMinute: number;
};

declare module "hono" {
  interface ContextVariableMap {
    apiKeyAuth: ApiKeyAuth;
    sessionAuth: import("./session.js").SessionAuth;
  }
}

export async function apiKeyAuth(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new VekInboxError("unauthorized", "Missing or invalid Authorization header", 401);
  }

  const token = header.slice(7).trim();
  if (!token.startsWith("vk_live_") && !token.startsWith("vk_test_")) {
    throw new VekInboxError("invalid_api_key", "Invalid API key format", 401);
  }

  const auth = await verifyApiKey(token);
  if (!auth) {
    throw new VekInboxError("invalid_api_key", "Invalid or revoked API key", 401);
  }

  c.set("apiKeyAuth", auth);
  await next();
}

export function requireApiKey() {
  return apiKeyAuth;
}
