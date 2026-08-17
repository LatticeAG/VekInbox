import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  approvalCases,
  decisions,
} from "@latticeag/vekinbox-db";
import {
  createContextItem,
  sealContextManifest,
} from "@latticeag/vekinbox-core";
import {
  apiFetch,
  createTestFixtures,
  getTestDb,
  setupTestDatabase,
  teardownTestDatabase,
  type TestFixtures,
} from "./helpers.js";

// Source-only checkouts do not require a local Postgres service. The V3 data
// plane is intentionally tested against its durable tables when one is present.
const describeIntegration = process.env["DATABASE_URL"] ? describe : describe.skip;

interface ApprovalCaseResponse {
  id: string;
  thread_id: string;
  version: number;
  lifecycle: string;
  outcome: string | null;
  risk_class: string;
  action_digest: string;
  context_manifest_digest: string;
  template_version_id: string;
  policy_version_id: string;
  stages: unknown[];
}

function unique(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
}

function configurationCaseBody(externalKey: string) {
  const manifest = sealContextManifest([
    createContextItem({
      id: `${externalKey}.diff`,
      type: "diff",
      content: "- feature_enabled: false\n+ feature_enabled: true\n",
      classification: "internal",
      redaction: "none",
      provenance: { source: "integration-test" },
      media_type: "text/x-diff",
      line_count: 2,
      summary: "Enable the bounded payments feature flag.",
    }),
    createContextItem({
      id: `${externalKey}.fields`,
      type: "structured_fields",
      content: {
        change_ticket: "CHG-test",
        rollback: "Set feature_enabled to false",
      },
      classification: "internal",
      redaction: "none",
      provenance: { source: "integration-test" },
      summary: "Bounded configuration and rollback information.",
    }),
  ]);

  return {
    template: { id: "tmpl_configuration_change", version: 1 },
    external_key: externalKey,
    title: "Enable a bounded payments configuration flag",
    action: {
      operation: "configuration.change",
      resource: {
        kind: "service",
        id: "payments-api",
        environment: "production",
      },
      arguments: {
        before: { feature_enabled: false },
        after: { feature_enabled: true },
      },
    },
    context_manifest: manifest,
  };
}

function expectApprovalCaseResponse(value: unknown): ApprovalCaseResponse {
  expect(value).toMatchObject({
    id: expect.any(String),
    thread_id: expect.any(String),
    version: expect.any(Number),
    lifecycle: "open",
    risk_class: "R2",
    action_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    context_manifest_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    template_version_id: expect.any(String),
    policy_version_id: expect.any(String),
  });
  expect(Array.isArray((value as { stages?: unknown }).stages)).toBe(true);
  return value as ApprovalCaseResponse;
}

describeIntegration("V3 approval cases integration", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    process.env["SESSION_SECRET"] = "test-session-secret";
    await setupTestDatabase();
    fixtures = await createTestFixtures();
  }, 60_000);

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it("creates a pinned configuration case and replays an exact transport command", async () => {
    const externalKey = unique("configuration-case");
    const idempotencyKey = unique("v3-create");
    const body = configurationCaseBody(externalKey);
    const path = `/v2/projects/${fixtures.workspaceA}/approval-cases`;

    const createdResponse = await apiFetch(path, {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
    expect(createdResponse.status).toBe(201);
    const created = expectApprovalCaseResponse(await createdResponse.json());

    const replayResponse = await apiFetch(path, {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
    expect(replayResponse.status).toBe(200);
    const replay = expectApprovalCaseResponse(await replayResponse.json());

    expect(replay).toMatchObject({
      id: created.id,
      thread_id: created.thread_id,
      version: created.version,
      action_digest: created.action_digest,
      context_manifest_digest: created.context_manifest_digest,
      template_version_id: created.template_version_id,
      policy_version_id: created.policy_version_id,
    });

    const rows = await getTestDb()
      .select()
      .from(approvalCases)
      .where(eq(approvalCases.id, created.id));
    expect(rows).toHaveLength(1);
  });

  it("does not disclose or create a case in another project", async () => {
    const body = configurationCaseBody(unique("cross-workspace"));
    const response = await apiFetch(`/v2/projects/${fixtures.workspaceB}/approval-cases`, {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      headers: { "Idempotency-Key": unique("v3-cross-workspace") },
      body,
    });

    // Project authorization is intentionally indistinguishable from absence
    // to an agent principal outside that project.
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("rejects a stale decision version before it records a human decision", async () => {
    const externalKey = unique("stale-version");
    const createResponse = await apiFetch(`/v2/projects/${fixtures.workspaceA}/approval-cases`, {
      method: "POST",
      apiKey: fixtures.apiKeyA,
      headers: { "Idempotency-Key": unique("v3-stale-create") },
      body: configurationCaseBody(externalKey),
    });
    expect(createResponse.status).toBe(201);
    const created = expectApprovalCaseResponse(await createResponse.json());

    const before = await getTestDb()
      .select()
      .from(decisions)
      .where(eq(decisions.caseId, created.id));
    expect(before).toHaveLength(0);

    const staleResponse = await apiFetch(`/v2/approval-cases/${created.id}/decisions`, {
      method: "POST",
      sessionCookie: fixtures.sessionCookieA,
      headers: {
        "If-Match": `"case-version:${created.version + 1}"`,
        "Idempotency-Key": unique("v3-stale-decision"),
      },
      body: {
        stage_id: "resource-owner",
        response: "approve",
        reason: "This must fail before an approval is accepted.",
      },
    });

    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toMatchObject({ error: { code: "conflict" } });

    const after = await getTestDb()
      .select()
      .from(decisions)
      .where(eq(decisions.caseId, created.id));
    expect(after).toHaveLength(0);
  });
});
