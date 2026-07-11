import { getRedis } from "./redis.js";

const VIEWED_TTL_SECONDS = 3600;
const memoryDebounce = new Map<string, number>();

function debounceKey(userId: string, requestId: string): string {
  return `viewed:${userId}:${requestId}`;
}

export async function shouldRecordView(userId: string, requestId: string): Promise<boolean> {
  const key = debounceKey(userId, requestId);

  try {
    const redis = getRedis();
    const result = await redis.set(key, "1", "EX", VIEWED_TTL_SECONDS, "NX");
    return result === "OK";
  } catch {
    const now = Date.now();
    const expiresAt = memoryDebounce.get(key);
    if (expiresAt && expiresAt > now) {
      return false;
    }
    memoryDebounce.set(key, now + VIEWED_TTL_SECONDS * 1000);
    return true;
  }
}
