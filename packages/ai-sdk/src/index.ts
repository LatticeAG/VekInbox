import {
  type ApprovalGateway,
  type ExecutedApprovalAction,
  type FrameworkApprovalRecord,
  type VerifiedExecutionRelease,
  createFrameworkApproval,
  executeApprovedAction,
} from "@latticeag/vekinbox-integration-core";

export const VERCEL_AI_SDK_FRAMEWORK = "vercel-ai-sdk";

/**
 * A structural subset of an AI SDK tool-call context. No `ai` package import is
 * used, keeping the bridge usable across AI SDK minor versions and runtimes.
 */
export interface VercelAiSdkToolCallContext {
  runId: string;
  checkpointRef: string;
  toolCallId: string;
  /** A durable route/session store must own the pending state. */
  durableState: true;
  toolSchemaVersion?: string;
  resumeTokenReference?: string;
}

export interface VercelAiSdkApprovalToolOptions<TInput> {
  gateway: ApprovalGateway;
  toolName: string;
  templateId: string;
  frameworkVersion?: string;
  audience?: string;
  /** Use the same validation/coercion that backs the AI SDK tool schema. */
  validateInput?: (input: TInput) => TInput | Promise<TInput>;
}

/** A durable interrupt result suitable for an API response, event, or run store. */
export interface VercelAiSdkApprovalPending<TInput> {
  type: "approval_pending";
  approval: FrameworkApprovalRecord;
  input: TInput;
}

export type VercelAiSdkContinuation<TResult> =
  | { type: "tool_result"; result: TResult; release: VerifiedExecutionRelease }
  | {
      type: "approval_blocked";
      outcome: "declined" | "revision_requested" | "expired" | "cancelled";
      reason?: string;
    };

/**
 * A tool-level approval adapter. `requestApproval` is called from the AI SDK
 * tool interception point; `continue` is called later from a durable route or
 * webhook consumer, never from the original held-open request.
 */
export class VercelAiSdkApprovalTool<TInput> {
  private readonly options: VercelAiSdkApprovalToolOptions<TInput>;

  constructor(options: VercelAiSdkApprovalToolOptions<TInput>) {
    this.options = options;
  }

  async requestApproval(
    input: TInput,
    context: VercelAiSdkToolCallContext,
  ): Promise<VercelAiSdkApprovalPending<TInput>> {
    if (context.durableState !== true || !context.checkpointRef.trim()) {
      throw new Error("AI SDK approval requires a durable run/checkpoint reference");
    }
    const validatedInput = this.options.validateInput
      ? await this.options.validateInput(input)
      : input;
    const approval = await createFrameworkApproval(this.options.gateway, {
      framework: VERCEL_AI_SDK_FRAMEWORK,
      frameworkVersion: this.options.frameworkVersion,
      runId: context.runId,
      checkpointRef: context.checkpointRef,
      toolCallId: context.toolCallId,
      toolName: this.options.toolName,
      toolSchemaVersion: context.toolSchemaVersion,
      arguments: validatedInput,
      templateId: this.options.templateId,
      resumeTokenReference: context.resumeTokenReference,
    });
    return { type: "approval_pending", approval, input: validatedInput };
  }

  /**
   * Safe continuation path. It verifies current input matches the paused tool
   * call, consumes a verified release, then and only then invokes the tool.
   */
  async continue<TResult>(options: {
    pending: VercelAiSdkApprovalPending<TInput>;
    currentInput: TInput;
    execute: (input: TInput, release: VerifiedExecutionRelease) => Promise<TResult>;
    signal?: AbortSignal;
  }): Promise<VercelAiSdkContinuation<TResult>> {
    const result: ExecutedApprovalAction<TResult> = await executeApprovedAction({
      gateway: this.options.gateway,
      record: options.pending.approval,
      currentArguments: options.currentInput,
      audience: this.options.audience,
      signal: options.signal,
      execute: options.execute,
    });
    if (result.kind === "executed") {
      return { type: "tool_result", result: result.result, release: result.release };
    }
    return {
      type: "approval_blocked",
      outcome: result.outcome,
      reason: result.reason,
    };
  }

  /** Store this result if the AI run is cancelled. It deliberately cannot execute. */
  cancel(pending: VercelAiSdkApprovalPending<TInput>): VercelAiSdkApprovalPending<TInput> {
    return {
      ...pending,
      approval: { ...pending.approval, cancellationState: "cancelled" },
    };
  }
}

export function createVercelAiSdkApprovalTool<TInput>(
  options: VercelAiSdkApprovalToolOptions<TInput>,
): VercelAiSdkApprovalTool<TInput> {
  return new VercelAiSdkApprovalTool(options);
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
