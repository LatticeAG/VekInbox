import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { requests } from "@latticeag/vekinbox-db";
import {
  apiFetch,
  createTestFixtures,
  getTestDb,
  setupTestDatabase,
  teardownTestDatabase,
  type TestFixtures,
} from "./helpers.js";

// A clean source checkout can run the unit suite without a local Postgres
// service. CI and developers with DATABASE_URL still exercise these tests.
const describeIntegration = process.env["DATABASE_URL"] ? describe : describe.skip;

describeIntegration("requests integration", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    process.env["SESSION_SECRET"] = "test-session-secret";
    await setupTestDatabase();
    fixtures = await createTestFixtures();
  }, 60_000);

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it("create request is idempotent by key", async () => {
    const key = `idem.${Date.now()}`;
    const body = {
      workspace_id: fixtures.workspaceA,
      key,
      title: "Idempotent request",
    };

    const first = await apiFetch("/requests", {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body,
    });
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { id: string; key: string };

    const second = await apiFetch("/requests", {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body,
    });
    expect(second.status).toBe(201);
    const secondJson = (await second.json()) as { id: string; key: string };

    expect(secondJson.id).toBe(firstJson.id);
    expect(secondJson.key).toBe(key);
  });

  it("agent cannot resolve (401 without session)", async () => {
    const key = `no-resolve.${Date.now()}`;
    const createRes = await apiFetch("/requests", {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body: {
        workspace_id: fixtures.workspaceA,
        key,
        title: "Agent resolve test",
      },
    });
    const created = (await createRes.json()) as { id: string };

    const resolveRes = await apiFetch(`/requests/${created.id}/actions/approve`, {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body: { note: "should fail" },
    });

    expect(resolveRes.status).toBe(401);
  });

  it("session can resolve", async () => {
    const key = `resolve.${Date.now()}`;
    const createRes = await apiFetch("/requests", {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body: {
        workspace_id: fixtures.workspaceA,
        key,
        title: "Session resolve test",
      },
    });
    const created = (await createRes.json()) as { id: string };

    const resolveRes = await apiFetch(`/requests/${created.id}/actions/approve`, {
      method: "POST",
      sessionCookie: fixtures.sessionCookieA,
      body: { note: "Approved via session" },
    });

    expect(resolveRes.status).toBe(200);
    const resolved = (await resolveRes.json()) as { status: string };
    expect(resolved.status).toBe("approved");
  });

  it("rejects a custom action without a legacy outcome mapping", async () => {
    const key = `custom-action.${Date.now()}`;
    const createRes = await apiFetch("/requests", {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body: {
        workspace_id: fixtures.workspaceA,
        key,
        title: "Custom action safety test",
        actions: ["run_custom_operation"],
      },
    });
    const created = (await createRes.json()) as { id: string };

    const resolveRes = await apiFetch(`/requests/${created.id}/actions/run_custom_operation`, {
      method: "POST",
      sessionCookie: fixtures.sessionCookieA,
      body: {},
    });

    expect(resolveRes.status).toBe(400);
    expect(await resolveRes.json()).toMatchObject({
      error: { code: "invalid_action" },
    });
  });

  it("keeps an escalated request resolvable by an authenticated reviewer", async () => {
    const key = `escalated.${Date.now()}`;
    const createRes = await apiFetch("/requests", {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body: {
        workspace_id: fixtures.workspaceA,
        key,
        title: "Escalated request remains actionable",
      },
    });
    const created = (await createRes.json()) as { id: string };

    await getTestDb()
      .update(requests)
      .set({ status: "escalated", updatedAt: new Date() })
      .where(eq(requests.id, created.id));

    const resolveRes = await apiFetch(`/requests/${created.id}/actions/decline`, {
      method: "POST",
      sessionCookie: fixtures.sessionCookieA,
      body: { note: "Handled after escalation" },
    });

    expect(resolveRes.status).toBe(200);
    expect(await resolveRes.json()).toMatchObject({ status: "declined" });
  });

  it("enforces tenant isolation", async () => {
    const key = `tenant.${Date.now()}`;
    const createRes = await apiFetch("/requests", {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body: {
        workspace_id: fixtures.workspaceA,
        key,
        title: "Tenant isolation test",
      },
    });
    const created = (await createRes.json()) as { id: string };

    const crossTenant = await apiFetch(`/requests/${created.id}`, {
      sessionCookie: fixtures.sessionCookieB,
    });

    expect(crossTenant.status).toBe(403);
  });

  it("cancel pending works", async () => {
    const key = `cancel.${Date.now()}`;
    const createRes = await apiFetch("/requests", {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body: {
        workspace_id: fixtures.workspaceA,
        key,
        title: "Cancel test",
      },
    });
    const created = (await createRes.json()) as { id: string };

    const cancelRes = await apiFetch(`/requests/${created.id}/cancel`, {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      body: { reason: "no longer needed" },
    });

    expect(cancelRes.status).toBe(200);
    const cancelled = (await cancelRes.json()) as { status: string };
    expect(cancelled.status).toBe("cancelled");
  });
});
