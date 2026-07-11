import { createHash, randomBytes } from "node:crypto";
import {
  API_KEY_LIVE_PREFIX,
  API_KEY_PREFIX_LENGTH,
  generateId,
} from "@latticeag/vekinbox-shared";
import { createDb, closeDb } from "./client.js";
import {
  agents,
  apiKeys,
  memberships,
  organizations,
  users,
  workspaces,
} from "./schema.js";

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): string {
  const suffix = randomBytes(24).toString("base64url");
  return `${API_KEY_LIVE_PREFIX}${suffix}`;
}

async function main() {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = createDb(connectionString);

  try {
    const orgId = generateId("org");
    const workspaceId = generateId("ws");
    const userId = generateId("user");
    const membershipId = generateId("mbr");
    const agentId = generateId("agent");
    const apiKeyId = generateId("key");
    const webhookSecret = randomBytes(32).toString("base64url");
    const fullApiKey = generateApiKey();
    const keyPrefix = fullApiKey.slice(0, API_KEY_PREFIX_LENGTH);

    await db.transaction(async (tx) => {
      await tx.insert(organizations).values({
        id: orgId,
        name: "Demo Organization",
      });

      await tx.insert(workspaces).values({
        id: workspaceId,
        organizationId: orgId,
        name: "Demo Workspace",
        slug: "demo",
        settings: {},
      });

      await tx.insert(users).values({
        id: userId,
        email: "admin@localhost",
        name: "Admin User",
      });

      await tx.insert(memberships).values({
        id: membershipId,
        workspaceId,
        userId,
        role: "owner",
      });

      await tx.insert(agents).values({
        id: agentId,
        workspaceId,
        name: "Demo Agent",
        description: "Seed agent for local development",
        webhookSecret,
        permissions: {},
        rateLimitPerMinute: 60,
      });

      await tx.insert(apiKeys).values({
        id: apiKeyId,
        agentId,
        keyHash: hashApiKey(fullApiKey),
        keyPrefix,
        name: "Default API Key",
      });
    });

    console.log("Seed data created:");
    console.log(`  Organization: ${orgId}`);
    console.log(`  Workspace:    ${workspaceId}`);
    console.log(`  User:         ${userId} (admin@localhost)`);
    console.log(`  Agent:        ${agentId}`);
    console.log(`  API Key:      ${fullApiKey}`);
    console.log("");
    console.log("Save the API key — it will not be shown again.");
  } finally {
    await closeDb(db);
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
