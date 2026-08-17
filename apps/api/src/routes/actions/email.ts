import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { notFound, requestNotResolvable } from "@latticeag/vekinbox-shared";
import { requests } from "@latticeag/vekinbox-db";
import { verifyEmailActionToken } from "../../lib/email-token.js";
import { resolveRequest } from "../../services/request.service.js";
import { getDb } from "../../lib/db.js";

export const emailActionRoutes = new Hono();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function confirmPageHtml(params: {
  title: string;
  action: string;
  token: string;
  error?: string;
}): string {
  const title = escapeHtml(params.title);
  const action = escapeHtml(params.action);
  const token = escapeHtml(params.token);
  const errorBlock = params.error
    ? `<p style="color:#b91c1c;margin-bottom:1rem">${escapeHtml(params.error)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #111; }
    button { background: #111; color: #fff; border: 0; padding: 0.75rem 1.25rem; border-radius: 0.375rem; cursor: pointer; }
    button:hover { background: #333; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${errorBlock}
  <p>Confirm action: <strong>${action}</strong></p>
  <form method="POST" action="/v1/actions/email/confirm">
    <input type="hidden" name="token" value="${token}" />
    <button type="submit">Confirm</button>
  </form>
</body>
</html>`;
}

emailActionRoutes.get("/email", async (c) => {
  const token = c.req.query("token");
  if (!token) {
    return c.html(confirmPageHtml({ title: "Invalid link", action: "", token: "", error: "Missing token" }), 400);
  }

  const payload = await verifyEmailActionToken(token);
  if (!payload) {
    return c.html(confirmPageHtml({ title: "Invalid link", action: "", token: "", error: "Token expired or invalid" }), 400);
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(requests)
    .where(eq(requests.id, payload.request_id))
    .limit(1);

  if (!row) {
    throw notFound("Request", payload.request_id);
  }

  if (
    row.status !== "pending" &&
    row.status !== "changes_requested" &&
    row.status !== "escalated"
  ) {
    return c.html(
      confirmPageHtml({
        title: row.title,
        action: payload.action,
        token,
        error: `Request is already ${row.status}`,
      }),
      409,
    );
  }

  return c.html(
    confirmPageHtml({
      title: row.title,
      action: payload.action,
      token,
    }),
  );
});

emailActionRoutes.post("/email/confirm", async (c) => {
  let token: string | undefined;

  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await c.req.json().catch(() => ({}));
    token = typeof body.token === "string" ? body.token : undefined;
  } else {
    const body = await c.req.parseBody();
    token = typeof body["token"] === "string" ? body["token"] : undefined;
  }

  if (!token) {
    return c.json({ error: { code: "validation_error", message: "token is required" } }, 400);
  }

  const payload = await verifyEmailActionToken(token);
  if (!payload) {
    return c.json({ error: { code: "unauthorized", message: "Token expired or invalid" } }, 401);
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(requests)
    .where(eq(requests.id, payload.request_id))
    .limit(1);

  if (!row) {
    throw notFound("Request", payload.request_id);
  }

  if (
    row.status !== "pending" &&
    row.status !== "changes_requested" &&
    row.status !== "escalated"
  ) {
    throw requestNotResolvable(payload.request_id, row.status);
  }

  const request = await resolveRequest({
    workspaceId: row.workspaceId,
    requestId: payload.request_id,
    action: payload.action,
    resolvedBy: payload.user_id,
    input: {},
  });

  if (contentType.includes("application/json")) {
    return c.json(request);
  }

  return c.html(
    `<!DOCTYPE html><html><body><h1>Request ${request.status}</h1><p>Action <strong>${payload.action}</strong> recorded.</p></body></html>`,
  );
});
