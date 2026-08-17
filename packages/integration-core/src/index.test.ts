import { describe, expect, it } from "vitest";
import {
  type ApprovalGateway,
  type AwaitApprovalCaseInput,
  type ConsumeExecutionReleaseInput,
  type CreateApprovalCaseInput,
  type ExecutionReceiptInput,
  type FrameworkApprovalRecord,
  type VerifiedExecutionRelease,
  ActionDigestMismatchError,
  ApprovalSafetyError,
  canonicalize,
  createFrameworkApproval,
  executeApprovedAction,
} from "./index.js";

class FakeGateway implements ApprovalGateway {
  createInput?: CreateApprovalCaseInput;
  resolution: "approved" | "declined" | "revision_requested" | "expired" | "cancelled" = "approved";
  release?: VerifiedExecutionRelease;
  consumeCalls = 0;
  receipts: ExecutionReceiptInput[] = [];

  async createOrGetCase(input: CreateApprovalCaseInput) {
    this.createInput = input;
    return {
      id: "case_01",
      threadId: "thread_01",
      revisionNumber: 1,
      lifecycle: "open" as const,
      actionDigest: input.actionDigest,
    };
  }

  async awaitCase(input: AwaitApprovalCaseInput) {
    if (!this.createInput) throw new Error("case was not created");
    return {
      caseId: input.caseId,
      lifecycle: this.resolution === "approved" ? ("resolved" as const) : ("resolved" as const),
      outcome: this.resolution,
      actionDigest: this.createInput.actionDigest,
      reason: this.resolution === "declined" ? "reviewer_declined" : undefined,
    };
  }

  async consumeVerifiedRelease(input: ConsumeExecutionReleaseInput) {
    this.consumeCalls += 1;
    return (
      this.release ?? {
        id: "rel_01",
        nonce: "nonce_01",
        caseId: input.caseId,
        actionDigest: input.actionDigest,
        expiresAt: "2030-01-01T00:00:00.000Z",
        verification: "verified" as const,
      }
    );
  }

  async recordExecutionReceipt(input: ExecutionReceiptInput) {
    this.receipts.push(input);
  }
}

async function createRecord(gateway: FakeGateway): Promise<FrameworkApprovalRecord> {
  return createFrameworkApproval(gateway, {
    framework: "test-framework",
    frameworkVersion: "1.0.0",
    runId: "run-01",
    checkpointRef: "checkpoint-01",
    toolCallId: "call-01",
    toolName: "deploy",
    toolSchemaVersion: "1",
    arguments: { environment: "production", revision: 7 },
    templateId: "tmpl_deploy",
  });
}

describe("canonical action binding", () => {
  it("sorts object keys and rejects non-canonical inputs", () => {
    expect(canonicalize({ b: 2, a: { z: true, x: null } })).toBe('{"a":{"x":null,"z":true},"b":2}');
    expect(() => canonicalize({ missing: undefined })).toThrow(ApprovalSafetyError);
    expect(() => canonicalize({ invalid: Number.NaN })).toThrow(ApprovalSafetyError);
  });

  it("uses a stable framework thread key but a digest-bound external key", async () => {
    const first = new FakeGateway();
    const second = new FakeGateway();
    await createRecord(first);
    await createFrameworkApproval(second, {
      framework: "test-framework",
      runId: "run-01",
      checkpointRef: "checkpoint-01",
      toolCallId: "call-01",
      toolName: "deploy",
      arguments: { environment: "staging", revision: 7 },
      templateId: "tmpl_deploy",
    });

    expect(first.createInput?.threadKey).toBe(second.createInput?.threadKey);
    expect(first.createInput?.externalKey).not.toBe(second.createInput?.externalKey);
  });
});

describe("verified release execution", () => {
  it("executes only after an approved case returns a verified matching release", async () => {
    const gateway = new FakeGateway();
    const record = await createRecord(gateway);
    let executed = false;

    const result = await executeApprovedAction({
      gateway,
      record,
      currentArguments: { environment: "production", revision: 7 },
      execute: async (args, release) => {
        executed = true;
        expect(args.environment).toBe("production");
        expect(release.verification).toBe("verified");
        return "deployed";
      },
    });

    expect(result).toMatchObject({ kind: "executed", result: "deployed" });
    expect(executed).toBe(true);
    expect(gateway.consumeCalls).toBe(1);
    expect(gateway.receipts).toMatchObject([{ outcome: "executed", actionDigest: record.actionDigest }]);
  });

  it("never calls the tool or consumes a release after a decline", async () => {
    const gateway = new FakeGateway();
    gateway.resolution = "declined";
    const record = await createRecord(gateway);
    let executed = false;

    const result = await executeApprovedAction({
      gateway,
      record,
      currentArguments: { environment: "production", revision: 7 },
      execute: async () => {
        executed = true;
        return "should not run";
      },
    });

    expect(result).toMatchObject({ kind: "blocked", outcome: "declined" });
    expect(executed).toBe(false);
    expect(gateway.consumeCalls).toBe(0);
  });

  it("rejects changed tool arguments before it consumes a release", async () => {
    const gateway = new FakeGateway();
    const record = await createRecord(gateway);

    await expect(
      executeApprovedAction({
        gateway,
        record,
        currentArguments: { environment: "production", revision: 8 },
        execute: async () => "should not run",
      }),
    ).rejects.toBeInstanceOf(ActionDigestMismatchError);
    expect(gateway.consumeCalls).toBe(0);
  });

  it("fails closed for an expired release", async () => {
    const gateway = new FakeGateway();
    const record = await createRecord(gateway);
    gateway.release = {
      id: "rel_old",
      nonce: "nonce_old",
      caseId: record.caseId,
      actionDigest: record.actionDigest,
      expiresAt: "2020-01-01T00:00:00.000Z",
      verification: "verified",
    };

    await expect(
      executeApprovedAction({
        gateway,
        record,
        currentArguments: { environment: "production", revision: 7 },
        execute: async () => "should not run",
      }),
    ).rejects.toBeInstanceOf(ApprovalSafetyError);
  });
});
