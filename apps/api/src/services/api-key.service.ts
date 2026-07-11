import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { agents, apiKeys } from "@latticeag/vekinbox-db";
import { API_KEY_PREFIX_LENGTH, generateId } from "@latticeag/vekinbox-shared";
import { hashApiKey, secureCompare } from "../lib/crypto.js";
import { getDb } from "../lib/db.js";
import type { ApiKeyAuth } from "../middleware/auth.js";

function keyEnvironment(rawKey: string): "live" | "test" {
  return rawKey.startsWith("vk_live_") ? "live" : "test";
}

export async function verifyApiKey(rawKey: string): Promise<ApiKeyAuth | null> {
  const db = getDb();
  const keyHash = hashApiKey(rawKey);
  const prefix = rawKey.slice(0, API_KEY_PREFIX_LENGTH);

  const rows = await db
    .select({
      apiKey: apiKeys,
      agent: agents,
    })
    .from(apiKeys)
    .innerJoin(agents, eq(apiKeys.agentId, agents.id))
    .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)))
    .limit(10);

  for (const row of rows) {
    if (secureCompare(row.apiKey.keyHash, keyHash)) {
      return {
        type: "api_key",
        agentId: row.agent.id,
        workspaceId: row.agent.workspaceId,
        apiKeyId: row.apiKey.id,
        environment: keyEnvironment(rawKey),
      };
    }
  }

  return null;
}

export function generateApiKey(environment: "live" | "test"): {
  key: string;
  prefix: string;
  hash: string;
} {
  const random = randomBytes(24).toString("base64url");
  const key = `vk_${environment}_${random}`;
  const prefix = key.slice(0, API_KEY_PREFIX_LENGTH);
  const hash = hashApiKey(key);
  return { key, prefix, hash };
}

export async function createApiKeyForAgent(
  agentId: string,
  name: string,
  environment: "live" | "test",
) {
  const db = getDb();
  const { key, prefix, hash } = generateApiKey(environment);
  const id = generateId("key");

  const [created] = await db
    .insert(apiKeys)
    .values({
      id,
      agentId,
      name,
      keyPrefix: prefix,
      keyHash: hash,
    })
    .returning();

  return { ...created!, key, environment };
}

export async function revokeApiKey(agentId: string, keyId: string) {
  const db = getDb();
  const [updated] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.agentId, agentId), isNull(apiKeys.revokedAt)))
    .returning();

  return updated ?? null;
}
