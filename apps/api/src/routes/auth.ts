import { Hono } from "hono";
import { eq } from "drizzle-orm";
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
