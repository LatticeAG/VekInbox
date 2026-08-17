/**
 * Framework integrations use this tiny contract instead of treating a legacy
 * request status as permission to execute. The data-plane implementation is
 * deliberately injected: it is responsible for durable cases, policy checks,
 * release consumption, and signature verification.
 */

export type ApprovalOutcome =
  | "approved"
  | "declined"
  | "revision_requested"
  | "expired"
  | "cancelled";

export type CaseLifecycle =
  | "draft"
  | "scheduled"
  | "open"
  | "awaiting_effective_time"
  | "resolved"
  | "expired"
  | "cancelled"
  | "superseded";

export interface ApprovalCase {
  id: string;
  threadId: string;
  revisionNumber: number;
  lifecycle: CaseLifecycle;
  actionDigest: string;
}

export interface ApprovalCaseResolution {
  caseId: string;
  lifecycle: CaseLifecycle;
  outcome: ApprovalOutcome;
  actionDigest: string;
  reason?: string;
}

export interface VerifiedExecutionRelease {
  id: string;
  nonce: string;
  caseId: string;
  actionDigest: string;
  audience?: string;
  expiresAt: string;
  /** The gateway must verify integrity and atomically consume the release. */
  verification: "verified";
}

export interface CreateApprovalCaseInput {
  /** Stable run/tool identity. Changed input becomes a new case revision in this thread. */
  threadKey: string;
  /** Stable only for an identical canonical action digest. */
  externalKey: string;
  templateId: string;
  actionDigest: string;
  action: {
    operation: string;
    resource: string;
    arguments: unknown;
    context?: unknown;
  };
  framework: string;
  frameworkVersion?: string;
  frameworkRunId: string;
  frameworkCheckpointRef: string;
  toolCallId: string;
  toolName: string;
  toolSchemaVersion?: string;
  frameworkArgumentsDigest: string;
  resumeTokenReference?: string;
}

export interface AwaitApprovalCaseInput {
  caseId: string;
  signal?: AbortSignal;
}

export interface ConsumeExecutionReleaseInput {
  caseId: string;
  actionDigest: string;
  /** A durable executor should persist this key beside its checkpoint. */
  idempotencyKey: string;
  audience?: string;
  signal?: AbortSignal;
}

export interface ExecutionReceiptInput {
  releaseId: string;
  actionDigest: string;
  outcome: "executed" | "failed_verified" | "execution_unknown";
  /** A bounded safe classification, not an arbitrary stack trace or tool output. */
  resultCode?: string;
}

/**
 * The one authoritative integration boundary. `consumeVerifiedRelease` must
 * fail closed for an expired, changed, unverified, or already consumed release.
 */
export interface ApprovalGateway {
  createOrGetCase(input: CreateApprovalCaseInput): Promise<ApprovalCase>;
  awaitCase(input: AwaitApprovalCaseInput): Promise<ApprovalCaseResolution>;
  consumeVerifiedRelease(input: ConsumeExecutionReleaseInput): Promise<VerifiedExecutionRelease>;
  recordExecutionReceipt?(input: ExecutionReceiptInput): Promise<void>;
}

export class ApprovalSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalSafetyError";
  }
}

export class ActionDigestMismatchError extends ApprovalSafetyError {
  constructor(message = "Tool input no longer matches the approved action digest") {
    super(message);
    this.name = "ActionDigestMismatchError";
  }
}

export type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

/** Deterministic, bounded JSON encoder used for action and argument digests. */
export function canonicalize(value: unknown): string {
  const seen = new WeakSet<object>();

  const encode = (current: unknown): string => {
    if (current === null) return "null";
    if (typeof current === "string" || typeof current === "boolean") {
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new ApprovalSafetyError("Action input contains a non-finite number");
      }
      return JSON.stringify(current);
    }
    if (typeof current === "undefined" || typeof current === "bigint" || typeof current === "symbol" || typeof current === "function") {
      throw new ApprovalSafetyError("Action input must be canonical JSON");
    }
    if (Array.isArray(current)) {
      if (seen.has(current)) {
        throw new ApprovalSafetyError("Action input contains a cycle");
      }
      seen.add(current);
      const encoded = `[${current.map((item) => encode(item)).join(",")}]`;
      seen.delete(current);
      return encoded;
    }
    if (typeof current === "object") {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new ApprovalSafetyError("Action input must contain plain JSON objects");
      }
      if (seen.has(current)) {
        throw new ApprovalSafetyError("Action input contains a cycle");
      }
      seen.add(current);
      const record = current as Record<string, unknown>;
      const encoded = Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${encode(record[key])}`)
        .join(",");
      seen.delete(current);
      return `{${encoded}}`;
    }
    throw new ApprovalSafetyError("Action input must be canonical JSON");
  };

  return encode(value);
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new ApprovalSafetyError("Web Crypto is required to bind an approval action digest");
  }
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestCanonical(value: unknown): Promise<string> {
  return `sha256:${await sha256Hex(canonicalize(value))}`;
}

export interface FrameworkActionInput {
  framework: string;
  frameworkVersion?: string;
  runId: string;
  checkpointRef: string;
  toolCallId: string;
  toolName: string;
  toolSchemaVersion?: string;
  arguments: unknown;
  context?: unknown;
  templateId: string;
  resumeTokenReference?: string;
}

export interface FrameworkApprovalRecord {
  framework: string;
  frameworkVersion?: string;
  frameworkRunId: string;
  frameworkCheckpointRef: string;
  toolCallId: string;
  toolName: string;
  toolSchemaVersion?: string;
  frameworkArgumentsDigest: string;
  threadId: string;
  caseId: string;
  revisionNumber: number;
  actionDigest: string;
  resumeTokenReference?: string;
  cancellationState: "active" | "cancelled";
}

function keyPart(value: string): string {
  if (!value.trim()) {
    throw new ApprovalSafetyError("Framework run and tool identifiers must be non-empty");
  }
  return encodeURIComponent(value);
}

export function frameworkThreadKey(input: Pick<FrameworkActionInput, "framework" | "runId" | "toolCallId">): string {
  return `${keyPart(input.framework)}:${keyPart(input.runId)}:${keyPart(input.toolCallId)}`;
}

export function frameworkExternalKey(
  input: Pick<FrameworkActionInput, "framework" | "runId" | "toolCallId">,
  actionDigest: string,
): string {
  return `${frameworkThreadKey(input)}:${keyPart(actionDigest)}`;
}

export async function frameworkArgumentsDigest(argumentsValue: unknown): Promise<string> {
  return digestCanonical(argumentsValue);
}

export async function createFrameworkApproval(
  gateway: ApprovalGateway,
  input: FrameworkActionInput,
): Promise<FrameworkApprovalRecord> {
  const argumentsDigest = await frameworkArgumentsDigest(input.arguments);
  const action = {
    operation: input.toolName,
    resource: `framework:${input.framework}`,
    arguments: input.arguments,
    ...(input.context === undefined ? {} : { context: input.context }),
  };
  const actionDigest = await digestCanonical({
    framework: input.framework,
    ...(input.frameworkVersion === undefined ? {} : { framework_version: input.frameworkVersion }),
    tool_name: input.toolName,
    ...(input.toolSchemaVersion === undefined ? {} : { tool_schema_version: input.toolSchemaVersion }),
    action,
  });
  const created = await gateway.createOrGetCase({
    threadKey: frameworkThreadKey(input),
    externalKey: frameworkExternalKey(input, actionDigest),
    templateId: input.templateId,
    actionDigest,
    action,
    framework: input.framework,
    frameworkVersion: input.frameworkVersion,
    frameworkRunId: input.runId,
    frameworkCheckpointRef: input.checkpointRef,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    toolSchemaVersion: input.toolSchemaVersion,
    frameworkArgumentsDigest: argumentsDigest,
    resumeTokenReference: input.resumeTokenReference,
  });

  if (created.actionDigest !== actionDigest) {
    throw new ActionDigestMismatchError("The approval service returned a case for a different action");
  }

  return {
    framework: input.framework,
    frameworkVersion: input.frameworkVersion,
    frameworkRunId: input.runId,
    frameworkCheckpointRef: input.checkpointRef,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    toolSchemaVersion: input.toolSchemaVersion,
    frameworkArgumentsDigest: argumentsDigest,
    threadId: created.threadId,
    caseId: created.id,
    revisionNumber: created.revisionNumber,
    actionDigest,
    resumeTokenReference: input.resumeTokenReference,
    cancellationState: "active",
  };
}

export type ApprovalContinuation =
  | { kind: "approved"; release: VerifiedExecutionRelease }
  | {
      kind: "blocked";
      outcome: Exclude<ApprovalOutcome, "approved">;
      lifecycle: CaseLifecycle;
      reason?: string;
    };

export function assertVerifiedRelease(
  release: VerifiedExecutionRelease,
  expected: Pick<FrameworkApprovalRecord, "caseId" | "actionDigest">,
): void {
  if (release.verification !== "verified") {
    throw new ApprovalSafetyError("Execution release was not verified");
  }
  if (!release.id || !release.nonce || release.caseId !== expected.caseId) {
    throw new ApprovalSafetyError("Execution release is not bound to this approval case");
  }
  if (release.actionDigest !== expected.actionDigest) {
    throw new ActionDigestMismatchError("Execution release is bound to a different action");
  }
  const expiry = Date.parse(release.expiresAt);
  if (Number.isNaN(expiry) || expiry <= Date.now()) {
    throw new ApprovalSafetyError("Execution release is expired");
  }
}

export async function awaitVerifiedFrameworkRelease(
  gateway: ApprovalGateway,
  record: FrameworkApprovalRecord,
  options?: { audience?: string; signal?: AbortSignal },
): Promise<ApprovalContinuation> {
  if (record.cancellationState === "cancelled") {
    return { kind: "blocked", outcome: "cancelled", lifecycle: "cancelled", reason: "framework_cancelled" };
  }

  const resolution = await gateway.awaitCase({ caseId: record.caseId, signal: options?.signal });
  if (resolution.caseId !== record.caseId || resolution.actionDigest !== record.actionDigest) {
    throw new ActionDigestMismatchError("Approval resolution does not match the paused framework action");
  }
  if (resolution.outcome !== "approved") {
    return {
      kind: "blocked",
      outcome: resolution.outcome,
      lifecycle: resolution.lifecycle,
      reason: resolution.reason,
    };
  }

  const release = await gateway.consumeVerifiedRelease({
    caseId: record.caseId,
    actionDigest: record.actionDigest,
    idempotencyKey: `framework-release:${record.caseId}:${record.actionDigest}`,
    audience: options?.audience,
    signal: options?.signal,
  });
  assertVerifiedRelease(release, record);
  return { kind: "approved", release };
}

export interface ExecuteApprovedActionOptions<TArguments, TResult> {
  gateway: ApprovalGateway;
  record: FrameworkApprovalRecord;
  currentArguments: TArguments;
  audience?: string;
  signal?: AbortSignal;
  execute: (argumentsValue: TArguments, release: VerifiedExecutionRelease) => Promise<TResult>;
}

export type ExecutedApprovalAction<TResult> =
  | { kind: "executed"; result: TResult; release: VerifiedExecutionRelease }
  | Extract<ApprovalContinuation, { kind: "blocked" }>;

/**
 * The only helper that invokes a side effect. It rebinds current arguments,
 * waits for a server outcome, consumes a verified one-time release, then calls
 * the framework's original tool exactly once from this control path.
 */
export async function executeApprovedAction<TArguments, TResult>(
  options: ExecuteApprovedActionOptions<TArguments, TResult>,
): Promise<ExecutedApprovalAction<TResult>> {
  const currentArgumentsDigest = await frameworkArgumentsDigest(options.currentArguments);
  if (currentArgumentsDigest !== options.record.frameworkArgumentsDigest) {
    throw new ActionDigestMismatchError();
  }

  const continuation = await awaitVerifiedFrameworkRelease(options.gateway, options.record, {
    audience: options.audience,
    signal: options.signal,
  });
  if (continuation.kind === "blocked") {
    return continuation;
  }

  try {
    const result = await options.execute(options.currentArguments, continuation.release);
    await options.gateway.recordExecutionReceipt?.({
      releaseId: continuation.release.id,
      actionDigest: options.record.actionDigest,
      outcome: "executed",
    });
    return { kind: "executed", result, release: continuation.release };
  } catch (error) {
    await options.gateway.recordExecutionReceipt?.({
      releaseId: continuation.release.id,
      actionDigest: options.record.actionDigest,
      outcome: "execution_unknown",
      resultCode: error instanceof Error ? error.name : "tool_error",
    });
    throw error;
  }
}
