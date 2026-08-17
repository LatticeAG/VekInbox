import { cloneCanonical, normalizeSha256Digest } from "./canonical.js";
import type { DecisionKind, PolicyCaseState, PolicyDecisionInput } from "./policy.js";

export type RiskClass = "R0" | "R1" | "R2" | "R3" | "R4";
export type ScheduledApprovalStatus =
  | "pending_confirmation"
  | "confirmed_and_submitted"
  | "cancelled"
  | "expired"
  | "stale"
  | "ineligible"
  | "assurance_failed";

export interface ScheduledDecisionConfirmation {
  reviewer_id: string;
  confirmed_at: Date | string;
  /** The host maps an authenticated session/MFA fact to this ordered value. */
  assurance: "none" | "verified_session" | "step_up";
}

export interface ScheduledApproval {
  id: string;
  case_id: string;
  stage_id: string;
  reviewer_id: string;
  intended_decision: DecisionKind;
  action_digest: string;
  context_manifest_digest: string;
  effective_at: string;
  requested_at: string;
  risk_class: RiskClass;
  requires_confirmation: boolean;
  minimum_assurance: ScheduledDecisionConfirmation["assurance"];
  confirmation_expires_at: string;
  original_timezone?: string;
  original_local_time?: string;
  status: ScheduledApprovalStatus;
  cancellation_reason?: string;
  terminal_reason?: string;
}

export interface PlanScheduledApprovalInput {
  id: string;
  case_id: string;
  stage_id: string;
  reviewer_id: string;
  intended_decision: DecisionKind;
  action_digest: string;
  context_manifest_digest: string;
  effective_at: Date | string;
  requested_at?: Date | string;
  risk_class: RiskClass;
  /** R0/R1 unattended conversion must be explicitly opted in by a template. */
  allow_unattended?: boolean;
  minimum_assurance?: ScheduledDecisionConfirmation["assurance"];
  applicable_deadline_at?: Date | string;
  confirmation_window_ms?: number;
  original_timezone?: string;
  original_local_time?: string;
}

export interface ScheduledCaseSnapshot {
  lifecycle: PolicyCaseState["lifecycle"];
  action_digest: string;
  context_manifest_digest: string;
  applicable_deadline_at?: string;
}

export interface ScheduledApprovalProcessInput {
  approval: ScheduledApproval;
  snapshot: ScheduledCaseSnapshot;
  at: Date | string;
  confirmation?: ScheduledDecisionConfirmation;
  is_currently_eligible: boolean;
}

export interface ScheduledApprovalProcessResult {
  approval: ScheduledApproval;
  decision?: PolicyDecisionInput;
  reason?: string;
}

const MAX_LEAD_MS: Record<RiskClass, number> = {
  R0: 30 * 24 * 60 * 60 * 1000,
  R1: 30 * 24 * 60 * 60 * 1000,
  R2: 7 * 24 * 60 * 60 * 1000,
  R3: 72 * 60 * 60 * 1000,
  R4: 24 * 60 * 60 * 1000,
};

const RISK_CLASSES: readonly RiskClass[] = ["R0", "R1", "R2", "R3", "R4"];
const DECISION_KINDS: readonly DecisionKind[] = [
  "approve",
  "decline",
  "request_changes",
  "acknowledge",
];

const ASSURANCE_ORDER: Record<ScheduledDecisionConfirmation["assurance"], number> = {
  none: 0,
  verified_session: 1,
  step_up: 2,
};
const ASSURANCE_LEVELS = Object.keys(ASSURANCE_ORDER) as ScheduledDecisionConfirmation["assurance"][];

function iso(value: Date | string | undefined, fallback = new Date()): string {
  const date = value === undefined ? fallback : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Expected a valid RFC 3339 instant");
  }
  return date.toISOString();
}

function requireDigest(value: string, name: string): string {
  try {
    return normalizeSha256Digest(value);
  } catch {
    throw new TypeError(`${name} must be a SHA-256 hex digest`);
  }
}

/**
 * Stores a future decision as a non-voting intent. It cannot produce a policy
 * decision until processScheduledApproval performs every fresh safety check.
 */
export function planScheduledApproval(input: PlanScheduledApprovalInput): ScheduledApproval {
  if (!input.id?.trim() || !input.case_id?.trim() || !input.stage_id?.trim() || !input.reviewer_id?.trim()) {
    throw new TypeError("id, case_id, stage_id, and reviewer_id are required");
  }
  if (!RISK_CLASSES.includes(input.risk_class)) {
    throw new TypeError("risk_class is unsupported");
  }
  if (!DECISION_KINDS.includes(input.intended_decision)) {
    throw new TypeError("intended_decision is unsupported");
  }
  if (input.allow_unattended !== undefined && typeof input.allow_unattended !== "boolean") {
    throw new TypeError("allow_unattended must be a boolean");
  }
  if (input.minimum_assurance !== undefined && !ASSURANCE_LEVELS.includes(input.minimum_assurance)) {
    throw new TypeError("minimum_assurance is unsupported");
  }
  const actionDigest = requireDigest(input.action_digest, "action_digest");
  const contextManifestDigest = requireDigest(
    input.context_manifest_digest,
    "context_manifest_digest",
  );
  const requestedAt = iso(input.requested_at);
  const effectiveAt = iso(input.effective_at);
  const effectiveMs = new Date(effectiveAt).getTime();
  const requestedMs = new Date(requestedAt).getTime();
  if (effectiveMs <= requestedMs) {
    throw new RangeError("effective_at must be in the future");
  }
  if (effectiveMs - requestedMs > MAX_LEAD_MS[input.risk_class]) {
    throw new RangeError(`effective_at exceeds the maximum lead time for ${input.risk_class}`);
  }
  if (input.applicable_deadline_at && effectiveMs >= new Date(iso(input.applicable_deadline_at)).getTime()) {
    throw new RangeError("effective_at must be strictly before the applicable deadline");
  }
  const requiresConfirmation = input.allow_unattended !== true || !["R0", "R1"].includes(input.risk_class);
  const minimumAssurance =
    input.minimum_assurance ?? (input.risk_class === "R3" || input.risk_class === "R4" ? "step_up" : "verified_session");
  const confirmationWindow = input.confirmation_window_ms ?? 15 * 60 * 1000;
  if (!Number.isInteger(confirmationWindow) || confirmationWindow <= 0) {
    throw new RangeError("confirmation_window_ms must be a positive integer");
  }
  return {
    id: input.id,
    case_id: input.case_id,
    stage_id: input.stage_id,
    reviewer_id: input.reviewer_id,
    intended_decision: input.intended_decision,
    action_digest: actionDigest,
    context_manifest_digest: contextManifestDigest,
    effective_at: effectiveAt,
    requested_at: requestedAt,
    risk_class: input.risk_class,
    requires_confirmation: requiresConfirmation,
    minimum_assurance: minimumAssurance,
    confirmation_expires_at: new Date(effectiveMs + confirmationWindow).toISOString(),
    ...(input.original_timezone === undefined ? {} : { original_timezone: input.original_timezone }),
    ...(input.original_local_time === undefined ? {} : { original_local_time: input.original_local_time }),
    status: "pending_confirmation",
  };
}

export function cancelScheduledApproval(
  prior: ScheduledApproval,
  reason = "retracted_by_reviewer",
): ScheduledApproval {
  const approval = cloneCanonical(prior);
  if (approval.status !== "pending_confirmation") {
    return approval;
  }
  approval.status = "cancelled";
  approval.cancellation_reason = reason;
  return approval;
}

function terminal(
  prior: ScheduledApproval,
  status: Exclude<ScheduledApprovalStatus, "pending_confirmation" | "confirmed_and_submitted" | "cancelled">,
  reason: string,
): ScheduledApprovalProcessResult {
  const approval = cloneCanonical(prior);
  approval.status = status;
  approval.terminal_reason = reason;
  return { approval, reason };
}

/**
 * Evaluates a due scheduled decision without recording it directly. A persistence
 * adapter submits the returned decision through submitPolicyDecision in the same
 * transaction as the scheduled row status transition.
 */
export function processScheduledApproval(
  input: ScheduledApprovalProcessInput,
): ScheduledApprovalProcessResult {
  const approval = cloneCanonical(input.approval);
  if (approval.status !== "pending_confirmation") {
    return { approval, reason: "scheduled_approval_not_pending" };
  }
  const now = iso(input.at);
  const nowMs = new Date(now).getTime();
  const effectiveMs = new Date(approval.effective_at).getTime();
  if (nowMs < effectiveMs) {
    return { approval, reason: "not_due" };
  }
  let snapshotActionDigest: string;
  let snapshotContextDigest: string;
  try {
    snapshotActionDigest = normalizeSha256Digest(input.snapshot.action_digest);
    snapshotContextDigest = normalizeSha256Digest(input.snapshot.context_manifest_digest);
  } catch {
    return terminal(approval, "stale", "case_or_bound_digest_changed");
  }
  if (
    input.snapshot.lifecycle !== "open" ||
    snapshotActionDigest !== approval.action_digest ||
    snapshotContextDigest !== approval.context_manifest_digest
  ) {
    return terminal(approval, "stale", "case_or_bound_digest_changed");
  }
  if (
    input.snapshot.applicable_deadline_at &&
    nowMs >= new Date(input.snapshot.applicable_deadline_at).getTime()
  ) {
    return terminal(approval, "stale", "applicable_deadline_elapsed");
  }
  if (!input.is_currently_eligible) {
    return terminal(approval, "ineligible", "reviewer_no_longer_eligible");
  }
  if (approval.requires_confirmation) {
    const confirmationExpiresMs = new Date(approval.confirmation_expires_at).getTime();
    if (!Number.isFinite(confirmationExpiresMs) || nowMs > confirmationExpiresMs) {
      return terminal(approval, "expired", "confirmation_window_elapsed");
    }
    const confirmation = input.confirmation;
    if (!confirmation) {
      return { approval, reason: "fresh_confirmation_required" };
    }
    let confirmedAt: string;
    try {
      confirmedAt = iso(confirmation.confirmed_at);
    } catch {
      return terminal(approval, "assurance_failed", "confirmation_time_invalid");
    }
    const confirmedMs = new Date(confirmedAt).getTime();
    if (
      confirmation.reviewer_id !== approval.reviewer_id ||
      confirmedMs < effectiveMs ||
      confirmedMs > nowMs ||
      confirmedMs > confirmationExpiresMs
    ) {
      return terminal(approval, "assurance_failed", "confirmation_not_bound_to_reviewer_or_effective_time");
    }
    if (
      !ASSURANCE_LEVELS.includes(confirmation.assurance) ||
      !ASSURANCE_LEVELS.includes(approval.minimum_assurance) ||
      ASSURANCE_ORDER[confirmation.assurance] < ASSURANCE_ORDER[approval.minimum_assurance]
    ) {
      return terminal(approval, "assurance_failed", "confirmation_assurance_too_low");
    }
  }
  approval.status = "confirmed_and_submitted";
  return {
    approval,
    decision: {
      id: `scheduled:${approval.id}`,
      idempotency_key: `scheduled:${approval.id}`,
      stage_id: approval.stage_id,
      participant_id: approval.reviewer_id,
      kind: approval.intended_decision,
      action_digest: approval.action_digest,
      context_manifest_digest: approval.context_manifest_digest,
      accepted_at: now,
    },
  };
}

export interface PlannedCaseOpen {
  case_id: string;
  opens_at: string;
  status: "scheduled" | "opened" | "cancelled" | "stale";
  case_version: number;
}

export function planCaseOpen(input: {
  case_id: string;
  opens_at: Date | string;
  case_version: number;
}): PlannedCaseOpen {
  if (!input.case_id || !Number.isInteger(input.case_version) || input.case_version < 1) {
    throw new TypeError("case_id and a positive integer case_version are required");
  }
  return {
    case_id: input.case_id,
    opens_at: iso(input.opens_at),
    status: "scheduled",
    case_version: input.case_version,
  };
}

/** A stale version is a no-op; scheduled work may never reopen a revised/cancelled case. */
export function processPlannedCaseOpen(input: {
  planned: PlannedCaseOpen;
  at: Date | string;
  current_case_version: number;
  case_is_scheduled: boolean;
}): PlannedCaseOpen {
  const planned = cloneCanonical(input.planned);
  if (planned.status !== "scheduled" || new Date(iso(input.at)).getTime() < new Date(planned.opens_at).getTime()) {
    return planned;
  }
  if (planned.case_version !== input.current_case_version || !input.case_is_scheduled) {
    planned.status = "stale";
    return planned;
  }
  planned.status = "opened";
  return planned;
}
