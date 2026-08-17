import { describe, expect, it } from "vitest";
import {
  bindApprovalTemplate,
  createContextItem,
  getBuiltinApprovalTemplate,
  listBuiltinApprovalTemplates,
} from "./index.js";

function deploymentContext() {
  return [
    createContextItem({
      id: "ctx_diff",
      type: "diff",
      content: "- image: old\n+ image: new",
      provenance: { source: "git" },
    }),
    createContextItem({
      id: "ctx_artifact",
      type: "artifact",
      content: { image: "payments:2026.07.21" },
      provenance: { source: "build" },
    }),
    createContextItem({
      id: "ctx_change",
      type: "external_link",
      content: "CHG-42",
      external_url: "https://changes.example.test/CHG-42",
      provenance: { source: "change-management" },
    }),
    createContextItem({
      id: "ctx_fields",
      type: "structured_fields",
      content: { environment: "production", service: "payments" },
      provenance: { source: "deployment-controller" },
    }),
  ];
}

const deploymentAction = {
  operation: "deployment.release",
  resource: { kind: "service", id: "payments", environment: "production" },
  arguments: {
    artifact_digest: `sha256:${"c".repeat(64)}`,
    strategy: "canary",
    max_unavailable: 1,
  },
  downstream_idempotency_key: "deploy-payments-42",
};

describe("published approval templates", () => {
  it("ships templates for the common consequential actions", () => {
    expect(listBuiltinApprovalTemplates().map((template) => template.id)).toEqual([
      "tmpl_production_deployment",
      "tmpl_configuration_change",
      "tmpl_monetary_action",
      "tmpl_data_export",
      "tmpl_privileged_access",
    ]);
  });

  it("pins a canonical action, policy, and sealed context to a production deployment", () => {
    const template = getBuiltinApprovalTemplate("tmpl_production_deployment");
    const bound = bindApprovalTemplate(template, {
      action: deploymentAction,
      context: deploymentContext(),
    });

    expect(bound.template_id).toBe(template.id);
    expect(bound.policy.policy_hash).toBe(template.policy.policy_hash);
    expect(bound.canonical_action.canonicalization).toBe("vekinbox-action/v1");
    expect(bound.action_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(bound.context_manifest_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(bound.context_manifest.items).toHaveLength(4);
  });

  it("rejects unbound operations, missing immutable fields, and incomplete context", () => {
    const template = getBuiltinApprovalTemplate("tmpl_production_deployment");
    expect(() =>
      bindApprovalTemplate(template, {
        action: { ...deploymentAction, operation: "deployment.delete" },
        context: deploymentContext(),
      }),
    ).toThrow("not allowed");

    expect(() =>
      bindApprovalTemplate(template, {
        action: { ...deploymentAction, downstream_idempotency_key: "" },
        context: deploymentContext(),
      }),
    ).toThrow("downstream_idempotency_key");

    expect(() =>
      bindApprovalTemplate(template, {
        action: deploymentAction,
        context: deploymentContext().filter((item) => item.type !== "artifact"),
      }),
    ).toThrow("artifact");
  });
});
