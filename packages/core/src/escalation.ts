import { cloneCanonical } from "./canonical.js";
import {
  addEscalationParticipants,
  parsePolicyDuration,
  terminatePolicyCase,
  transferPolicyParticipant,
  type CompiledApprovalPolicy,
  type PolicyCaseState,
} from "./policy.js";

export type EscalationCondition =
  | "stage_unsatisfied"
  | "stage_unacknowledged"
  | "case_open"
  | "delivery_failed"
  | "participant_ineligible";
export type EscalationEffect =
  | "notify"
  | "add_participants"
  | "transfer_to_declared_reserve"
  | "request_incident_acknowledgment"
  | "terminate";
export type EscalationAnchor = "case_opened" | "stage_opened" | "last_delivery_attempted";

export interface EscalationTarget {
  kind: "user" | "team" | "manager" | "on_call";
  user_id?: string;
  team_id?: string;
  subject_id?: string;
  schedule?: string;
  fallback?: EscalationTarget;
}

export interface EscalationStep {
  id: string;
  scope: "case" | "stage";
  stage_ids?: string[];
  due: {
    anchor: EscalationAnchor;
    after: string;
  };
  condition: EscalationCondition;
  effect: EscalationEffect;
  targets?: EscalationTarget[];
  /** Termination can never be approval. */
  outcome?: "declined" | "expired" | "cancelled";
}

export interface EscalationLadder {
  id?: string;
  steps: EscalationStep[];
}

export interface CompiledEscalationStep extends EscalationStep {
  due_after_ms: number;
}

export interface CompiledEscalationLadder {
  ladder_id: string;
  steps: CompiledEscalationStep[];
}

export class EscalationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EscalationValidationError";
  }
}

function validateTarget(target: EscalationTarget, path: string, depth = 0): void {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new EscalationValidationError(`${path} must be an object`);
  }
  if (depth > 8) {
    throw new EscalationValidationError(`${path}.fallback is nested too deeply`);
  }
  if (!["user", "team", "manager", "on_call"].includes(target.kind)) {
    throw new EscalationValidationError(`${path}.kind is unsupported`);
  }
  if (target.kind === "user" && !target.user_id) {
    throw new EscalationValidationError(`${path}.user_id is required for a user target`);
  }
  if (target.kind === "team" && !target.team_id) {
    throw new EscalationValidationError(`${path}.team_id is required for a team target`);
  }
  if (target.kind === "manager" && !target.subject_id) {
    throw new EscalationValidationError(`${path}.subject_id is required for a manager target`);
  }
  if (target.kind === "on_call" && !target.schedule) {
    throw new EscalationValidationError(`${path}.schedule is required for an on_call target`);
  }
  if (target.fallback) {
    validateTarget(target.fallback, `${path}.fallback`, depth + 1);
  }
}

/** Validates finite, policy-published escalation work and resolves relative durations. */
export function compileEscalationLadder(
  policy: CompiledApprovalPolicy,
  ladder: EscalationLadder,
): CompiledEscalationLadder {
  if (ladder.steps.length === 0) {
    throw new EscalationValidationError("An escalation ladder requires at least one step");
  }
  const ids = new Set<string>();
  const steps = ladder.steps.map((step, index): CompiledEscalationStep => {
    const path = `steps[${index}]`;
    if (!step.id || ids.has(step.id)) {
      throw new EscalationValidationError(`${path}.id must be unique and non-empty`);
    }
    ids.add(step.id);
    if (
      ![
        "stage_unsatisfied",
        "stage_unacknowledged",
        "case_open",
        "delivery_failed",
        "participant_ineligible",
      ].includes(step.condition)
    ) {
      throw new EscalationValidationError(`${path}.condition is unsupported`);
    }
    if (
      ![
        "notify",
        "add_participants",
        "transfer_to_declared_reserve",
        "request_incident_acknowledgment",
        "terminate",
      ].includes(step.effect)
    ) {
      throw new EscalationValidationError(`${path}.effect is unsupported`);
    }
    if (!step.due || !["case_opened", "stage_opened", "last_delivery_attempted"].includes(step.due.anchor)) {
      throw new EscalationValidationError(`${path}.due.anchor is invalid`);
    }
    if (step.scope === "stage") {
      if (!step.stage_ids || step.stage_ids.length === 0) {
        throw new EscalationValidationError(`${path}.stage_ids is required for stage scope`);
      }
      for (const stageId of step.stage_ids) {
        if (!policy.stage_by_id[stageId]) {
          throw new EscalationValidationError(`${path}.stage_ids references unknown stage '${stageId}'`);
        }
      }
      if (step.condition === "case_open") {
        throw new EscalationValidationError(`${path}.condition case_open is only valid for case scope`);
      }
      if (step.effect === "add_participants") {
        for (const stageId of step.stage_ids) {
          const stage = policy.stage_by_id[stageId]!;
          if (
            stage.approval_rule.kind === "all_of" ||
            !stage.participants.escalation_additions?.allowed
          ) {
            throw new EscalationValidationError(
              `${path}.effect add_participants is not permitted by stage '${stageId}'`,
            );
          }
        }
      }
      if (step.effect === "transfer_to_declared_reserve") {
        for (const stageId of step.stage_ids) {
          if (policy.stage_by_id[stageId]!.participants.on_eligibility_loss !== "transfer_to_declared_reserve") {
            throw new EscalationValidationError(
              `${path}.effect transfer_to_declared_reserve is not permitted by stage '${stageId}'`,
            );
          }
        }
      }
    } else {
      if (step.scope !== "case") {
        throw new EscalationValidationError(`${path}.scope must be case or stage`);
      }
      if (step.stage_ids && step.stage_ids.length > 0) {
        throw new EscalationValidationError(`${path}.stage_ids is only valid for stage scope`);
      }
      if (
        step.condition === "stage_unsatisfied" ||
        step.condition === "stage_unacknowledged" ||
        step.condition === "participant_ineligible"
      ) {
        throw new EscalationValidationError(`${path}.condition requires stage scope`);
      }
      if (
        step.effect === "add_participants" ||
        step.effect === "transfer_to_declared_reserve"
      ) {
        throw new EscalationValidationError(`${path}.effect requires stage scope`);
      }
      if (step.due.anchor !== "case_opened") {
        throw new EscalationValidationError(`${path}.due.anchor ${step.due.anchor} requires stage scope`);
      }
    }
    if (step.effect === "terminate") {
      if (!(["declined", "expired", "cancelled"] as const).includes(step.outcome as never)) {
        throw new EscalationValidationError(`${path}.outcome must be declined, expired, or cancelled for terminate`);
      }
    } else if (step.outcome) {
      throw new EscalationValidationError(`${path}.outcome is only valid for terminate`);
    }
    if (step.effect !== "terminate" && (!step.targets || step.targets.length === 0)) {
      throw new EscalationValidationError(`${path}.targets is required for this effect`);
    }
    for (const [targetIndex, target] of (step.targets ?? []).entries()) {
      validateTarget(target, `${path}.targets[${targetIndex}]`);
    }
    const dueAfterMs = parsePolicyDuration(step.due.after);
    return { ...cloneCanonical(step), due_after_ms: dueAfterMs };
  });
  return {
    ladder_id: ladder.id ?? "default",
    steps: steps.sort((left, right) => left.due_after_ms - right.due_after_ms || left.id.localeCompare(right.id)),
  };
}

export interface EscalationTargetResolution {
  participant_ids: string[];
  source: string;
}

export interface EscalationResolutionContext {
  case_state: PolicyCaseState;
  stage_id?: string;
  step: CompiledEscalationStep;
}

/**
 * Hosts resolve directory/on-call/manager facts; this pure engine snapshots only
 * their returned IDs and source description. A null result invokes target fallback.
 */
export type EscalationTargetResolver = (
  target: EscalationTarget,
  context: EscalationResolutionContext,
) => EscalationTargetResolution | null;

export interface EscalationRun {
  key: string;
  ladder_id: string;
  step_id: string;
  stage_id?: string;
  due_at: string;
  executed_at: string;
  status: "executed" | "suppressed";
  reason: string;
  target_ids: string[];
  target_sources: string[];
}

export interface EscalationRuntime {
  runs: EscalationRun[];
}

export interface NotificationIntent {
  idempotency_key: string;
  stage_id?: string;
  recipient_id: string;
  urgency: "normal" | "high" | "critical";
  reason: string;
}

export interface EscalationEvaluationInput {
  policy: CompiledApprovalPolicy;
  ladder: CompiledEscalationLadder;
  case_state: PolicyCaseState;
  runtime?: EscalationRuntime;
  at: Date | string;
  resolve_target: EscalationTargetResolver;
  /** host-recorded facts used by the finite condition enum */
  delivery_failed?: boolean;
  ineligible_participants_by_stage?: Record<string, string[]>;
}

export interface EscalationEvaluationResult {
  case_state: PolicyCaseState;
  runtime: EscalationRuntime;
  notification_intents: NotificationIntent[];
  new_runs: EscalationRun[];
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Expected a valid RFC 3339 instant");
  }
  return date.toISOString();
}

function getAnchorAt(
  state: PolicyCaseState,
  stageId: string | undefined,
  anchor: EscalationAnchor,
): string | undefined {
  if (anchor === "case_opened") {
    return state.case_opened_at;
  }
  if (!stageId) {
    return undefined;
  }
  const stage = state.stages[stageId];
  if (!stage) {
    return undefined;
  }
  return anchor === "stage_opened" ? stage.opened_at : stage.last_delivery_attempted_at;
}

function stepConditionMatches(
  input: EscalationEvaluationInput,
  step: CompiledEscalationStep,
  stageId: string | undefined,
): boolean {
  const state = input.case_state;
  if (state.lifecycle !== "open") {
    return false;
  }
  if (step.condition === "case_open") {
    return true;
  }
  if (step.condition === "delivery_failed") {
    return input.delivery_failed === true;
  }
  if (!stageId) {
    return false;
  }
  const stage = state.stages[stageId]!;
  if (step.condition === "stage_unsatisfied") {
    return stage.state === "open";
  }
  if (step.condition === "stage_unacknowledged") {
    return (
      stage.state === "open" &&
      !state.decisions.some((decision) => decision.stage_id === stageId && decision.kind === "acknowledge")
    );
  }
  return (input.ineligible_participants_by_stage?.[stageId]?.length ?? 0) > 0;
}

function resolveWithFallback(
  target: EscalationTarget,
  resolver: EscalationTargetResolver,
  context: EscalationResolutionContext,
  depth = 0,
): { resolution: EscalationTargetResolution | null; used_fallback: boolean } {
  if (depth > 8) {
    return { resolution: null, used_fallback: true };
  }
  const resolution = resolver(target, context);
  if (resolution && resolution.participant_ids.length > 0) {
    return {
      resolution: {
        participant_ids: [...new Set(resolution.participant_ids)].sort(),
        source: resolution.source,
      },
      used_fallback: false,
    };
  }
  if (!target.fallback) {
    return { resolution: null, used_fallback: false };
  }
  const fallback = resolveWithFallback(target.fallback, resolver, context, depth + 1);
  return { resolution: fallback.resolution, used_fallback: true };
}

function buildRunKey(ladderId: string, stepId: string, stageId: string | undefined): string {
  return `${ladderId}:${stepId}:${stageId ?? "case"}`;
}

/**
 * Evaluates due work once. The returned runtime is the durable idempotency ledger
 * a database adapter should persist alongside the case transition/outbox records.
 */
export function evaluateEscalationLadder(
  input: EscalationEvaluationInput,
): EscalationEvaluationResult {
  let caseState = cloneCanonical(input.case_state);
  const runtime: EscalationRuntime = cloneCanonical(input.runtime ?? { runs: [] });
  const now = iso(input.at);
  const notificationIntents: NotificationIntent[] = [];
  const newRuns: EscalationRun[] = [];

  for (const step of input.ladder.steps) {
    const scopeInstances = step.scope === "case" ? [undefined] : step.stage_ids ?? [];
    for (const stageId of scopeInstances) {
      const key = buildRunKey(input.ladder.ladder_id, step.id, stageId);
      if (runtime.runs.some((run) => run.key === key)) {
        continue;
      }
      const anchorAt = getAnchorAt(caseState, stageId, step.due.anchor);
      if (!anchorAt) {
        continue;
      }
      const dueAt = new Date(new Date(anchorAt).getTime() + step.due_after_ms).toISOString();
      if (new Date(now).getTime() < new Date(dueAt).getTime()) {
        continue;
      }
      if (!stepConditionMatches({ ...input, case_state: caseState }, step, stageId)) {
        const run: EscalationRun = {
          key,
          ladder_id: input.ladder.ladder_id,
          step_id: step.id,
          ...(stageId === undefined ? {} : { stage_id: stageId }),
          due_at: dueAt,
          executed_at: now,
          status: "suppressed",
          reason: "condition_not_met",
          target_ids: [],
          target_sources: [],
        };
        runtime.runs.push(run);
        newRuns.push(run);
        continue;
      }

      const context: EscalationResolutionContext = { case_state: caseState, ...(stageId === undefined ? {} : { stage_id: stageId }), step };
      const targetIds: string[] = [];
      const targetSources: string[] = [];
      let usedFallback = false;
      for (const target of step.targets ?? []) {
        const resolved = resolveWithFallback(target, input.resolve_target, context);
        usedFallback ||= resolved.used_fallback;
        if (resolved.resolution) {
          targetIds.push(...resolved.resolution.participant_ids);
          targetSources.push(resolved.resolution.source);
        }
      }
      const uniqueTargetIds = [...new Set(targetIds)].sort();
      const uniqueSources = [...new Set(targetSources)].sort();
      if (step.effect !== "terminate" && uniqueTargetIds.length === 0) {
        const run: EscalationRun = {
          key,
          ladder_id: input.ladder.ladder_id,
          step_id: step.id,
          ...(stageId === undefined ? {} : { stage_id: stageId }),
          due_at: dueAt,
          executed_at: now,
          status: "suppressed",
          reason: "target_resolution_empty",
          target_ids: [],
          target_sources: [],
        };
        runtime.runs.push(run);
        newRuns.push(run);
        continue;
      }

      if (step.effect === "add_participants" && stageId) {
        caseState = addEscalationParticipants(input.policy, caseState, stageId, uniqueTargetIds, now);
      } else if (step.effect === "transfer_to_declared_reserve" && stageId) {
        const unavailable = input.ineligible_participants_by_stage?.[stageId] ?? [];
        if (unavailable.length === 0) {
          const run: EscalationRun = {
            key,
            ladder_id: input.ladder.ladder_id,
            step_id: step.id,
            stage_id: stageId,
            due_at: dueAt,
            executed_at: now,
            status: "suppressed",
            reason: "no_ineligible_participant_to_transfer",
            target_ids: uniqueTargetIds,
            target_sources: uniqueSources,
          };
          runtime.runs.push(run);
          newRuns.push(run);
          continue;
        }
        caseState = transferPolicyParticipant(
          input.policy,
          caseState,
          stageId,
          unavailable[0]!,
          uniqueTargetIds[0]!,
          now,
        );
      } else if (step.effect === "terminate") {
        caseState = terminatePolicyCase(caseState, step.outcome!, now, "escalation_terminated_case");
      }

      if (
        step.effect === "notify" ||
        step.effect === "request_incident_acknowledgment" ||
        step.effect === "add_participants" ||
        step.effect === "transfer_to_declared_reserve"
      ) {
        for (const recipientId of uniqueTargetIds) {
          notificationIntents.push({
            idempotency_key: `${key}:${recipientId}`,
            ...(stageId === undefined ? {} : { stage_id: stageId }),
            recipient_id: recipientId,
            urgency: step.effect === "request_incident_acknowledgment" ? "critical" : "high",
            reason:
              step.effect === "add_participants"
                ? "participant_added"
                : step.effect === "transfer_to_declared_reserve"
                  ? "participant_transferred"
                  : step.effect,
          });
        }
      }
      const run: EscalationRun = {
        key,
        ladder_id: input.ladder.ladder_id,
        step_id: step.id,
        ...(stageId === undefined ? {} : { stage_id: stageId }),
        due_at: dueAt,
        executed_at: now,
        status: "executed",
        reason: usedFallback ? "executed_with_manager_or_target_fallback" : "executed",
        target_ids: uniqueTargetIds,
        target_sources: uniqueSources,
      };
      runtime.runs.push(run);
      newRuns.push(run);
    }
  }
  return { case_state: caseState, runtime, notification_intents: notificationIntents, new_runs: newRuns };
}
