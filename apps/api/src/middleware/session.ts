import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { SignJWT, jwtVerify } from "jose";
import type { SessionPayload } from "@latticeag/vekinbox-shared";
import { VekInboxError } from "@latticeag/vekinbox-shared";

export const SESSION_COOKIE = "vekinbox_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSessionSecret(): Uint8Array {
  const secret = process.env["SESSION_SECRET"] ?? "dev-secret-change-in-production";
  return new TextEncoder().encode(secret);
}

export type SessionAuth = {
  type: "session";
  userId: string;
  email: string;
};

declare module "hono" {
  interface ContextVariableMap {
    sessionAuth: SessionAuth;
  }
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSessionSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    if (typeof payload["userId"] !== "string" || typeof payload["email"] !== "string") {
      return null;
    }
    return { userId: payload["userId"], email: payload["email"] };
  } catch {
    return null;
  }
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function sessionAuth(c: Context, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    throw new VekInboxError("unauthorized", "Session required", 401);
  }

  const payload = await verifySessionToken(token);
  if (!payload) {
    throw new VekInboxError("unauthorized", "Invalid or expired session", 401);
  }

  c.set("sessionAuth", {
    type: "session",
    userId: payload.userId,
    email: payload.email,
  });
  await next();
}

export async function optionalSessionAuth(c: Context, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const payload = await verifySessionToken(token);
    if (payload) {
      c.set("sessionAuth", {
        type: "session",
        userId: payload.userId,
        email: payload.email,
      });
    }
  }
  await next();
}

export function requireSession() {
  return sessionAuth;
}
