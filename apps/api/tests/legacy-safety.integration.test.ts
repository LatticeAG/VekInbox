import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  escalationPolicies,
  memberships,
  requestEvents,
  requests,
} from "@latticeag/vekinbox-db";
import { generateId } from "@latticeag/vekinbox-shared";
import { processEscalation } from "../../worker/src/processors/escalation.processor.ts";
import { processTimeout } from "../../worker/src/processors/timeout.processor.ts";
import {
  apiFetch,
  createTestFixtures,
  getTestDb,
  setupTestDatabase,
  teardownTestDatabase,
  type TestFixtures,
} from "./helpers.js";

// The source suite remains runnable without Postgres. These tests exercise
// database compare-and-set conditions whenever DATABASE_URL is available.
const describeIntegration = process.env["DATABASE_URL"] ? describe : describe.skip;

describeIntegration("legacy approval safety", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    process.env["SESSION_SECRET"] = "test-session-secret";
    await setupTestDatabase();
    fixtures = await createTestFixtures();
  }, 60_000);

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function createTimedRequest(key: string): Promise<string> {
    const response = await apiFetch("/requests", {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body: {
        workspace_id: fixtures.workspaceA,
        key,
        title: "Concurrent decision safety check",
        timeout_at: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  it("lets only one terminal writer win when a reviewer races a timeout job", async () => {
    const requestId = await createTimedRequest(`timeout-race.${Date.now()}`);

    const [, resolveResponse] = await Promise.all([
      processTimeout({ data: { requestId } } as never),
      apiFetch(`/requests/${requestId}/actions/approve`, {
        method: "POST",
        sessionCookie: fixtures.sessionCookieA,
        body: { note: "Reviewer decision" },
      }),
    ]);

    // The worker or reviewer may legitimately win, but the loser must receive
    // a conflict rather than overwrite the existing terminal decision.
    expect([200, 409]).toContain(resolveResponse.status);

    const db = getTestDb();
    const [request] = await db
      .select()
      .from(requests)
      .where(eq(requests.id, requestId))
      .limit(1);
    expect(["approved", "declined"]).toContain(request?.status);

    const events = await db
      .select()
      .from(requestEvents)
      .where(eq(requestEvents.requestId, requestId));
    const terminalEvents = events.filter(
      (event) => event.type === "request.resolved" || event.type === "request.timed_out",
    );

    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.type).toBe(
      request?.status === "approved" ? "request.resolved" : "request.timed_out",
    );
  });

  it("treats duplicate timeout jobs as one compare-and-set transition", async () => {
    const requestId = await createTimedRequest(`timeout-duplicate.${Date.now()}`);

    await Promise.all([
      processTimeout({ data: { requestId } } as never),
      processTimeout({ data: { requestId } } as never),
    ]);

    const db = getTestDb();
    const [request] = await db
      .select()
      .from(requests)
      .where(eq(requests.id, requestId))
      .limit(1);
    expect(request).toMatchObject({ status: "declined", resolutionAction: "decline" });

    const events = await db
      .select()
      .from(requestEvents)
      .where(eq(requestEvents.requestId, requestId));
    expect(events.filter((event) => event.type === "request.timed_out")).toHaveLength(1);
  });

  it("rejects cross-workspace escalation policies at creation and worker execution", async () => {
    const policyResponse = await apiFetch(`/workspaces/${fixtures.workspaceB}/policies`, {
      method: "POST",
      sessionCookie: fixtures.sessionCookieB,
      body: {
        name: "Workspace B escalation",
        steps: [{ delay_ms: 0, notify: {}, message: "Escalate only in workspace B" }],
      },
    });
    expect(policyResponse.status).toBe(201);
    const policy = (await policyResponse.json()) as { id: string };

    const rejectedCreate = await apiFetch("/requests", {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body: {
        workspace_id: fixtures.workspaceA,
        key: `cross-policy-create.${Date.now()}`,
        title: "Cross workspace policy should be rejected",
        escalation_policy_id: policy.id,
      },
    });
    expect(rejectedCreate.status).toBe(400);
    expect(await rejectedCreate.json()).toMatchObject({
      error: { code: "validation_error" },
    });

    const createResponse = await apiFetch("/requests", {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body: {
        workspace_id: fixtures.workspaceA,
        key: `cross-policy-worker.${Date.now()}`,
        title: "Corrupt cross workspace policy should be ignored",
      },
    });
    expect(createResponse.status).toBe(201);
    const request = (await createResponse.json()) as { id: string };

    // Simulate a legacy/corrupt row that bypassed the API's creation check.
    // The worker must still scope the policy to the request workspace.
    const db = getTestDb();
    await db
      .update(requests)
      .set({ escalationPolicyId: policy.id, updatedAt: new Date() })
      .where(eq(requests.id, request.id));

    await processEscalation({ data: { requestId: request.id, stepIndex: 0 } } as never);

    const [after] = await db
      .select()
      .from(requests)
      .where(eq(requests.id, request.id))
      .limit(1);
    expect(after?.status).toBe("pending");

    const events = await db
      .select()
      .from(requestEvents)
      .where(eq(requestEvents.requestId, request.id));
    expect(events.some((event) => event.type === "request.escalated")).toBe(false);

    const [storedPolicy] = await db
      .select()
      .from(escalationPolicies)
      .where(eq(escalationPolicies.id, policy.id))
      .limit(1);
    expect(storedPolicy?.workspaceId).toBe(fixtures.workspaceB);
  });

  it("allows only owners or admins to create notification channels", async () => {
    const db = getTestDb();
    await db.insert(memberships).values({
      id: generateId("mbr"),
      workspaceId: fixtures.workspaceA,
      userId: fixtures.userB,
      role: "reviewer",
      createdAt: new Date(),
    });

    const reviewerResponse = await apiFetch(`/workspaces/${fixtures.workspaceA}/channels`, {
      method: "POST",
      sessionCookie: fixtures.sessionCookieB,
      body: {
        type: "slack",
        name: "Reviewer must not configure notifications",
        config: { webhook_url: "https://hooks.slack.com/services/T000/B000/reviewer" },
      },
    });
    expect(reviewerResponse.status).toBe(403);
    expect(await reviewerResponse.json()).toMatchObject({ error: { code: "forbidden" } });

    const ownerResponse = await apiFetch(`/workspaces/${fixtures.workspaceA}/channels`, {
      method: "POST",
      sessionCookie: fixtures.sessionCookieA,
      body: {
        type: "slack",
        name: "Owner can configure notifications",
        config: { webhook_url: "https://hooks.slack.com/services/T000/B000/owner" },
      },
    });
    expect(ownerResponse.status).toBe(201);
  });
});
