import { describe, expect, it } from "vitest";
import {
  type ApprovalGateway,
  type AwaitApprovalCaseInput,
  type ConsumeExecutionReleaseInput,
  type CreateApprovalCaseInput,
  type VerifiedExecutionRelease,
  ActionDigestMismatchError,
  createLangChainApprovalAdapter,
} from "./index.js";

class Gateway implements ApprovalGateway {
  input?: CreateApprovalCaseInput;
  outcome: "approved" | "declined" | "revision_requested" | "expired" | "cancelled" = "approved";
  consumeCalls = 0;

  async createOrGetCase(input: CreateApprovalCaseInput) {
    this.input = input;
    return {
      id: "case_langchain",
      threadId: "thread_langchain",
      revisionNumber: 1,
      lifecycle: "open" as const,
      actionDigest: input.actionDigest,
    };
  }

  async awaitCase(input: AwaitApprovalCaseInput) {
    if (!this.input) throw new Error("missing case input");
    return {
      caseId: input.caseId,
      lifecycle: "resolved" as const,
      outcome: this.outcome,
      actionDigest: this.input.actionDigest,
    };
  }

  async consumeVerifiedRelease(input: ConsumeExecutionReleaseInput): Promise<VerifiedExecutionRelease> {
    this.consumeCalls += 1;
    return {
      id: "rel_langchain",
      nonce: "nonce_langchain",
      caseId: input.caseId,
      actionDigest: input.actionDigest,
      expiresAt: "2030-01-01T00:00:00.000Z",
      verification: "verified",
    };
  }
}

function call() {
  return {
    runId: "graph-run-1",
    checkpointRef: "postgres://checkpoints/1",
    toolCallId: "call-1",
    toolName: "deploy",
    arguments: { environment: "production", revision: 3 },
    durableCheckpoint: true as const,
  };
}

describe("LangChain/LangGraph approval bridge", () => {
  it("returns serialisable pending state tied to the durable graph checkpoint", async () => {
    const gateway = new Gateway();
    const adapter = createLangChainApprovalAdapter({ gateway, templateId: "tmpl_deploy" });

    const pending = await adapter.interruptToolCall(call());

    expect(pending.kind).toBe("approval_pending");
    expect(pending.approval.framework).toBe("langchain");
    expect(pending.approval.frameworkCheckpointRef).toBe("postgres://checkpoints/1");
    expect(gateway.input?.frameworkArgumentsDigest).toBe(pending.approval.frameworkArgumentsDigest);
  });

  it("turns a decline into explicit graph feedback without executing the tool", async () => {
    const gateway = new Gateway();
    gateway.outcome = "declined";
    const adapter = createLangChainApprovalAdapter({ gateway, templateId: "tmpl_deploy" });
    const pending = await adapter.interruptToolCall(call());
    let executed = false;

    const result = await adapter.resumeToolCall({
      pending,
      currentArguments: call().arguments,
      execute: async () => {
        executed = true;
        return "unsafe";
      },
    });

    expect(result).toMatchObject({ kind: "rejected" });
    expect(executed).toBe(false);
    expect(gateway.consumeCalls).toBe(0);
  });

  it("runs only through a verified release and rejects argument drift", async () => {
    const gateway = new Gateway();
    const adapter = createLangChainApprovalAdapter({ gateway, templateId: "tmpl_deploy" });
    const pending = await adapter.interruptToolCall(call());

    const approved = await adapter.resumeToolCall({
      pending,
      currentArguments: call().arguments,
      execute: async (_args, release) => `executed:${release.id}`,
    });
    expect(approved).toMatchObject({ kind: "tool_result", result: "executed:rel_langchain" });
    expect(gateway.consumeCalls).toBe(1);

    await expect(
      adapter.resumeToolCall({
        pending,
        currentArguments: { environment: "staging", revision: 3 },
        execute: async () => "unsafe",
      }),
    ).rejects.toBeInstanceOf(ActionDigestMismatchError);
  });

  it("refuses an ephemeral graph checkpoint", async () => {
    const adapter = createLangChainApprovalAdapter({ gateway: new Gateway(), templateId: "tmpl_deploy" });
    const unsafeCall = { ...call(), durableCheckpoint: false } as unknown as ReturnType<typeof call>;

    await expect(adapter.interruptToolCall(unsafeCall)).rejects.toThrow("durable checkpoint");
  });
});
