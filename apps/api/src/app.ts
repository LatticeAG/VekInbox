import { Hono } from "hono";
import { cors } from "hono/cors";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRoutes } from "./routes/health.js";
import { requestRoutes } from "./routes/requests.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { agentRoutes } from "./routes/agents.js";
import { authRoutes } from "./routes/auth.js";
import { policyRoutes } from "./routes/policies.js";
import { channelRoutes } from "./routes/channels.js";

export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: ["http://localhost:5173"],
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.onError(errorHandler);

  app.route("/", healthRoutes);
  app.route("/v1/requests", requestRoutes);
  app.route("/v1/workspaces", workspaceRoutes);
  app.route("/v1/agents", agentRoutes);
  app.route("/v1/auth", authRoutes);
  app.route("/v1", policyRoutes);
  app.route("/v1", channelRoutes);

  return app;
}

export const app = createApp();
