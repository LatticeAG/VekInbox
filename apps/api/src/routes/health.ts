import { Hono } from "hono";
import { API_VERSION } from "@latticeag/vekinbox-shared";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => {
  return c.json({ status: "ok", version: API_VERSION });
});
