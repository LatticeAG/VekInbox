import { describe, expect, it } from "vitest";
import {
  appendAuditEntry,
  appendDecisionAuditEntry,
  cloneAuditLedger,
  createAuditCheckpoint,
  createAuditLedger,
  verifyAuditCheckpoint,
  verifyAuditLedger,
} from "./index.js";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

describe("immutable audit ledger", () => {
  it("hashes payloads, chains decisions, and produces a verifiable checkpoint", () => {
    const first = appendAuditEntry(createAuditLedger({ tenant_id: "tenant_1", partition: "case_1" }), {
      id: "evt_1",
      event_type: "case.opened",
      actor: { type: "system", id: "scheduler" },
      occurred_at: "2030-01-01T00:00:00.000Z",
      payload: { command: "secret raw command", request: "req_1" },
      evidence_digests: [digest("a"), digest("a"), digest("b")],
    });
    const second = appendDecisionAuditEntry(first.ledger, {
      id: "evt_2",
      decision_id: "decision_1",
      actor: { type: "human", id: "reviewer_1", assurance: "step_up" },
      occurred_at: "2030-01-01T00:01:00.000Z",
      payload: { answer: "approve" },
      action_digest: digest("c"),
      context_manifest_digest: digest("d"),
      policy_hash: digest("e"),
    });

    expect(second.entry).not.toHaveProperty("payload");
    expect(first.entry.evidence_digests).toEqual(["a".repeat(64), "b".repeat(64)]);
    expect(second.entry.previous_entry_hash).toBe(first.entry.entry_hash);
    expect(verifyAuditLedger(second.ledger)).toMatchObject({ valid: true, last_sequence: 2 });

    const checkpoint = createAuditCheckpoint(second.ledger, {
      created_at: "2030-01-01T00:02:00.000Z",
      key_id: "audit-key-1",
    });
    expect(verifyAuditCheckpoint(second.ledger, checkpoint)).toBe(true);
  });

  it("rejects stale writers and exposes any attempted history rewrite", () => {
    const ledger = createAuditLedger({ tenant_id: "tenant_1", partition: "case_1" });
    const appended = appendAuditEntry(ledger, {
      id: "evt_1",
      event_type: "case.opened",
      actor: { type: "system" },
      occurred_at: "2030-01-01T00:00:00.000Z",
    });
    expect(() =>
      appendAuditEntry(appended.ledger, {
        id: "evt_2",
        event_type: "case.updated",
        actor: { type: "system" },
        expected_sequence: 0,
      }),
    ).toThrow("sequence conflict");

    const tampered = cloneAuditLedger(appended.ledger);
    tampered.entries[0]!.entry_hash = "0".repeat(64);
    expect(verifyAuditLedger(tampered)).toMatchObject({
      valid: false,
      reason: "entry_hash_mismatch",
    });
  });
});
