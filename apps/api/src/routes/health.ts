import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { API_VERSION } from "@latticeag/vekinbox-shared";
import { checkRedisHealth } from "../lib/redis.js";
import { getDb } from "../lib/db.js";

export const healthRoutes = new Hono();

healthRoutes.get("/health", async (c) => {
  let dbStatus: "ok" | "fail" = "fail";
  let redisStatus: "ok" | "fail" = "fail";

  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    dbStatus = "ok";
  } catch {
    dbStatus = "fail";
  }

  redisStatus = (await checkRedisHealth()) ? "ok" : "fail";

  const status = dbStatus === "ok" ? "ok" : "degraded";

  return c.json({
    status,
    version: API_VERSION,
    redis: redisStatus,
    db: dbStatus,
  });
});
