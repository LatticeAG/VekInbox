import type { ResumeWebhookPayload } from "@latticeag/vekinbox-shared";
import { eq } from "drizzle-orm";
import { agents } from "@latticeag/vekinbox-db";
import { generateId } from "@latticeag/vekinbox-shared";
import { signWebhook, webhookHeaders } from "../lib/crypto.js";
import { getDb } from "../lib/db.js";
import { appendRequestEvent } from "./audit.service.js";

const RETRY_DELAYS_MS = [0, 1000, 3000];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deliverWebhook(params: {
  requestId: string;
  agentId: string;
  url: string;
  payload: ResumeWebhookPayload;
}) {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, params.agentId)).limit(1);
  if (!agent) {
    return { success: false, error: "Agent not found" };
  }

  const deliveryId = generateId("del");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(params.payload);
  const signature = signWebhook(agent.webhookSecret, timestamp, body);

  let lastError: string | undefined;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt]!);
    }

    try {
      const response = await fetch(params.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [webhookHeaders.signature]: signature,
          [webhookHeaders.timestamp]: timestamp,
          [webhookHeaders.deliveryId]: deliveryId,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        await appendRequestEvent({
          requestId: params.requestId,
          type: "request.webhook_delivered",
          actorType: "system",
          payload: {
            delivery_id: deliveryId,
            url: params.url,
            status_code: response.status,
            attempt: attempt + 1,
          },
        });
        return { success: true, deliveryId };
      }

      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Unknown error";
    }
  }

  await appendRequestEvent({
    requestId: params.requestId,
    type: "request.webhook_failed",
    actorType: "system",
    payload: {
      delivery_id: deliveryId,
      url: params.url,
      error: lastError,
      attempts: RETRY_DELAYS_MS.length,
    },
  });

  return { success: false, deliveryId, error: lastError };
}

export async function queueWebhookDelivery(params: {
  requestId: string;
  agentId: string;
  url: string;
  payload: ResumeWebhookPayload;
}) {
  return deliverWebhook(params);
}
