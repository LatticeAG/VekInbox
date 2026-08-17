import { describe, expect, it } from "vitest";
import {
  type ApprovalGateway,
  type AwaitApprovalCaseInput,
  type ConsumeExecutionReleaseInput,
  type CreateApprovalCaseInput,
  type VerifiedExecutionRelease,
  ActionDigestMismatchError,
  createVercelAiSdkApprovalTool,
} from "./index.js";

class Gateway implements ApprovalGateway {
  input?: CreateApprovalCaseInput;
  outcome: "approved" | "declined" | "revision_requested" | "expired" | "cancelled" = "approved";
  consumeCalls = 0;

  async createOrGetCase(input: CreateApprovalCaseInput) {
    this.input = input;
    return {
      id: "case_ai_sdk",
      threadId: "thread_ai_sdk",
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
      id: "rel_ai_sdk",
      nonce: "nonce_ai_sdk",
      caseId: input.caseId,
      actionDigest: input.actionDigest,
      expiresAt: "2030-01-01T00:00:00.000Z",
      verification: "verified",
    };
  }
}

const context = {
  runId: "response-1",
  checkpointRef: "durable-run-store:response-1",
  toolCallId: "call-approve-1",
  durableState: true as const,
  toolSchemaVersion: "v1",
};

describe("Vercel AI SDK approval tool", () => {
  it("returns a durable pending response instead of holding the tool request", async () => {
    const gateway = new Gateway();
    const tool = createVercelAiSdkApprovalTool<{ amount: number }>({
      gateway,
      toolName: "pay_invoice",
      templateId: "tmpl_payment",
      validateInput: (input) => {
        if (input.amount <= 0) throw new Error("invalid amount");
        return input;
      },
    });

    const pending = await tool.requestApproval({ amount: 450 }, context);

    expect(pending.type).toBe("approval_pending");
    expect(pending.approval.framework).toBe("vercel-ai-sdk");
    expect(pending.approval.toolCallId).toBe(context.toolCallId);
    expect(gateway.input?.toolName).toBe("pay_invoice");
  });

  it("never invokes the original tool when policy blocks the case", async () => {
    const gateway = new Gateway();
    gateway.outcome = "revision_requested";
    const tool = createVercelAiSdkApprovalTool<{ amount: number }>({
      gateway,
      toolName: "pay_invoice",
      templateId: "tmpl_payment",
    });
    const pending = await tool.requestApproval({ amount: 450 }, context);
    let executed = false;

    const result = await tool.continue({
      pending,
      currentInput: { amount: 450 },
      execute: async () => {
        executed = true;
        return "unsafe";
      },
    });

    expect(result).toMatchObject({ type: "approval_blocked", outcome: "revision_requested" });
    expect(executed).toBe(false);
    expect(gateway.consumeCalls).toBe(0);
  });

  it("consumes a verified release before executing and rejects edited input", async () => {
    const gateway = new Gateway();
    const tool = createVercelAiSdkApprovalTool<{ amount: number }>({
      gateway,
      toolName: "pay_invoice",
      templateId: "tmpl_payment",
    });
    const pending = await tool.requestApproval({ amount: 450 }, context);

    const continued = await tool.continue({
      pending,
      currentInput: { amount: 450 },
      execute: async (input, release) => `${input.amount}:${release.id}`,
    });
    expect(continued).toMatchObject({ type: "tool_result", result: "450:rel_ai_sdk" });
    expect(gateway.consumeCalls).toBe(1);

    await expect(
      tool.continue({
        pending,
        currentInput: { amount: 451 },
        execute: async () => "unsafe",
      }),
    ).rejects.toBeInstanceOf(ActionDigestMismatchError);
  });

  it("refuses an ephemeral tool/run state", async () => {
    const tool = createVercelAiSdkApprovalTool<{ amount: number }>({
      gateway: new Gateway(),
      toolName: "pay_invoice",
      templateId: "tmpl_payment",
    });
    const unsafeContext = { ...context, durableState: false } as unknown as typeof context;

    await expect(tool.requestApproval({ amount: 450 }, unsafeContext)).rejects.toThrow("durable run/checkpoint");
  });
});
