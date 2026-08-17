import { Hono } from "hono";
import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { errorHandler } from "./middleware/error-handler.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { healthRoutes } from "./routes/health.js";
import { requestRoutes } from "./routes/requests.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { agentRoutes } from "./routes/agents.js";
import { authRoutes } from "./routes/auth.js";
import { policyRoutes } from "./routes/policies.js";
import { channelRoutes } from "./routes/channels.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { emailActionRoutes } from "./routes/actions/email.js";
import { slackRoutes } from "./routes/integrations/slack.js";
import { eventsRoutes } from "./routes/events.js";
import { v2ApprovalRoutes } from "./routes/v2-approvals.js";

function getCorsOrigins(): string[] {
  const origins = ["http://localhost:5173"];
  const webUrl = process.env["WEB_URL"];
  if (webUrl && !origins.includes(webUrl)) {
    origins.push(webUrl);
  }
  return origins;
}

function mountStaticUi(app: Hono) {
  const webDist = process.env["WEB_DIST"] ?? "/app/apps/web/dist";
  if (!existsSync(webDist)) {
    return;
  }

  app.use(
    "/*",
    serveStatic({
      root: webDist,
    }),
  );

  app.get("*", async (c, next) => {
    const path = c.req.path;
    if (path.startsWith("/v1") || path.startsWith("/v2") || path === "/health") {
      return next();
    }
    return serveStatic({ root: webDist, path: "index.html" })(c, next);
  });
}

export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: getCorsOrigins(),
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "If-Match"],
    }),
  );

  app.use("/v1/*", rateLimit);
  app.use("/v2/*", rateLimit);

  app.onError(errorHandler);

  app.route("/", healthRoutes);
  app.route("/v1/requests", requestRoutes);
  app.route("/v1/requests", webhookRoutes);
  app.route("/v1/workspaces", workspaceRoutes);
  app.route("/v1/workspaces", eventsRoutes);
  app.route("/v1/agents", agentRoutes);
  app.route("/v1/auth", authRoutes);
  app.route("/v1/actions", emailActionRoutes);
  app.route("/v1/integrations/slack", slackRoutes);
  app.route("/v1", policyRoutes);
  app.route("/v1", channelRoutes);
  app.route("/v2", v2ApprovalRoutes);

  mountStaticUi(app);

  return app;
}

export const app = createApp();
