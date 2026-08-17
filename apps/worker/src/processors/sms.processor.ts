import type { NotificationSmsJobData } from "@latticeag/vekinbox-queue";
import type { Job } from "bullmq";
import { processSmsNotification } from "../services/notification.service.js";

export async function processSmsJob(job: Job<NotificationSmsJobData>) {
  await processSmsNotification({
    requestId: job.data.requestId,
    channelId: job.data.channelId,
    userId: job.data.userId,
    phoneNumber: job.data.phoneNumber,
  });
}
