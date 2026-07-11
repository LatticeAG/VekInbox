import { createQueueConnection } from "@latticeag/vekinbox-queue";

export function getRedisUrl(): string {
  const url = process.env["REDIS_URL"];
  if (!url) {
    throw new Error("REDIS_URL is not set");
  }
  return url;
}

export function getWorkerConnection() {
  return createQueueConnection(getRedisUrl());
}
