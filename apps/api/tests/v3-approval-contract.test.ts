import { describe, expect, it } from "vitest";
import {
  parseCaseVersion,
  requireV3IdempotencyKey,
  v3CreateApprovalCaseSchema,
} from "../src/lib/v3-approval-contract.js";

const digest = "a".repeat(64);

describe("V3 approval API contract", () => {
  it("requires the unambiguous optimistic-concurrency header", () => {
    expect(parseCaseVersion('"case-version:17"')).toBe(17);
    expect(() => parseCaseVersion("17")).toThrow("If-Match");
    expect(() => parseCaseVersion('"case-version:0"')).toThrow("If-Match");
    expect(() => requireV3IdempotencyKey(undefined)).toThrow("Idempotency-Key");
  });

  it("accepts only a sealed, typed action/context case create shape", () => {
    const parsed = v3CreateApprovalCaseSchema.parse({
      template: { id: "tmpl_configuration_change", version: 1 },
      external_key: "config:payments:42",
      action: {
        operation: "configuration.change",
        resource: { kind: "service", id: "payments", environment: "production" },
        arguments: { before: { feature: false }, after: { feature: true } },
      },
      context_manifest: {
        version: 1,
        effective_classification: "internal",
        context_manifest_digest: digest,
        items: [
          {
            id: "ctx_diff",
            type: "diff",
            content_digest: digest,
            classification: "internal",
            redaction: "none",
            provenance: { source: "agent" },
          },
        ],
      },
    });
    expect(parsed.template.id).toBe("tmpl_configuration_change");

    expect(() =>
      v3CreateApprovalCaseSchema.parse({
        ...parsed,
        actor_id: "user-supplied-reviewer",
      }),
    ).toThrow();
  });
});
