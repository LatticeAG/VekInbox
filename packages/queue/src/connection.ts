import { Redis } from "ioredis";

export type QueueConnection = Redis;

let sharedConnection: QueueConnection | null = null;

export function createQueueConnection(redisUrl: string): QueueConnection {
  if (sharedConnection) {
    return sharedConnection;
  }

  sharedConnection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  return sharedConnection;
}

export function getQueueConnection(): QueueConnection | null {
  return sharedConnection;
}

export async function closeQueueConnection(): Promise<void> {
  if (sharedConnection) {
    await sharedConnection.quit();
    sharedConnection = null;
  }
}
