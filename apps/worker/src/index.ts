import {
  NOTIFICATION_EMAIL_JOB,
  NOTIFICATION_SLACK_JOB,
  QUEUE_NAMES,
  webhookBackoffStrategy,
} from "@latticeag/vekinbox-queue";
import { Worker } from "bullmq";
import { getWorkerConnection } from "./connection.js";
import { processEmailJob } from "./processors/email.processor.js";
import { processEscalation } from "./processors/escalation.processor.js";
import { processSlackJob } from "./processors/slack.processor.js";
import { processTimeout } from "./processors/timeout.processor.js";
import { processWebhookDelivery } from "./processors/webhook.processor.js";

const connection = getWorkerConnection();

const workers: Worker[] = [];

function startWorkers() {
  workers.push(
    new Worker(QUEUE_NAMES.WEBHOOKS, processWebhookDelivery, {
      connection: connection as never,
      settings: {
        backoffStrategy: webhookBackoffStrategy,
      },
    }),
  );

  workers.push(
    new Worker(
      QUEUE_NAMES.NOTIFICATIONS,
      async (job) => {
        if (job.name === NOTIFICATION_EMAIL_JOB) {
          await processEmailJob(job);
          return;
        }
        if (job.name === NOTIFICATION_SLACK_JOB) {
          await processSlackJob(job);
          return;
        }
        throw new Error(`Unknown notification job: ${job.name}`);
      },
      { connection: connection as never },
    ),
  );

  workers.push(
    new Worker(QUEUE_NAMES.ESCALATION, processEscalation, {
      connection: connection as never,
    }),
  );

  workers.push(
    new Worker(QUEUE_NAMES.TIMEOUT, processTimeout, {
      connection: connection as never,
    }),
  );

  for (const worker of workers) {
    worker.on("failed", (job, err) => {
      console.error(`[${worker.name}] job ${job?.id} failed:`, err.message);
    });
    worker.on("completed", (job) => {
      console.log(`[${worker.name}] job ${job.id} (${job.name}) completed`);
    });
  }
}

async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Starting VekInbox worker...");
startWorkers();
console.log(`Listening on queues: ${Object.values(QUEUE_NAMES).join(", ")}`);
