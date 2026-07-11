import type { NotificationEmailJobData } from "@latticeag/vekinbox-queue";
import type { Job } from "bullmq";
import { processEmailNotification } from "../services/notification.service.js";

export async function processEmailJob(job: Job<NotificationEmailJobData>) {
  await processEmailNotification({
    requestId: job.data.requestId,
    channelId: job.data.channelId,
    userId: job.data.userId,
  });
}
