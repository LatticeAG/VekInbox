import {
  NOTIFICATION_EMAIL_JOB,
  NOTIFICATION_SLACK_JOB,
  NOTIFICATION_SMS_JOB,
  QUEUE_NAMES,
  webhookBackoffStrategy,
} from "@latticeag/vekinbox-queue";
import { Worker } from "bullmq";
import { getWorkerConnection } from "./connection.js";
import { processEmailJob } from "./processors/email.processor.js";
import { processEscalation } from "./processors/escalation.processor.js";
import { processSlackJob } from "./processors/slack.processor.js";
import { processSmsJob } from "./processors/sms.processor.js";
import { processTimeout } from "./processors/timeout.processor.js";
import { processWebhookDelivery } from "./processors/webhook.processor.js";
import { reconcileV3ScheduleWork } from "./services/v3-schedule.service.js";

const connection = getWorkerConnection();

const workers: Worker[] = [];
let v3SchedulerTimer: ReturnType<typeof setInterval> | undefined;

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
        if (job.name === NOTIFICATION_SMS_JOB) {
          await processSmsJob(job);
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

  // The durable schedule ledger is reconciled independently of BullMQ. This
  // keeps delayed openings/deadlines correct even when a queue job is lost.
  if (process.env["DATABASE_URL"]) {
    const reconcile = () => {
      void reconcileV3ScheduleWork().catch((error: unknown) => {
        console.error("[v3-scheduler] reconciliation failed:", error);
      });
    };
    reconcile();
    v3SchedulerTimer = setInterval(reconcile, 10_000);
  }
}

async function shutdown() {
  console.log("Shutting down workers...");
  if (v3SchedulerTimer) clearInterval(v3SchedulerTimer);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Starting VekInbox worker...");
startWorkers();
console.log(`Listening on queues: ${Object.values(QUEUE_NAMES).join(", ")}`);
