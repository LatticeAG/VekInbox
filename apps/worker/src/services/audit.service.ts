import { eq } from "drizzle-orm";
import { requestEvents } from "@latticeag/vekinbox-db";
import { generateId } from "@latticeag/vekinbox-shared";
import { getDb } from "../lib/db.js";

export type ActorType = "user" | "agent" | "system";

export async function appendRequestEvent(params: {
  requestId: string;
  type: string;
  actorType: ActorType;
  actorId?: string | null;
  payload?: Record<string, unknown>;
}) {
  const db = getDb();
  const [event] = await db
    .insert(requestEvents)
    .values({
      id: generateId("evt"),
      requestId: params.requestId,
      type: params.type,
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      payload: params.payload ?? {},
    })
    .returning();

  return event!;
}
