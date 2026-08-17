import { describe, expect, it } from "vitest";
import {
  createContextItem,
  disclosureForSurface,
  sealContextManifest,
  verifyContextManifest,
} from "./index.js";

describe("sealed approval context", () => {
  it("binds content-addressed items into a deterministic manifest", () => {
    const diff = createContextItem({
      id: "ctx_diff",
      type: "diff",
      content: "- replicas: 2\n+ replicas: 3",
      classification: "internal",
      provenance: { source: "ci", verifier: "diff-scanner" },
      line_count: 2,
      summary: "Production replica change",
    });
    const artifact = createContextItem({
      id: "ctx_artifact",
      type: "artifact",
      content: { image: "payments@sha256:abc" },
      classification: "confidential",
      provenance: { source: "build" },
      summary: "Signed production artifact",
    });

    const first = sealContextManifest([artifact, diff]);
    const second = sealContextManifest([diff, artifact]);

    expect(first.context_manifest_digest).toBe(second.context_manifest_digest);
    expect(first.items.map((item) => item.id)).toEqual(["ctx_artifact", "ctx_diff"]);
    expect(first.effective_classification).toBe("confidential");
    expect(verifyContextManifest(first)).toBe(true);
  });

  it("does not disclose confidential evidence on external notification surfaces", () => {
    const publicItem = createContextItem({
      id: "ctx_public",
      type: "structured_fields",
      content: { environment: "production" },
      classification: "public",
      provenance: { source: "agent" },
      summary: "Production action",
    });
    const internalItem = createContextItem({
      id: "ctx_internal",
      type: "diff",
      content: "safe redacted diff",
      classification: "internal",
      redaction: "full",
      provenance: { source: "ci" },
      summary: "Should not leave the inbox",
    });
    const restrictedItem = createContextItem({
      id: "ctx_restricted",
      type: "log_bundle",
      content: "regulated payload",
      classification: "restricted",
      provenance: { source: "dlp" },
      summary: "Restricted log bundle",
    });
    const manifest = sealContextManifest([publicItem, internalItem, restrictedItem]);

    expect(disclosureForSurface(manifest, "web").map((item) => item.id)).toEqual([
      "ctx_internal",
      "ctx_public",
      "ctx_restricted",
    ]);
    expect(disclosureForSurface(manifest, "email").map((item) => item.id)).toEqual([
      "ctx_public",
    ]);
    expect(disclosureForSurface(manifest, "sms")).toEqual([]);
  });

  it("rejects tampered manifests and claimed digest mismatches", () => {
    const item = createContextItem({
      id: "ctx_ticket",
      type: "external_link",
      content: "CHG-42",
      classification: "internal",
      provenance: { source: "change-system" },
      external_url: "https://changes.example.test/CHG-42",
    });
    const manifest = sealContextManifest([item]);
    const tampered = {
      ...manifest,
      items: [{ ...manifest.items[0]!, summary: "rewritten after review" }],
    };

    expect(verifyContextManifest(tampered)).toBe(false);
    expect(() =>
      createContextItem({
        id: "ctx_bad",
        type: "diff",
        content: "trusted contents",
        content_digest: "a".repeat(64),
        provenance: { source: "ci" },
      }),
    ).toThrow("does not match");
  });

  it("re-validates hand-built items before sealing them", () => {
    const malformed = {
      id: "ctx_bad_link",
      type: "external_link" as const,
      content_digest: "a".repeat(64),
      classification: "internal" as const,
      redaction: "not-a-valid-redaction" as never,
      provenance: { source: "" },
      external_url: "javascript:alert(1)",
    };

    expect(() => sealContextManifest([malformed])).toThrow();
    expect(
      verifyContextManifest({
        version: 1,
        items: [malformed],
        effective_classification: "internal",
        context_manifest_digest: "b".repeat(64),
      }),
    ).toBe(false);
  });
});
