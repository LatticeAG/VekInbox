import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { generateId } from "@latticeag/vekinbox-shared";
import { requests, workspaces } from "@latticeag/vekinbox-db";
import { processExpiredRequests } from "../src/services/request.service.ts";
import { processTimeout } from "../../worker/src/processors/timeout.processor.ts";
import {
  apiFetch,
  createTestFixtures,
  getTestDb,
  setupTestDatabase,
  teardownTestDatabase,
  type TestFixtures,
} from "./helpers.js";

const describeIntegration = process.env["DATABASE_URL"] ? describe : describe.skip;

describeIntegration("timeout processor", () => {
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

  it("never auto-approves a timed-out request, even when legacy config asks for approval", async () => {
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
      key: `timeout-auto-approve.${Date.now()}`,
      title: "Unsafe legacy timeout default",
      description: "",
      status: "pending",
      priority: "normal",
      actions: [{ name: "approve", label: "Approve" }],
      defaultAction: "approve",
      timeoutAt: past,
      metadata: {},
      labels: [],
      createdAt: now,
      updatedAt: now,
    });

    await processTimeout({ data: { requestId } } as never);

    const [updated] = await db
      .select()
      .from(requests)
      .where(eq(requests.id, requestId))
      .limit(1);

    expect(updated).toMatchObject({
      status: "declined",
      resolutionAction: "decline",
    });
  });
});
