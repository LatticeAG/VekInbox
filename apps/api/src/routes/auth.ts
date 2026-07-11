import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { devLoginSchema } from "@latticeag/vekinbox-shared";
import { users } from "@latticeag/vekinbox-db";
import { generateId } from "@latticeag/vekinbox-shared";
import {
  clearSessionCookie,
  createSessionToken,
  requireSession,
  setSessionCookie,
} from "../middleware/session.js";
import { getDb } from "../lib/db.js";
import { getOidcConfig, getOidcRedirectUri, isOidcEnabled } from "../lib/oidc.js";

const OIDC_STATE_COOKIE = "vekinbox_oidc_state";

export const authRoutes = new Hono();

authRoutes.post("/dev-login", async (c) => {
  const body = devLoginSchema.parse(await c.req.json());
  const db = getDb();

  let [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);

  if (!user) {
    const id = generateId("user");
    const now = new Date();
    [user] = await db
      .insert(users)
      .values({
        id,
        email: body.email,
        name: body.email.split("@")[0] ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  }

  const token = await createSessionToken({ userId: user!.id, email: user!.email });
  setSessionCookie(c, token);

  return c.json({
    user: {
      id: user!.id,
      email: user!.email,
      name: user!.name,
      created_at: user!.createdAt.toISOString(),
    },
  });
});

authRoutes.post("/logout", async (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireSession(), async (c) => {
  const session = c.get("sessionAuth");
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

  if (!user) {
    return c.json({ error: { code: "not_found", message: "User not found" } }, 404);
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    created_at: user.createdAt.toISOString(),
  });
});

authRoutes.get("/oidc/login", async (c) => {
  if (!isOidcEnabled()) {
    return c.json({ error: { code: "not_found", message: "OIDC is not configured" } }, 404);
  }

  const config = await getOidcConfig();
  const state = randomBytes(16).toString("hex");
  const redirectUri = getOidcRedirectUri();

  c.header(
    "Set-Cookie",
    `${OIDC_STATE_COOKIE}=${state}; HttpOnly; Path=/; SameSite=Lax; Max-Age=600${
      process.env["NODE_ENV"] === "production" ? "; Secure" : ""
    }`,
  );

  const params = new URLSearchParams({
    client_id: process.env["OIDC_CLIENT_ID"]!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
  });

  return c.redirect(`${config.authorizationEndpoint}?${params.toString()}`);
});

authRoutes.get("/oidc/callback", async (c) => {
  if (!isOidcEnabled()) {
    return c.json({ error: { code: "not_found", message: "OIDC is not configured" } }, 404);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = c.req.header("cookie")?.match(/vekinbox_oidc_state=([^;]+)/)?.[1];

  if (!code || !state || !cookieState || state !== cookieState) {
    return c.json({ error: { code: "unauthorized", message: "Invalid OIDC state" } }, 401);
  }

  const config = await getOidcConfig();
  const redirectUri = getOidcRedirectUri();

  const tokenResponse = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: process.env["OIDC_CLIENT_ID"]!,
      client_secret: process.env["OIDC_CLIENT_SECRET"]!,
    }),
  });

  if (!tokenResponse.ok) {
    return c.json({ error: { code: "unauthorized", message: "OIDC token exchange failed" } }, 401);
  }

  const tokens = (await tokenResponse.json()) as { id_token?: string };
  if (!tokens.id_token) {
    return c.json({ error: { code: "unauthorized", message: "Missing id_token" } }, 401);
  }

  const jwks = createRemoteJWKSet(new URL(config.jwksUri));
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: config.issuer,
    audience: process.env["OIDC_CLIENT_ID"]!,
  });

  const email = typeof payload["email"] === "string" ? payload["email"] : null;
  if (!email) {
    return c.json({ error: { code: "unauthorized", message: "Email claim missing from id_token" } }, 401);
  }

  const db = getDb();
  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) {
    const id = generateId("user");
    const now = new Date();
    const name =
      typeof payload["name"] === "string" ? payload["name"] : email.split("@")[0] ?? null;
    [user] = await db
      .insert(users)
      .values({
        id,
        email,
        name,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  }

  const token = await createSessionToken({ userId: user!.id, email: user!.email });
  setSessionCookie(c, token);

  const webUrl = process.env["WEB_URL"] ?? "http://localhost:5173";
  return c.redirect(webUrl);
});
