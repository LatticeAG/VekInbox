import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { requests } from "@latticeag/vekinbox-db";
import { verifySlackSignature } from "../../lib/slack-verify.js";
import { getDb } from "../../lib/db.js";
import { resolveRequest } from "../../services/request.service.js";

export const slackRoutes = new Hono();

function getSigningSecret(): string | undefined {
  return process.env["SLACK_SIGNING_SECRET"];
}


slackRoutes.post("/events", async (c) => {
  const secret = getSigningSecret();
  if (!secret) {
    return c.json({ error: { code: "internal_error", message: "Slack not configured" } }, 503);
  }

  const rawBody = await c.req.text();
  const valid = verifySlackSignature(
    secret,
    c.req.header("x-slack-signature"),
    c.req.header("x-slack-request-timestamp"),
    rawBody,
  );

  if (!valid) {
    return c.json({ error: { code: "unauthorized", message: "Invalid Slack signature" } }, 401);
  }

  const body = JSON.parse(rawBody) as {
    type?: string;
    challenge?: string;
    event?: { type?: string };
  };

  if (body.type === "url_verification" && body.challenge) {
    return c.json({ challenge: body.challenge });
  }

  return c.json({ ok: true });
});

slackRoutes.post("/interactions", async (c) => {
  const secret = getSigningSecret();
  if (!secret) {
    return c.json({ error: { code: "internal_error", message: "Slack not configured" } }, 503);
  }

  const rawBody = await c.req.text();
  const valid = verifySlackSignature(
    secret,
    c.req.header("x-slack-signature"),
    c.req.header("x-slack-request-timestamp"),
    rawBody,
  );

  if (!valid) {
    return c.json({ error: { code: "unauthorized", message: "Invalid Slack signature" } }, 401);
  }

  const params = new URLSearchParams(rawBody);
  const payloadRaw = params.get("payload");
  if (!payloadRaw) {
    return c.json({ error: { code: "validation_error", message: "Missing payload" } }, 400);
  }

  const payload = JSON.parse(payloadRaw) as {
    type?: string;
    user?: { id?: string };
    actions?: Array<{ action_id?: string; value?: string }>;
  };

  if (payload.type !== "block_actions" || !payload.actions?.length) {
    return c.json({ ok: true });
  }

  const action = payload.actions[0]!;
  const actionId = action.action_id ?? "";
  const value = action.value ?? "";

  const match = value.match(/^(req_[^:]+):([^:]+)(?::(.+))?$/);
  if (!match) {
    return c.json({ ok: true });
  }

  const [, requestId, resolveAction, userId] = match;
  if (!requestId || !resolveAction) {
    return c.json({ ok: true });
  }

  if (actionId !== "approve" && actionId !== "decline" && actionId !== resolveAction) {
    return c.json({ ok: true });
  }

  const db = getDb();
  const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!row) {
    return c.json({ ok: true });
  }

  if (
    row.status !== "pending" &&
    row.status !== "changes_requested" &&
    row.status !== "escalated"
  ) {
    return c.json({
      response_type: "ephemeral",
      text: `Request is already ${row.status}`,
    });
  }

  const resolvedBy = userId ?? `slack:${payload.user?.id ?? "unknown"}`;

  await resolveRequest({
    workspaceId: row.workspaceId,
    requestId,
    action: resolveAction,
    resolvedBy,
    input: {},
  });

  return c.json({
    response_type: "ephemeral",
    text: `Request ${resolveAction}d`,
  });
});
