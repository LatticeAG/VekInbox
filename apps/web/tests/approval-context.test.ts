import { describe, expect, it } from "vitest";
import { createApprovalReviewContext } from "../src/lib/approval-context";

const baseSource = {
  title: "Deploy the payment service",
  requestId: "req_123",
  requestKey: "deploy.payment.42",
  priority: "high",
  status: "pending",
  timeoutAt: "2026-07-22T12:00:00.000Z",
};

describe("createApprovalReviewContext", () => {
  it("normalizes rich approval metadata into a reviewer-safe context", () => {
    const context = createApprovalReviewContext({
      ...baseSource,
      metadata: {
        action: {
          summary: "Deploy payment-service image sha256:abc to production.",
          digest: "sha256:action-123",
          structured_fields: {
            environment: "production",
            artifact: "payment-service@sha256:abc",
            api_token: "not-for-review",
          },
          risk_explanation: "This changes the live payment path.",
        },
        context_manifest_digest: "sha256:context-456",
        approval: {
          policy: {
            name: "Production release",
            version: "7",
            stage: { name: "Change manager" },
            quorum: 2,
            required_participants: ["alice", "bob", "carol"],
          },
          escalation: {
            state: "Waiting for manager",
            current_step: "Manager fallback",
            next_at: "2026-07-22T11:45:00.000Z",
          },
        },
        preconditions: ["CI checks are green", "Rollback image is available"],
        required_evidence: ["diff-plan"],
        evidence: [
          {
            id: "diff-plan",
            type: "diff",
            title: "Deployment plan",
            content: "- replicas: 3\n+ replicas: 5",
            digest: "sha256:diff-789",
            classification: "internal",
          },
          {
            id: "ticket",
            type: "external_link",
            title: "Change ticket",
            url: "https://tracker.example.test/CHG-42",
          },
        ],
      },
    });

    expect(context.actionSummary).toContain("payment-service");
    expect(context.actionDigest).toBe("sha256:action-123");
    expect(context.contextManifestDigest).toBe("sha256:context-456");
    expect(context.actionFields).toEqual([
      { label: "Environment", value: "production" },
      { label: "Artifact", value: "payment-service@sha256:abc" },
      { label: "Api token", value: "[Redacted in legacy preview]" },
    ]);
    expect(context.policy).toMatchObject({
      name: "Production release",
      version: "7",
      stage: "Change manager",
      requirement: "2 of 3 reviewers",
    });
    expect(context.escalation).toMatchObject({
      state: "Waiting for manager",
      step: "Manager fallback",
      nextAt: "2026-07-22T11:45:00.000Z",
    });
    expect(context.preconditions).toHaveLength(2);
    expect(context.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "diff-plan",
          type: "diff",
          acknowledgementRequired: true,
        }),
        expect.objectContaining({
          id: "ticket",
          type: "link",
          href: "https://tracker.example.test/CHG-42",
        }),
      ]),
    );
  });

  it("keeps legacy requests honest when no v3 snapshot metadata is supplied", () => {
    const context = createApprovalReviewContext({
      ...baseSource,
      escalationPolicyId: "pol_legacy",
      metadata: { invoice_id: 1024 },
    });

    expect(context.actionSummary).toBe("Deploy the payment service");
    expect(context.actionDigest).toBeNull();
    expect(context.contextManifestDigest).toBeNull();
    expect(context.evidence).toEqual([]);
    expect(context.policy.name).toBe("pol_legacy");
  });

  it("only turns safe HTTPS links into clickable review links", () => {
    const context = createApprovalReviewContext({
      ...baseSource,
      metadata: {
        links: [
          { id: "safe", title: "Runbook", url: "https://example.test/runbook" },
          { id: "http", title: "Insecure", url: "http://example.test/runbook" },
          {
            id: "credentialed",
            title: "Credentialed",
            url: "https://reviewer:secret@example.test/runbook",
          },
          { id: "unsafe", title: "Bad link", url: "javascript:alert(1)" },
        ],
      },
    });

    expect(context.evidence).toEqual([
      expect.objectContaining({ id: "safe", href: "https://example.test/runbook" }),
    ]);
  });
});
