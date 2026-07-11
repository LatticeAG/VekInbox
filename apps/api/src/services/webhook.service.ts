import type { ResumeWebhookPayload } from "@latticeag/vekinbox-shared";
import {
  createQueueConnection,
  enqueueWebhookDelivery,
} from "@latticeag/vekinbox-queue";
import { eq } from "drizzle-orm";
import { agents, webhookDeliveries } from "@latticeag/vekinbox-db";
import { generateId, signWebhook, webhookHeaders } from "@latticeag/vekinbox-shared";
import { getDb } from "../lib/db.js";
import { appendRequestEvent } from "./audit.service.js";

const RETRY_DELAYS_MS = [0, 1000, 3000];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRedisUrl(): string | undefined {
  return process.env["REDIS_URL"];
}

function buildResumePayload(
  request: {
    id: string;
    workspaceId: string;
    agentId: string;
    key: string;
    status: string;
    metadata: Record<string, unknown>;
    resolvedAt: string | null;
  },
  action: string,
  resolvedBy: string | null,
  note?: string,
): ResumeWebhookPayload {
  return {
    request_id: request.id,
    workspace_id: request.workspaceId,
    agent_id: request.agentId,
    key: request.key,
    status: request.status as ResumeWebhookPayload["status"],
    action,
    resolved_by: resolvedBy ?? undefined,
    resolved_at: request.resolvedAt ?? new Date().toISOString(),
    note,
    metadata: request.metadata,
  };
}

export async function deliverWebhook(params: {
  deliveryId: string;
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

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(params.payload);
  const signature = signWebhook(agent.webhookSecret, timestamp, body);

  let lastError: string | undefined;
  let lastStatus: number | undefined;

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
          [webhookHeaders.deliveryId]: params.deliveryId,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      lastStatus = response.status;

      if (response.ok) {
        await db
          .update(webhookDeliveries)
          .set({
            status: "delivered",
            attempts: attempt + 1,
            lastAttemptAt: new Date(),
            responseStatus: response.status,
            updatedAt: new Date(),
          })
          .where(eq(webhookDeliveries.id, params.deliveryId));

        await appendRequestEvent({
          requestId: params.requestId,
          type: "request.webhook_delivered",
          actorType: "system",
          payload: {
            delivery_id: params.deliveryId,
            url: params.url,
            status_code: response.status,
            attempt: attempt + 1,
          },
        });
        return { success: true, deliveryId: params.deliveryId };
      }

      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Unknown error";
    }
  }

  await db
    .update(webhookDeliveries)
    .set({
      status: "failed",
      attempts: RETRY_DELAYS_MS.length,
      lastAttemptAt: new Date(),
      responseStatus: lastStatus,
      responseBody: lastError,
      updatedAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, params.deliveryId));

  await appendRequestEvent({
    requestId: params.requestId,
    type: "request.webhook_failed",
    actorType: "system",
    payload: {
      delivery_id: params.deliveryId,
      url: params.url,
      error: lastError,
      attempts: RETRY_DELAYS_MS.length,
    },
  });

  return { success: false, deliveryId: params.deliveryId, error: lastError };
}

export async function queueWebhookDelivery(params: {
  requestId: string;
  agentId: string;
  url: string;
  payload: ResumeWebhookPayload;
}) {
  const db = getDb();
  const deliveryId = generateId("del");
  const now = new Date();

  await db.insert(webhookDeliveries).values({
    id: deliveryId,
    requestId: params.requestId,
    url: params.url,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const redisUrl = getRedisUrl();
  if (redisUrl) {
    try {
      const connection = createQueueConnection(redisUrl);
      const job = await enqueueWebhookDelivery(connection, {
        deliveryId,
        requestId: params.requestId,
        agentId: params.agentId,
        url: params.url,
        payload: params.payload,
      });
      return { deliveryId, queued: true, jobId: job.id };
    } catch {
      // Fall through to inline delivery when Redis is unavailable.
    }
  }

  return deliverWebhook({
    deliveryId,
    requestId: params.requestId,
    agentId: params.agentId,
    url: params.url,
    payload: params.payload,
  });
}

export async function redeliverWebhook(params: {
  requestId: string;
  agentId: string;
  url: string;
  action: string;
  resolvedBy: string | null;
  note?: string;
  request: {
    id: string;
    workspaceId: string;
    agentId: string;
    key: string;
    status: string;
    metadata: Record<string, unknown>;
    resolvedAt: Date | null;
  };
}) {
  const payload = buildResumePayload(
    {
      id: params.request.id,
      workspaceId: params.request.workspaceId,
      agentId: params.request.agentId,
      key: params.request.key,
      status: params.request.status,
      metadata: params.request.metadata,
      resolvedAt: params.request.resolvedAt?.toISOString() ?? null,
    },
    params.action,
    params.resolvedBy,
    params.note,
  );

  return queueWebhookDelivery({
    requestId: params.requestId,
    agentId: params.agentId,
    url: params.url,
    payload,
  });
}

export async function listWebhookDeliveries(requestId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.requestId, requestId));

  return rows.map((row) => ({
    id: row.id,
    request_id: row.requestId,
    url: row.url,
    status: row.status,
    attempts: row.attempts,
    last_attempt_at: row.lastAttemptAt?.toISOString() ?? null,
    next_attempt_at: row.nextAttemptAt?.toISOString() ?? null,
    response_status: row.responseStatus,
    response_body: row.responseBody,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }));
}
