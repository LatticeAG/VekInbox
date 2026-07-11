import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { generateId } from "@latticeag/vekinbox-shared";
import { requests, workspaces } from "@latticeag/vekinbox-db";
import { processExpiredRequests } from "../src/services/request.service.js";
import {
  apiFetch,
  createTestFixtures,
  getTestDb,
  setupTestDatabase,
  teardownTestDatabase,
  type TestFixtures,
} from "./helpers.js";

describe("timeout processor", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    process.env["SESSION_SECRET"] = "test-session-secret";
    await setupTestDatabase();
    fixtures = await createTestFixtures();
  }, 60_000);

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it("marks pending requests past timeout as timed_out", async () => {
    const db = getTestDb();
    const requestId = generateId("req");
    const past = new Date(Date.now() - 60_000);
    const now = new Date();

    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, fixtures.workspaceA))
      .limit(1);

    await db.insert(requests).values({
      id: requestId,
      organizationId: workspace!.organizationId,
      workspaceId: fixtures.workspaceA,
      agentId: fixtures.agentA,
      key: `timeout.${Date.now()}`,
      title: "Expired request",
      description: "",
      status: "pending",
      priority: "normal",
      actions: [{ name: "approve", label: "Approve" }],
      timeoutAt: past,
      metadata: {},
      labels: [],
      createdAt: now,
      updatedAt: now,
    });

    const count = await processExpiredRequests();
    expect(count).toBeGreaterThanOrEqual(1);

    const showRes = await apiFetch(`/requests/${requestId}`, {
      apiKey: fixtures.apiKeyA,
    });
    const body = (await showRes.json()) as { status: string };
    expect(body.status).toBe("timed_out");
  });
});
