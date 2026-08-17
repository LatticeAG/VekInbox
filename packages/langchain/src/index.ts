import {
  type ApprovalGateway,
  type ExecutedApprovalAction,
  type FrameworkApprovalRecord,
  type VerifiedExecutionRelease,
  createFrameworkApproval,
  executeApprovedAction,
} from "@latticeag/vekinbox-integration-core";

export const LANGCHAIN_FRAMEWORK = "langchain";

/**
 * Structural shape only: consumers can pass LangChain/LangGraph tool-call
 * objects without this package importing either framework at runtime.
 */
export interface LangChainToolCall<TArguments> {
  runId: string;
  checkpointRef: string;
  toolCallId: string;
  toolName: string;
  toolSchemaVersion?: string;
  arguments: TArguments;
  context?: unknown;
  /** The graph must be resumable after this process exits. */
  durableCheckpoint: true;
  resumeTokenReference?: string;
}

export interface LangChainApprovalAdapterOptions<TArguments> {
  gateway: ApprovalGateway;
  templateId: string;
  frameworkVersion?: string;
  audience?: string;
  /** Validate/coerce with the application’s LangChain tool schema before binding. */
  validateArguments?: (argumentsValue: TArguments) => TArguments | Promise<TArguments>;
}

/** Persist this in the graph checkpointer; it contains no approval credential. */
export interface LangChainApprovalPending<TArguments> {
  kind: "approval_pending";
  approval: FrameworkApprovalRecord;
  arguments: TArguments;
}

export type LangChainResumeResult<TResult> =
  | { kind: "tool_result"; result: TResult; release: VerifiedExecutionRelease }
  | {
      kind: "rejected" | "revision_requested" | "expired" | "cancelled";
      reason?: string;
    };

function blockedKind(outcome: "declined" | "revision_requested" | "expired" | "cancelled"): Exclude<LangChainResumeResult<never>["kind"], "tool_result"> {
  switch (outcome) {
    case "declined":
      return "rejected";
    case "revision_requested":
      return "revision_requested";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
  }
}

/**
 * Maps an interrupting LangChain/LangGraph tool call to one immutable VekInbox
 * case. It intentionally returns serialisable pending state instead of holding
 * a process or HTTP stream open while a person reviews the action.
 */
export class LangChainApprovalAdapter<TArguments> {
  private readonly options: LangChainApprovalAdapterOptions<TArguments>;

  constructor(options: LangChainApprovalAdapterOptions<TArguments>) {
    this.options = options;
  }

  async interruptToolCall(
    toolCall: LangChainToolCall<TArguments>,
  ): Promise<LangChainApprovalPending<TArguments>> {
    if (toolCall.durableCheckpoint !== true || !toolCall.checkpointRef.trim()) {
      throw new Error("Asynchronous LangChain approval requires a durable checkpoint reference");
    }
    const argumentsValue = this.options.validateArguments
      ? await this.options.validateArguments(toolCall.arguments)
      : toolCall.arguments;
    const approval = await createFrameworkApproval(this.options.gateway, {
      framework: LANGCHAIN_FRAMEWORK,
      frameworkVersion: this.options.frameworkVersion,
      runId: toolCall.runId,
      checkpointRef: toolCall.checkpointRef,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      toolSchemaVersion: toolCall.toolSchemaVersion,
      arguments: argumentsValue,
      context: toolCall.context,
      templateId: this.options.templateId,
      resumeTokenReference: toolCall.resumeTokenReference,
    });
    return { kind: "approval_pending", approval, arguments: argumentsValue };
  }

  /**
   * Invoke from a resumed graph node. A different argument value is rejected
   * before release consumption, and a declined/revised case becomes graph
   * feedback rather than an exception that an agent might auto-retry.
   */
  async resumeToolCall<TResult>(options: {
    pending: LangChainApprovalPending<TArguments>;
    currentArguments: TArguments;
    execute: (argumentsValue: TArguments, release: VerifiedExecutionRelease) => Promise<TResult>;
    signal?: AbortSignal;
  }): Promise<LangChainResumeResult<TResult>> {
    const result: ExecutedApprovalAction<TResult> = await executeApprovedAction({
      gateway: this.options.gateway,
      record: options.pending.approval,
      currentArguments: options.currentArguments,
      audience: this.options.audience,
      signal: options.signal,
      execute: options.execute,
    });
    if (result.kind === "executed") {
      return { kind: "tool_result", result: result.result, release: result.release };
    }
    return { kind: blockedKind(result.outcome), reason: result.reason };
  }

  /** Persist the returned state when LangGraph cancels a run; it cannot consume a release. */
  cancel(pending: LangChainApprovalPending<TArguments>): LangChainApprovalPending<TArguments> {
    return {
      ...pending,
      approval: { ...pending.approval, cancellationState: "cancelled" },
    };
  }
}

export function createLangChainApprovalAdapter<TArguments>(
  options: LangChainApprovalAdapterOptions<TArguments>,
): LangChainApprovalAdapter<TArguments> {
  return new LangChainApprovalAdapter(options);
}

export type {
  ApprovalGateway,
  ApprovalOutcome,
  AwaitApprovalCaseInput,
  ConsumeExecutionReleaseInput,
  CreateApprovalCaseInput,
  FrameworkApprovalRecord,
  VerifiedExecutionRelease,
} from "@latticeag/vekinbox-integration-core";
export {
  ActionDigestMismatchError,
  ApprovalSafetyError,
} from "@latticeag/vekinbox-integration-core";
