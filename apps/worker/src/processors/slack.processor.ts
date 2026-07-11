import type { NotificationSlackJobData } from "@latticeag/vekinbox-queue";
import type { Job } from "bullmq";
import { processSlackNotification } from "../services/notification.service.js";

export async function processSlackJob(job: Job<NotificationSlackJobData>) {
  await processSlackNotification({
    requestId: job.data.requestId,
    channelId: job.data.channelId,
  });
}
