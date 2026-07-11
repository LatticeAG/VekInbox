import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { VekInboxError } from "@latticeag/vekinbox-shared";
import { apiKeyAuth } from "./auth.js";
import { SESSION_COOKIE, verifySessionToken } from "./session.js";

export async function requireReviewerOrApiKey(c: Context, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const payload = await verifySessionToken(token);
    if (payload) {
      c.set("sessionAuth", {
        type: "session",
        userId: payload.userId,
        email: payload.email,
      });
      await next();
      return;
    }
  }

  await apiKeyAuth(c, next);
}

export function getWorkspaceIdForRequest(c: Context): string {
  const session = c.get("sessionAuth");
  if (session) {
    const workspaceId = c.req.query("workspace_id");
    if (!workspaceId) {
      throw new VekInboxError(
        "validation_error",
        "workspace_id query parameter is required for session auth",
        400,
      );
    }
    return workspaceId;
  }

  return c.get("apiKeyAuth").workspaceId;
}
