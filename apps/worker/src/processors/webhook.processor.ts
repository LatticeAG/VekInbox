import { eq } from "drizzle-orm";
import { agents, webhookDeliveries } from "@latticeag/vekinbox-db";
import {
  WEBHOOK_RETRY_DELAYS_MS,
  type WebhookDeliveryJobData,
} from "@latticeag/vekinbox-queue";
import { generateId, signWebhook, webhookHeaders } from "@latticeag/vekinbox-shared";
import type { Job } from "bullmq";
import { getDb } from "../lib/db.js";
import { appendRequestEvent } from "../services/audit.service.js";
import { assertSafeWebhookUrl } from "../services/ssrf.js";

const MAX_RESPONSE_BYTES = 4096;

async function readLimitedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < MAX_RESPONSE_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    const slice = value.byteLength > MAX_RESPONSE_BYTES - total ? value.slice(0, MAX_RESPONSE_BYTES - total) : value;
    chunks.push(slice);
    total += slice.byteLength;
  }

  await reader.cancel();
  return Buffer.concat(chunks).toString("utf8");
}

export async function processWebhookDelivery(job: Job<WebhookDeliveryJobData>) {
  const db = getDb();
  const { requestId, agentId, url, payload } = job.data;
  const attempt = job.attemptsMade + 1;
  const now = new Date();

  let deliveryId = job.data.deliveryId;
  if (!deliveryId) {
    deliveryId = generateId("del");
    await job.updateData({ ...job.data, deliveryId });
    await db.insert(webhookDeliveries).values({
      id: deliveryId,
      requestId,
      url,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  await assertSafeWebhookUrl(url);

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(payload);
  const signature = signWebhook(agent.webhookSecret, timestamp, body);

  let responseStatus: number | undefined;
  let responseBody: string | undefined;
  let errorMessage: string | undefined;

  try {
    const response = await fetch(url, {
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

    responseStatus = response.status;
    responseBody = await readLimitedBody(response);

    await db
      .update(webhookDeliveries)
      .set({
        attempts: attempt,
        lastAttemptAt: now,
        responseStatus,
        responseBody: responseBody.slice(0, MAX_RESPONSE_BYTES),
        updatedAt: now,
        nextAttemptAt:
          response.ok || attempt >= WEBHOOK_RETRY_DELAYS_MS.length
            ? null
            : new Date(now.getTime() + (WEBHOOK_RETRY_DELAYS_MS[attempt] ?? 0)),
        status: response.ok ? "delivered" : attempt >= WEBHOOK_RETRY_DELAYS_MS.length ? "failed" : "pending",
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    if (response.ok) {
      await appendRequestEvent({
        requestId,
        type: "request.webhook_delivered",
        actorType: "system",
        payload: {
          delivery_id: deliveryId,
          url,
          status_code: response.status,
          attempt,
        },
      });
      return;
    }

    errorMessage = `HTTP ${response.status}`;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Unknown error";
    await db
      .update(webhookDeliveries)
      .set({
        attempts: attempt,
        lastAttemptAt: now,
        responseStatus,
        responseBody: responseBody?.slice(0, MAX_RESPONSE_BYTES),
        updatedAt: now,
        nextAttemptAt:
          attempt >= WEBHOOK_RETRY_DELAYS_MS.length
            ? null
            : new Date(now.getTime() + (WEBHOOK_RETRY_DELAYS_MS[attempt] ?? 0)),
        status: attempt >= WEBHOOK_RETRY_DELAYS_MS.length ? "failed" : "pending",
      })
      .where(eq(webhookDeliveries.id, deliveryId));
  }

  if (attempt >= WEBHOOK_RETRY_DELAYS_MS.length) {
    await appendRequestEvent({
      requestId,
      type: "request.webhook_failed",
      actorType: "system",
      payload: {
        delivery_id: deliveryId,
        url,
        error: errorMessage,
        attempts: attempt,
      },
    });
    throw new Error(errorMessage ?? "Webhook delivery failed");
  }

  throw new Error(errorMessage ?? "Webhook delivery failed");
}
