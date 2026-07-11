import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import {
  API_KEY_LIVE_PREFIX,
  API_KEY_PREFIX_LENGTH,
  generateId,
} from "@latticeag/vekinbox-shared";
import { createDb, closeDb, type Database } from "@latticeag/vekinbox-db";
import {
  agents,
  apiKeys,
  memberships,
  organizations,
  users,
  workspaces,
} from "@latticeag/vekinbox-db";
import { app } from "../../src/app.js";

export interface TestFixtures {
  orgId: string;
  workspaceA: string;
  workspaceB: string;
  userA: string;
  userB: string;
  agentA: string;
  agentB: string;
  apiKeyA: string;
  apiKeyB: string;
  sessionCookieA: string;
  sessionCookieB: string;
}

let db: Database | null = null;

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): string {
  return `${API_KEY_LIVE_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function getTestDb(): Database {
  if (!db) {
    const url = process.env["DATABASE_URL"];
    if (!url) {
      throw new Error("DATABASE_URL is required for integration tests");
    }
    db = createDb(url);
  }
  return db;
}

export async function setupTestDatabase(): Promise<void> {
  const database = getTestDb();
  const migrationsFolder = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../packages/db/drizzle",
  );
  await migrate(database, { migrationsFolder });
}

export async function teardownTestDatabase(): Promise<void> {
  if (db) {
    await closeDb(db);
    db = null;
  }
}

export async function createTestFixtures(): Promise<TestFixtures> {
  const database = getTestDb();
  const orgId = generateId("org");
  const workspaceA = generateId("ws");
  const workspaceB = generateId("ws");
  const userA = generateId("user");
  const userB = generateId("user");
  const agentA = generateId("agent");
  const agentB = generateId("agent");
  const apiKeyIdA = generateId("key");
  const apiKeyIdB = generateId("key");
  const membershipA = generateId("mbr");
  const membershipB = generateId("mbr");
  const fullApiKeyA = generateApiKey();
  const fullApiKeyB = generateApiKey();
  const now = new Date();

  await database.transaction(async (tx) => {
    await tx.insert(organizations).values({
      id: orgId,
      name: "Test Org",
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(workspaces).values([
      {
        id: workspaceA,
        organizationId: orgId,
        name: "Workspace A",
        slug: `ws-a-${workspaceA.slice(-6)}`,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: workspaceB,
        organizationId: orgId,
        name: "Workspace B",
        slug: `ws-b-${workspaceB.slice(-6)}`,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await tx.insert(users).values([
      { id: userA, email: `user-a-${userA.slice(-6)}@test.local`, name: "User A", createdAt: now, updatedAt: now },
      { id: userB, email: `user-b-${userB.slice(-6)}@test.local`, name: "User B", createdAt: now, updatedAt: now },
    ]);

    await tx.insert(memberships).values([
      { id: membershipA, workspaceId: workspaceA, userId: userA, role: "owner", createdAt: now },
      { id: membershipB, workspaceId: workspaceB, userId: userB, role: "owner", createdAt: now },
    ]);

    await tx.insert(agents).values([
      {
        id: agentA,
        workspaceId: workspaceA,
        name: "Agent A",
        description: "Test agent A",
        webhookSecret: randomBytes(32).toString("base64url"),
        permissions: {},
        createdAt: now,
        updatedAt: now,
      },
      {
        id: agentB,
        workspaceId: workspaceB,
        name: "Agent B",
        description: "Test agent B",
        webhookSecret: randomBytes(32).toString("base64url"),
        permissions: {},
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await tx.insert(apiKeys).values([
      {
        id: apiKeyIdA,
        agentId: agentA,
        keyHash: hashApiKey(fullApiKeyA),
        keyPrefix: fullApiKeyA.slice(0, API_KEY_PREFIX_LENGTH),
        name: "Test Key A",
        createdAt: now,
      },
      {
        id: apiKeyIdB,
        agentId: agentB,
        keyHash: hashApiKey(fullApiKeyB),
        keyPrefix: fullApiKeyB.slice(0, API_KEY_PREFIX_LENGTH),
        name: "Test Key B",
        createdAt: now,
      },
    ]);
  });

  const [userARow] = await database.select().from(users).where(eq(users.id, userA)).limit(1);
  const [userBRow] = await database.select().from(users).where(eq(users.id, userB)).limit(1);

  const sessionCookieA = await loginAndGetCookie(userARow!.email);
  const sessionCookieB = await loginAndGetCookie(userBRow!.email);

  return {
    orgId,
    workspaceA,
    workspaceB,
    userA,
    userB,
    agentA,
    agentB,
    apiKeyA: fullApiKeyA,
    apiKeyB: fullApiKeyB,
    sessionCookieA,
    sessionCookieB,
  };
}

export async function loginAndGetCookie(email: string): Promise<string> {
  const res = await app.request("/v1/auth/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    throw new Error(`Dev login failed: ${res.status} ${await res.text()}`);
  }

  const cookies = res.headers.getSetCookie?.() ?? [];
  const legacy = res.headers.get("set-cookie");
  const all = cookies.length > 0 ? cookies : legacy ? [legacy] : [];

  for (const header of all) {
    const match = header.match(/vekinbox_session=([^;]+)/);
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error("No session cookie in dev-login response");
}

export async function apiFetch(
  path: string,
  options: {
    method?: string;
    apiKey?: string;
    sessionCookie?: string;
    body?: unknown;
    query?: Record<string, string>;
  } = {},
): Promise<Response> {
  const routePath = path.startsWith("/v1")
    ? path
    : `/v1${path.startsWith("/") ? path : `/${path}`}`;

  let fullPath = routePath;
  if (options.query) {
    const params = new URLSearchParams(options.query);
    fullPath = `${routePath}?${params.toString()}`;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (options.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }
  if (options.sessionCookie) {
    headers.Cookie = `vekinbox_session=${options.sessionCookie}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return app.request(fullPath, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

export function signWebhookPayload(
  secret: string,
  timestamp: string,
  body: string,
): string {
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${expected}`;
}
