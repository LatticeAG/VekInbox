import { Redis } from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env["REDIS_URL"] ?? "redis://localhost:6379";
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return redis;
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedis();
    await client.connect();
    const result = await client.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}
