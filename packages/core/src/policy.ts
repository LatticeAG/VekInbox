import {
  cloneCanonical,
  digestCanonical,
  isSha256Digest,
  normalizeSha256Digest,
} from "./canonical.js";

export const POLICY_API_VERSION = "vekinbox/v3" as const;
export const POLICY_KIND = "ApprovalPolicy" as const;

export type TimeoutOutcome =
  | "decline"
  | "expire"
  | "continue_escalation"
  | "cancel_to_requestor";
export type ApprovalRuleKind =
  | "single"
  | "any_of"
  | "all_of"
  | "quorum"
  | "acknowledgment";
export type DecisionKind = "approve" | "decline" | "request_changes" | "acknowledge";
export type StageState = "pending" | "open" | "satisfied" | "blocked" | "timed_out";
export type CaseLifecycle =
  | "scheduled"
  | "open"
  | "awaiting_effective_time"
  | "resolved"
  | "expired"
  | "cancelled"
  | "superseded";
export type CaseOutcome =
  | "approved"
  | "declined"
  | "revision_requested"
  | "expired"
  | "cancelled";

export interface PolicyIssue {
  path: string;
  message: string;
}

export class PolicyValidationError extends Error {
  readonly issues: readonly PolicyIssue[];

  constructor(issues: readonly PolicyIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "PolicyValidationError";
    this.issues = issues;
  }
}

export interface ApprovalRule {
  kind: ApprovalRuleKind;
  /** Required only for a quorum. The participant snapshot is always the denominator. */
  required_count?: number;
  denominator?: "snapshot_at_stage_open";
}

export interface StageActivation {
  depends_on: string[];
  dependency_join: "all_satisfied" | "any_satisfied";
}

export interface StageParticipants {
  /** Static participants are convenient for local and self-hosted policy definitions. */
  ids?: string[];
  /** A host-owned resolver name. The engine receives its result when a stage opens. */
  resolver?: string;
  on_eligibility_loss?: "block_and_escalate" | "transfer_to_declared_reserve" | "restart_stage";
  escalation_additions?: {
    allowed: boolean;
    count_toward_rule?: boolean;
  };
}

export interface StageDecisions {
  allow: DecisionKind[];
  decline_effect?: "block_case" | "block_stage" | "record_only";
}

export interface DeadlineSpec {
  anchor: "case_opened" | "stage_opened" | "last_delivery_attempted";
  after: string;
}

export interface PolicyStage {
  id: string;
  activation: StageActivation;
  approval_rule: ApprovalRule;
  participants: StageParticipants;
  decisions: StageDecisions;
  deadline?: DeadlineSpec;
}

export interface CaseCompletion {
  kind: "all_required_stages" | "any_stage" | "quorum_of_stages";
  required_count?: number;
}

export interface ApprovalPolicyDocument {
  apiVersion: typeof POLICY_API_VERSION;
  kind: typeof POLICY_KIND;
  metadata: {
    name: string;
    scope: "tenant" | "project" | "workspace";
  };
  spec: {
    assurance?: {
      minimum?: string;
    };
    safety: {
      timeout_outcome: TimeoutOutcome;
      require_distinct_humans?: boolean;
    };
    workflow: {
      case_completion: CaseCompletion;
      stages: PolicyStage[];
    };
    scheduling?: {
      allow_open_at?: boolean;
      allow_effective_at?: boolean;
      require_recheck_before_effective?: boolean;
    };
  };
}

export interface CompiledDeadline {
  anchor: DeadlineSpec["anchor"];
  after_ms: number;
}

export interface CompiledPolicyStage extends Omit<PolicyStage, "deadline"> {
  order: number;
  deadline?: CompiledDeadline;
}

export interface CompiledApprovalPolicy {
  compiler_version: "v3-core-1";
  policy_hash: string;
  source: ApprovalPolicyDocument;
  stages: CompiledPolicyStage[];
  stage_by_id: Record<string, CompiledPolicyStage>;
  timeout_outcome: TimeoutOutcome;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, path: string, issues: PolicyIssue[]): UnknownRecord {
  if (!isRecord(value)) {
    issues.push({ path, message: "must be an object" });
    return {};
  }
  return value;
}

function rejectUnknownKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
  issues: PolicyIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push({ path: `${path}.${key}`, message: "is not allowed" });
    }
  }
}

function requiredString(value: unknown, path: string, issues: PolicyIssue[]): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ path, message: "must be a non-empty string" });
    return "";
  }
  return value;
}

function optionalString(value: unknown, path: string, issues: PolicyIssue[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, path, issues);
}

function requiredEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
  issues: PolicyIssue[],
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    issues.push({ path, message: `must be one of: ${values.join(", ")}` });
    return values[0]!;
  }
  return value as T;
}

function optionalBoolean(value: unknown, path: string, issues: PolicyIssue[]): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    issues.push({ path, message: "must be a boolean" });
    return undefined;
  }
  return value;
}

function stringArray(value: unknown, path: string, issues: PolicyIssue[]): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    issues.push({ path, message: "must be an array of non-empty strings" });
    return [];
  }
  return [...value];
}

/** Parse a bounded ISO-8601 duration into milliseconds. Calendar months/years are rejected. */
export function parsePolicyDuration(value: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    value,
  );
  if (!match) {
    throw new TypeError(`Unsupported duration '${value}'. Use an ISO-8601 day/time duration.`);
  }
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  const milliseconds =
    Number(days) * 86_400_000 +
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new TypeError(`Duration '${value}' must be greater than zero.`);
  }
  return milliseconds;
}

function parseDeadline(value: unknown, path: string, issues: PolicyIssue[]): DeadlineSpec | undefined {
  if (value === undefined) {
    return undefined;
  }
  const source = asRecord(value, path, issues);
  rejectUnknownKeys(source, ["anchor", "after"], path, issues);
  const anchor = requiredEnum(
    source["anchor"],
    ["case_opened", "stage_opened", "last_delivery_attempted"] as const,
    `${path}.anchor`,
    issues,
  );
  const after = requiredString(source["after"], `${path}.after`, issues);
  try {
    parsePolicyDuration(after);
  } catch (error) {
    issues.push({ path: `${path}.after`, message: error instanceof Error ? error.message : "invalid duration" });
  }
  return { anchor, after };
}

function parseStage(value: unknown, index: number, issues: PolicyIssue[]): PolicyStage {
  const path = `spec.workflow.stages[${index}]`;
  const source = asRecord(value, path, issues);
  rejectUnknownKeys(
    source,
    ["id", "activation", "approval_rule", "participants", "decisions", "deadline"],
    path,
    issues,
  );

  const activationSource = asRecord(source["activation"], `${path}.activation`, issues);
  rejectUnknownKeys(activationSource, ["depends_on", "dependency_join"], `${path}.activation`, issues);
  const activation: StageActivation = {
    depends_on: stringArray(activationSource["depends_on"], `${path}.activation.depends_on`, issues),
    dependency_join: requiredEnum(
      activationSource["dependency_join"],
      ["all_satisfied", "any_satisfied"] as const,
      `${path}.activation.dependency_join`,
      issues,
    ),
  };

  const ruleSource = asRecord(source["approval_rule"], `${path}.approval_rule`, issues);
  rejectUnknownKeys(ruleSource, ["kind", "required_count", "denominator"], `${path}.approval_rule`, issues);
  const ruleKind = requiredEnum(
    ruleSource["kind"],
    ["single", "any_of", "all_of", "quorum", "acknowledgment"] as const,
    `${path}.approval_rule.kind`,
    issues,
  );
  const requiredCountValue = ruleSource["required_count"];
  let requiredCount: number | undefined;
  if (requiredCountValue !== undefined) {
    if (!Number.isInteger(requiredCountValue) || (requiredCountValue as number) <= 0) {
      issues.push({ path: `${path}.approval_rule.required_count`, message: "must be a positive integer" });
    } else {
      requiredCount = requiredCountValue as number;
    }
  }
  const denominatorValue = ruleSource["denominator"];
  const denominator =
    denominatorValue === undefined
      ? undefined
      : requiredEnum(
          denominatorValue,
          ["snapshot_at_stage_open"] as const,
          `${path}.approval_rule.denominator`,
          issues,
        );
  if (ruleKind === "quorum" && (requiredCount === undefined || denominator === undefined)) {
    issues.push({
      path: `${path}.approval_rule`,
      message: "quorum requires required_count and denominator: snapshot_at_stage_open",
    });
  }
  if (ruleKind !== "quorum" && (requiredCount !== undefined || denominator !== undefined)) {
    issues.push({ path: `${path}.approval_rule`, message: "only quorum may define required_count or denominator" });
  }

  const participantsSource = asRecord(source["participants"], `${path}.participants`, issues);
  rejectUnknownKeys(
    participantsSource,
    ["ids", "resolver", "on_eligibility_loss", "escalation_additions"],
    `${path}.participants`,
    issues,
  );
  let ids: string[] | undefined;
  if (participantsSource["ids"] !== undefined) {
    ids = stringArray(participantsSource["ids"], `${path}.participants.ids`, issues);
    if (new Set(ids).size !== ids.length) {
      issues.push({ path: `${path}.participants.ids`, message: "cannot contain duplicates" });
    }
  }
  const resolver = optionalString(participantsSource["resolver"], `${path}.participants.resolver`, issues);
  if ((!ids || ids.length === 0) && !resolver) {
    issues.push({ path: `${path}.participants`, message: "must define ids or resolver" });
  }
  const eligibilityLossValue = participantsSource["on_eligibility_loss"];
  const onEligibilityLoss =
    eligibilityLossValue === undefined
      ? undefined
      : requiredEnum(
          eligibilityLossValue,
          ["block_and_escalate", "transfer_to_declared_reserve", "restart_stage"] as const,
          `${path}.participants.on_eligibility_loss`,
          issues,
        );
  let escalationAdditions: StageParticipants["escalation_additions"];
  if (participantsSource["escalation_additions"] !== undefined) {
    const additionsSource = asRecord(
      participantsSource["escalation_additions"],
      `${path}.participants.escalation_additions`,
      issues,
    );
    rejectUnknownKeys(additionsSource, ["allowed", "count_toward_rule"], `${path}.participants.escalation_additions`, issues);
    const allowed = optionalBoolean(
      additionsSource["allowed"],
      `${path}.participants.escalation_additions.allowed`,
      issues,
    );
    if (allowed === undefined) {
      issues.push({ path: `${path}.participants.escalation_additions.allowed`, message: "is required" });
    }
    escalationAdditions = {
      allowed: allowed ?? false,
      ...(optionalBoolean(
        additionsSource["count_toward_rule"],
        `${path}.participants.escalation_additions.count_toward_rule`,
        issues,
      ) === undefined
        ? {}
        : {
            count_toward_rule: additionsSource["count_toward_rule"] as boolean,
          }),
    };
  }

  const decisionsSource = asRecord(source["decisions"], `${path}.decisions`, issues);
  rejectUnknownKeys(decisionsSource, ["allow", "decline_effect"], `${path}.decisions`, issues);
  const allow = stringArray(decisionsSource["allow"], `${path}.decisions.allow`, issues).filter(
    (decision): decision is DecisionKind =>
      ["approve", "decline", "request_changes", "acknowledge"].includes(decision),
  );
  const rawAllow = decisionsSource["allow"];
  if (Array.isArray(rawAllow) && allow.length !== rawAllow.length) {
    issues.push({ path: `${path}.decisions.allow`, message: "contains an unsupported decision" });
  }
  if (allow.length === 0) {
    issues.push({ path: `${path}.decisions.allow`, message: "must contain at least one decision" });
  }
  const declineEffectValue = decisionsSource["decline_effect"];
  const declineEffect =
    declineEffectValue === undefined
      ? undefined
      : requiredEnum(
          declineEffectValue,
          ["block_case", "block_stage", "record_only"] as const,
          `${path}.decisions.decline_effect`,
          issues,
        );

  if (ruleKind === "single" && ids && ids.length !== 1) {
    issues.push({ path: `${path}.participants.ids`, message: "single requires exactly one static participant" });
  }
  if (ruleKind === "quorum" && ids && requiredCount && requiredCount > ids.length) {
    issues.push({ path: `${path}.approval_rule.required_count`, message: "cannot exceed the participant snapshot" });
  }

  const deadline = parseDeadline(source["deadline"], `${path}.deadline`, issues);
  return {
    id: requiredString(source["id"], `${path}.id`, issues),
    activation,
    approval_rule: {
      kind: ruleKind,
      ...(requiredCount === undefined ? {} : { required_count: requiredCount }),
      ...(denominator === undefined ? {} : { denominator }),
    },
    participants: {
      ...(ids === undefined ? {} : { ids }),
      ...(resolver === undefined ? {} : { resolver }),
      ...(onEligibilityLoss === undefined ? {} : { on_eligibility_loss: onEligibilityLoss }),
      ...(escalationAdditions === undefined ? {} : { escalation_additions: escalationAdditions }),
    },
    decisions: {
      allow,
      ...(declineEffect === undefined ? {} : { decline_effect: declineEffect }),
    },
    ...(deadline === undefined ? {} : { deadline }),
  };
}

/**
 * Parses the normative JSON form. YAML belongs at the caller boundary: it must be
 * converted to JSON before this function so the runtime never evaluates YAML magic.
 */
export function parseApprovalPolicy(source: unknown): ApprovalPolicyDocument {
  let parsedSource = source;
  if (typeof source === "string") {
    try {
      parsedSource = JSON.parse(source) as unknown;
    } catch {
      throw new PolicyValidationError([
        { path: "$", message: "must be valid JSON; YAML is an authoring concern" },
      ]);
    }
  }

  const issues: PolicyIssue[] = [];
  const root = asRecord(parsedSource, "$", issues);
  rejectUnknownKeys(root, ["apiVersion", "kind", "metadata", "spec"], "$", issues);
  const apiVersion = requiredEnum(root["apiVersion"], [POLICY_API_VERSION], "apiVersion", issues);
  const kind = requiredEnum(root["kind"], [POLICY_KIND], "kind", issues);

  const metadataSource = asRecord(root["metadata"], "metadata", issues);
  rejectUnknownKeys(metadataSource, ["name", "scope"], "metadata", issues);
  const metadata = {
    name: requiredString(metadataSource["name"], "metadata.name", issues),
    scope: requiredEnum(
      metadataSource["scope"],
      ["tenant", "project", "workspace"] as const,
      "metadata.scope",
      issues,
    ),
  };

  const specSource = asRecord(root["spec"], "spec", issues);
  rejectUnknownKeys(specSource, ["assurance", "safety", "workflow", "scheduling"], "spec", issues);
  let assurance: ApprovalPolicyDocument["spec"]["assurance"];
  if (specSource["assurance"] !== undefined) {
    const assuranceSource = asRecord(specSource["assurance"], "spec.assurance", issues);
    rejectUnknownKeys(assuranceSource, ["minimum"], "spec.assurance", issues);
    const minimum = optionalString(assuranceSource["minimum"], "spec.assurance.minimum", issues);
    assurance = minimum === undefined ? {} : { minimum };
  }

  const safetySource = asRecord(specSource["safety"], "spec.safety", issues);
  rejectUnknownKeys(safetySource, ["timeout_outcome", "require_distinct_humans"], "spec.safety", issues);
  const timeoutOutcome = requiredEnum(
    safetySource["timeout_outcome"],
    ["decline", "expire", "continue_escalation", "cancel_to_requestor"] as const,
    "spec.safety.timeout_outcome",
    issues,
  );
  const requireDistinctHumans = optionalBoolean(
    safetySource["require_distinct_humans"],
    "spec.safety.require_distinct_humans",
    issues,
  );

  const workflowSource = asRecord(specSource["workflow"], "spec.workflow", issues);
  rejectUnknownKeys(workflowSource, ["case_completion", "stages"], "spec.workflow", issues);
  const completionSource = asRecord(workflowSource["case_completion"], "spec.workflow.case_completion", issues);
  rejectUnknownKeys(completionSource, ["kind", "required_count"], "spec.workflow.case_completion", issues);
  const completionKind = requiredEnum(
    completionSource["kind"],
    ["all_required_stages", "any_stage", "quorum_of_stages"] as const,
    "spec.workflow.case_completion.kind",
    issues,
  );
  const completionRequiredValue = completionSource["required_count"];
  let completionRequiredCount: number | undefined;
  if (completionRequiredValue !== undefined) {
    if (!Number.isInteger(completionRequiredValue) || (completionRequiredValue as number) <= 0) {
      issues.push({ path: "spec.workflow.case_completion.required_count", message: "must be a positive integer" });
    } else {
      completionRequiredCount = completionRequiredValue as number;
    }
  }
  if (completionKind === "quorum_of_stages" && completionRequiredCount === undefined) {
    issues.push({
      path: "spec.workflow.case_completion.required_count",
      message: "is required for quorum_of_stages",
    });
  }
  if (completionKind !== "quorum_of_stages" && completionRequiredCount !== undefined) {
    issues.push({
      path: "spec.workflow.case_completion.required_count",
      message: "is only valid for quorum_of_stages",
    });
  }

  const stagesValue = workflowSource["stages"];
  if (!Array.isArray(stagesValue) || stagesValue.length === 0) {
    issues.push({ path: "spec.workflow.stages", message: "must be a non-empty array" });
  }
  const stages = Array.isArray(stagesValue)
    ? stagesValue.map((stage, index) => parseStage(stage, index, issues))
    : [];
  const ids = stages.map((stage) => stage.id);
  if (new Set(ids).size !== ids.length) {
    issues.push({ path: "spec.workflow.stages", message: "stage ids must be unique" });
  }
  for (const stage of stages) {
    for (const dependency of stage.activation.depends_on) {
      if (!ids.includes(dependency)) {
        issues.push({ path: `stage:${stage.id}.activation.depends_on`, message: `unknown stage '${dependency}'` });
      }
      if (dependency === stage.id) {
        issues.push({ path: `stage:${stage.id}.activation.depends_on`, message: "cannot depend on itself" });
      }
    }
  }
  if (completionKind === "quorum_of_stages" && completionRequiredCount && completionRequiredCount > stages.length) {
    issues.push({
      path: "spec.workflow.case_completion.required_count",
      message: "cannot exceed the number of stages",
    });
  }

  let scheduling: ApprovalPolicyDocument["spec"]["scheduling"];
  if (specSource["scheduling"] !== undefined) {
    const schedulingSource = asRecord(specSource["scheduling"], "spec.scheduling", issues);
    rejectUnknownKeys(
      schedulingSource,
      ["allow_open_at", "allow_effective_at", "require_recheck_before_effective"],
      "spec.scheduling",
      issues,
    );
    const allowOpenAt = optionalBoolean(schedulingSource["allow_open_at"], "spec.scheduling.allow_open_at", issues);
    const allowEffectiveAt = optionalBoolean(
      schedulingSource["allow_effective_at"],
      "spec.scheduling.allow_effective_at",
      issues,
    );
    const recheck = optionalBoolean(
      schedulingSource["require_recheck_before_effective"],
      "spec.scheduling.require_recheck_before_effective",
      issues,
    );
    scheduling = {
      ...(allowOpenAt === undefined ? {} : { allow_open_at: allowOpenAt }),
      ...(allowEffectiveAt === undefined ? {} : { allow_effective_at: allowEffectiveAt }),
      ...(recheck === undefined ? {} : { require_recheck_before_effective: recheck }),
    };
  }

  if (issues.length > 0) {
    throw new PolicyValidationError(issues);
  }

  return {
    apiVersion,
    kind,
    metadata,
    spec: {
      ...(assurance === undefined ? {} : { assurance }),
      safety: {
        timeout_outcome: timeoutOutcome,
        ...(requireDistinctHumans === undefined
          ? {}
          : { require_distinct_humans: requireDistinctHumans }),
      },
      workflow: {
        case_completion: {
          kind: completionKind,
          ...(completionRequiredCount === undefined ? {} : { required_count: completionRequiredCount }),
        },
        stages,
      },
      ...(scheduling === undefined ? {} : { scheduling }),
    },
  };
}

function topologicallyOrderStages(stages: PolicyStage[]): PolicyStage[] {
  const unresolved = new Map(stages.map((stage) => [stage.id, stage]));
  const ordered: PolicyStage[] = [];
  const completed = new Set<string>();
  while (unresolved.size > 0) {
    const next = [...unresolved.values()]
      .filter((stage) => stage.activation.depends_on.every((dependency) => completed.has(dependency)))
      .sort((left, right) => left.id.localeCompare(right.id))[0];
    if (!next) {
      throw new PolicyValidationError([
        { path: "spec.workflow.stages", message: "dependency graph must be acyclic" },
      ]);
    }
    unresolved.delete(next.id);
    completed.add(next.id);
    ordered.push(next);
  }
  return ordered;
}

/** Validates, normalizes and hashes a policy into the deterministic runtime form. */
export function compileApprovalPolicy(source: unknown): CompiledApprovalPolicy {
  const document = parseApprovalPolicy(source);
  const ordered = topologicallyOrderStages(document.spec.workflow.stages);
  const stages = ordered.map((stage, order): CompiledPolicyStage => {
    const { deadline, ...stageWithoutDeadline } = stage;
    return {
      ...stageWithoutDeadline,
      order,
      ...(deadline === undefined
        ? {}
        : {
            deadline: {
              anchor: deadline.anchor,
              after_ms: parsePolicyDuration(deadline.after),
            },
          }),
    };
  });
  const stageById = Object.fromEntries(stages.map((stage) => [stage.id, stage]));
  const normalized = {
    compiler_version: "v3-core-1" as const,
    source: document,
    stages,
  };
  return {
    compiler_version: "v3-core-1",
    policy_hash: digestCanonical(normalized),
    source: document,
    stages,
    stage_by_id: stageById,
    timeout_outcome: document.spec.safety.timeout_outcome,
  };
}

export interface PolicyTraceEntry {
  at: string;
  type: string;
  stage_id?: string;
  reason: string;
  details?: Record<string, string | number | boolean>;
}

export interface RecordedDecision {
  id: string;
  idempotency_key?: string;
  stage_id: string;
  participant_id: string;
  kind: DecisionKind;
  accepted_at: string;
  action_digest: string;
  context_manifest_digest: string;
}

export interface StageRuntime {
  id: string;
  state: StageState;
  /**
   * The immutable voter snapshot plus only escalation additions that a policy
   * explicitly allows to count toward its rule.
   */
  participant_ids: string[];
  /**
   * Escalated people who may be notified or record a response, but whose
   * approval cannot change the original stage threshold.
   */
  non_voting_participant_ids?: string[];
  opened_at?: string;
  deadline_at?: string;
  last_delivery_attempted_at?: string;
  completed_at?: string;
  timed_out_at?: string;
  decision_ids: string[];
}

export interface PolicyCaseState {
  case_id: string;
  policy_hash: string;
  lifecycle: CaseLifecycle;
  outcome: CaseOutcome | null;
  action_digest: string;
  context_manifest_digest: string;
  case_opened_at: string;
  effective_at?: string;
  version: number;
  stages: Record<string, StageRuntime>;
  decisions: RecordedDecision[];
  trace: PolicyTraceEntry[];
}

export interface OpenPolicyCaseInput {
  case_id: string;
  action_digest: string;
  context_manifest_digest: string;
  opened_at?: Date | string;
  effective_at?: Date | string;
  /** Resolver results must be passed in by the host and become the immutable snapshot. */
  participants_by_stage?: Record<string, string[]>;
}

function iso(value: Date | string | undefined, fallback: Date = new Date()): string {
  const date = value === undefined ? fallback : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Expected a valid RFC 3339 instant");
  }
  return date.toISOString();
}

function withTrace(
  state: PolicyCaseState,
  entry: PolicyTraceEntry,
): PolicyCaseState {
  state.trace.push(entry);
  return state;
}

function stageCanOpen(state: PolicyCaseState, stage: CompiledPolicyStage): boolean {
  if (stage.activation.depends_on.length === 0) {
    return true;
  }
  const dependencies = stage.activation.depends_on.map((id) => state.stages[id]!);
  return stage.activation.dependency_join === "all_satisfied"
    ? dependencies.every((dependency) => dependency.state === "satisfied")
    : dependencies.some((dependency) => dependency.state === "satisfied");
}

function openStage(
  state: PolicyCaseState,
  stage: CompiledPolicyStage,
  openedAt: string,
  participantsByStage: Record<string, string[]>,
): void {
  const runtime = state.stages[stage.id]!;
  if (runtime.state !== "pending") {
    return;
  }
  // Static policy participants are authoritative. Host-supplied snapshots are
  // only resolver results; they must never be able to replace a named policy
  // participant set at case-open time.
  const supplied = stage.participants.ids ?? participantsByStage[stage.id] ?? [];
  const participantIds = [...new Set(supplied)].sort();
  if (participantIds.length === 0) {
    runtime.state = "blocked";
    withTrace(state, {
      at: openedAt,
      type: "stage.blocked",
      stage_id: stage.id,
      reason: "participant_resolution_empty",
    });
    return;
  }
  if (stage.approval_rule.kind === "single" && participantIds.length !== 1) {
    runtime.state = "blocked";
    withTrace(state, {
      at: openedAt,
      type: "stage.blocked",
      stage_id: stage.id,
      reason: "single_rule_requires_exactly_one_resolved_participant",
    });
    return;
  }
  runtime.state = "open";
  runtime.participant_ids = participantIds;
  runtime.opened_at = openedAt;
  if (stage.deadline?.anchor === "case_opened") {
    runtime.deadline_at = new Date(
      new Date(state.case_opened_at).getTime() + stage.deadline.after_ms,
    ).toISOString();
  }
  if (stage.deadline?.anchor === "stage_opened") {
    runtime.deadline_at = new Date(new Date(openedAt).getTime() + stage.deadline.after_ms).toISOString();
  }
  withTrace(state, {
    at: openedAt,
    type: "stage.opened",
    stage_id: stage.id,
    reason: "activation_satisfied",
    details: { participant_count: participantIds.length },
  });
}

function openEligibleStages(
  state: PolicyCaseState,
  policy: CompiledApprovalPolicy,
  at: string,
  participantsByStage: Record<string, string[]>,
): void {
  let opened = true;
  while (opened) {
    opened = false;
    for (const stage of policy.stages) {
      const runtime = state.stages[stage.id]!;
      if (runtime.state === "pending" && stageCanOpen(state, stage)) {
        openStage(state, stage, at, participantsByStage);
        opened = true;
      }
    }
  }
}

function closeOtherStages(state: PolicyCaseState, reason: string, at: string): void {
  for (const stage of Object.values(state.stages)) {
    if (stage.state === "open" || stage.state === "pending") {
      stage.state = "blocked";
    }
  }
  withTrace(state, { at, type: "case.stages_closed", reason });
}

function completeCase(
  state: PolicyCaseState,
  outcome: CaseOutcome,
  at: string,
  reason: string,
): void {
  state.outcome = outcome;
  state.lifecycle = outcome === "expired" ? "expired" : outcome === "cancelled" ? "cancelled" : "resolved";
  closeOtherStages(state, reason, at);
  withTrace(state, { at, type: "case.resolved", reason, details: { outcome } });
}

function checkCaseCompletion(state: PolicyCaseState, policy: CompiledApprovalPolicy, at: string): void {
  if (state.lifecycle !== "open") {
    return;
  }
  const stages = policy.stages.map((stage) => state.stages[stage.id]!);
  const completion = policy.source.spec.workflow.case_completion;
  const satisfied = stages.filter((stage) => stage.state === "satisfied").length;
  const complete =
    completion.kind === "all_required_stages"
      ? stages.every((stage) => stage.state === "satisfied")
      : completion.kind === "any_stage"
        ? satisfied >= 1
        : satisfied >= (completion.required_count ?? Number.POSITIVE_INFINITY);
  if (!complete) {
    return;
  }
  const effectiveAt = state.effective_at ? new Date(state.effective_at).getTime() : undefined;
  if (effectiveAt !== undefined && effectiveAt > new Date(at).getTime()) {
    state.lifecycle = "awaiting_effective_time";
    state.outcome = "approved";
    closeOtherStages(state, "policy_satisfied_waiting_for_effective_time", at);
    withTrace(state, { at, type: "case.awaiting_effective_time", reason: "policy_satisfied" });
    return;
  }
  completeCase(state, "approved", at, "policy_satisfied");
}

/** Builds an immutable participant snapshot and opens all root stages. */
export function openPolicyCase(
  policy: CompiledApprovalPolicy,
  input: OpenPolicyCaseInput,
): PolicyCaseState {
  if (!input.case_id) {
    throw new TypeError("case_id is required");
  }
  if (!isSha256Digest(input.action_digest) || !isSha256Digest(input.context_manifest_digest)) {
    throw new TypeError("action_digest and context_manifest_digest must be SHA-256 hex digests");
  }
  const actionDigest = normalizeSha256Digest(input.action_digest);
  const contextManifestDigest = normalizeSha256Digest(input.context_manifest_digest);
  const openedAt = iso(input.opened_at);
  const effectiveAt = input.effective_at === undefined ? undefined : iso(input.effective_at);
  if (effectiveAt && policy.source.spec.scheduling?.allow_effective_at !== true) {
    throw new TypeError("effective_at is not allowed by this policy");
  }
  if (effectiveAt && new Date(effectiveAt).getTime() <= new Date(openedAt).getTime()) {
    throw new TypeError("effective_at must be after case open time");
  }
  const state: PolicyCaseState = {
    case_id: input.case_id,
    policy_hash: policy.policy_hash,
    lifecycle: "open",
    outcome: null,
    action_digest: actionDigest,
    context_manifest_digest: contextManifestDigest,
    case_opened_at: openedAt,
    ...(effectiveAt === undefined ? {} : { effective_at: effectiveAt }),
    version: 1,
    stages: Object.fromEntries(
      policy.stages.map((stage) => [
        stage.id,
        {
          id: stage.id,
          state: "pending",
          participant_ids: [],
          non_voting_participant_ids: [],
          decision_ids: [],
        },
      ]),
    ),
    decisions: [],
    trace: [{ at: openedAt, type: "case.opened", reason: "case_created" }],
  };
  openEligibleStages(state, policy, openedAt, input.participants_by_stage ?? {});
  checkCaseCompletion(state, policy, openedAt);
  return state;
}

export interface PolicyClockResult {
  state: PolicyCaseState;
  timed_out_stage_ids: string[];
}

/**
 * Applies safe stage deadlines. Equal timestamps are late by design. A
 * continue_escalation policy keeps the case open for a capped ladder, but the
 * elapsed decision window is closed until a new delivery explicitly re-arms a
 * `last_delivery_attempted` deadline. Escalation must never turn a late vote
 * into a valid approval.
 */
export function advancePolicyClock(
  policy: CompiledApprovalPolicy,
  prior: PolicyCaseState,
  at: Date | string,
): PolicyClockResult {
  const state = cloneCanonical(prior);
  const now = iso(at);
  const timedOutStageIds: string[] = [];
  if (state.lifecycle !== "open") {
    return { state, timed_out_stage_ids: timedOutStageIds };
  }
  for (const stage of policy.stages) {
    const runtime = state.stages[stage.id]!;
    if (
      runtime.state !== "open" ||
      !runtime.deadline_at ||
      runtime.timed_out_at !== undefined ||
      new Date(now).getTime() < new Date(runtime.deadline_at).getTime()
    ) {
      continue;
    }
    timedOutStageIds.push(stage.id);
    runtime.timed_out_at = now;
    withTrace(state, {
      at: now,
      type: "stage.deadline_reached",
      stage_id: stage.id,
      reason: "deadline_elapsed",
    });
    if (policy.timeout_outcome === "continue_escalation") {
      continue;
    }
    runtime.state = "timed_out";
    if (policy.timeout_outcome === "decline") {
      completeCase(state, "declined", now, "stage_timeout");
    } else if (policy.timeout_outcome === "expire") {
      completeCase(state, "expired", now, "stage_timeout");
    } else {
      completeCase(state, "cancelled", now, "stage_timeout");
    }
    break;
  }
  return { state, timed_out_stage_ids: timedOutStageIds };
}

export function recordPolicyDeliveryAttempt(
  policy: CompiledApprovalPolicy,
  prior: PolicyCaseState,
  stageId: string,
  at: Date | string,
): PolicyCaseState {
  const stage = policy.stage_by_id[stageId];
  if (!stage) {
    throw new RangeError(`Unknown stage '${stageId}'`);
  }
  const state = cloneCanonical(prior);
  const runtime = state.stages[stageId]!;
  const attemptedAt = iso(at);
  runtime.last_delivery_attempted_at = attemptedAt;
  if (stage.deadline?.anchor === "last_delivery_attempted") {
    runtime.deadline_at = new Date(
      new Date(attemptedAt).getTime() + stage.deadline.after_ms,
    ).toISOString();
    // A policy may explicitly re-anchor a continuing-escalation deadline to a
    // fresh delivery attempt. Only that re-anchoring may make it due again.
    delete runtime.timed_out_at;
  }
  withTrace(state, {
    at: attemptedAt,
    type: "delivery.attempted",
    stage_id: stageId,
    reason: "delivery_recorded",
  });
  return state;
}

/** Adds policy-permitted escalation participants without changing a quorum denominator. */
export function addEscalationParticipants(
  policy: CompiledApprovalPolicy,
  prior: PolicyCaseState,
  stageId: string,
  participantIds: readonly string[],
  at: Date | string,
): PolicyCaseState {
  const stage = policy.stage_by_id[stageId];
  if (!stage) {
    throw new RangeError(`Unknown stage '${stageId}'`);
  }
  if (stage.approval_rule.kind === "all_of" || !stage.participants.escalation_additions?.allowed) {
    throw new PolicyValidationError([
      { path: `stage:${stageId}`, message: "does not permit escalation participant additions" },
    ]);
  }
  const state = cloneCanonical(prior);
  const runtime = state.stages[stageId]!;
  if (state.lifecycle !== "open" || runtime.state !== "open") {
    return state;
  }
  const knownParticipants = new Set([
    ...runtime.participant_ids,
    ...(runtime.non_voting_participant_ids ?? []),
  ]);
  const added = [...new Set(participantIds.filter((id) => id.length > 0))]
    .filter((id) => !knownParticipants.has(id))
    .sort();
  if (added.length === 0) {
    return state;
  }
  const countsTowardRule = stage.participants.escalation_additions?.count_toward_rule === true;
  if (countsTowardRule) {
    runtime.participant_ids.push(...added);
    runtime.participant_ids.sort();
  } else {
    runtime.non_voting_participant_ids = [
      ...(runtime.non_voting_participant_ids ?? []),
      ...added,
    ].sort();
  }
  const occurredAt = iso(at);
  state.version += 1;
  withTrace(state, {
    at: occurredAt,
    type: "participant.escalation_added",
    stage_id: stageId,
    reason: "policy_permitted_escalation_addition",
    details: { added_count: added.length, count_toward_rule: countsTowardRule },
  });
  return state;
}

/** Replaces an unavailable all-of slot only through the policy's declared reserve path. */
export function transferPolicyParticipant(
  policy: CompiledApprovalPolicy,
  prior: PolicyCaseState,
  stageId: string,
  unavailableParticipantId: string,
  replacementParticipantId: string,
  at: Date | string,
): PolicyCaseState {
  const stage = policy.stage_by_id[stageId];
  if (!stage) {
    throw new RangeError(`Unknown stage '${stageId}'`);
  }
  if (stage.participants.on_eligibility_loss !== "transfer_to_declared_reserve") {
    throw new PolicyValidationError([
      { path: `stage:${stageId}`, message: "does not allow participant transfer" },
    ]);
  }
  const state = cloneCanonical(prior);
  const runtime = state.stages[stageId]!;
  if (state.lifecycle !== "open" || runtime.state !== "open") {
    return state;
  }
  if (
    !runtime.participant_ids.includes(unavailableParticipantId) ||
    runtime.participant_ids.includes(replacementParticipantId)
  ) {
    return state;
  }
  if (state.decisions.some((decision) => decision.stage_id === stageId && decision.participant_id === unavailableParticipantId)) {
    throw new PolicyValidationError([
      {
        path: `stage:${stageId}`,
        message: "cannot transfer a participant with an immutable recorded decision",
      },
    ]);
  }
  runtime.participant_ids = runtime.participant_ids
    .filter((id) => id !== unavailableParticipantId)
    .concat(replacementParticipantId)
    .sort();
  const occurredAt = iso(at);
  state.version += 1;
  withTrace(state, {
    at: occurredAt,
    type: "participant.transferred",
    stage_id: stageId,
    reason: "declared_reserve_transfer",
  });
  return state;
}

/** A scheduler/escalator can only terminate with a safe non-approval outcome. */
export function terminatePolicyCase(
  prior: PolicyCaseState,
  outcome: "declined" | "expired" | "cancelled",
  at: Date | string,
  reason: string,
): PolicyCaseState {
  if (!( ["declined", "expired", "cancelled"] as const).includes(outcome)) {
    throw new TypeError("A scheduler or escalator may only terminate with declined, expired, or cancelled");
  }
  const state = cloneCanonical(prior);
  if (state.lifecycle !== "open") {
    return state;
  }
  completeCase(state, outcome, iso(at), reason);
  return state;
}

export interface EligibilityCheckInput {
  case_state: PolicyCaseState;
  stage: CompiledPolicyStage;
  participant_id: string;
  at: string;
}

export type EligibilityCheck = (input: EligibilityCheckInput) => boolean | { eligible: boolean; reason?: string };

export interface PolicyDecisionInput {
  id: string;
  idempotency_key?: string;
  stage_id: string;
  participant_id: string;
  kind: DecisionKind;
  action_digest: string;
  context_manifest_digest: string;
  accepted_at?: Date | string;
}

export interface PolicyDecisionResult {
  state: PolicyCaseState;
  accepted: boolean;
  idempotent: boolean;
  reason?: string;
}

function evaluateStageSatisfaction(
  state: PolicyCaseState,
  stage: CompiledPolicyStage,
  runtime: StageRuntime,
  at: string,
): boolean {
  const decisions = state.decisions.filter(
    (decision) =>
      decision.stage_id === stage.id &&
      decision.kind === "approve" &&
      runtime.participant_ids.includes(decision.participant_id),
  );
  const approvers = new Set(decisions.map((decision) => decision.participant_id));
  const required =
    stage.approval_rule.kind === "quorum"
      ? stage.approval_rule.required_count ?? Number.POSITIVE_INFINITY
      : stage.approval_rule.kind === "all_of"
        ? runtime.participant_ids.length
        : stage.approval_rule.kind === "acknowledgment"
          ? 0
          : 1;
  const acknowledgements = new Set(
    state.decisions
      .filter(
        (decision) =>
          decision.stage_id === stage.id &&
          decision.kind === "acknowledge" &&
          runtime.participant_ids.includes(decision.participant_id),
      )
      .map((decision) => decision.participant_id),
  );
  const satisfied =
    stage.approval_rule.kind === "acknowledgment"
      ? acknowledgements.size >= Math.max(1, required)
      : approvers.size >= required;
  if (satisfied) {
    runtime.state = "satisfied";
    runtime.completed_at = at;
    withTrace(state, {
      at,
      type: "stage.satisfied",
      stage_id: stage.id,
      reason: "approval_rule_satisfied",
      details: { counted_decisions: stage.approval_rule.kind === "acknowledgment" ? acknowledgements.size : approvers.size },
    });
  }
  return satisfied;
}

function decisionConflictsWithDistinctHumanRequirement(
  state: PolicyCaseState,
  participantId: string,
  stageId: string,
): boolean {
  return state.decisions.some(
    (decision) =>
      decision.participant_id === participantId &&
      decision.stage_id !== stageId &&
      decision.kind === "approve",
  );
}

/**
 * Submits one decision, rechecking deadline, digest binding, snapshot membership,
 * and current eligibility before it can count toward a stage.
 */
export function submitPolicyDecision(
  policy: CompiledApprovalPolicy,
  prior: PolicyCaseState,
  input: PolicyDecisionInput,
  eligibilityCheck?: EligibilityCheck,
  participantsByStage: Record<string, string[]> = {},
): PolicyDecisionResult {
  const acceptedAt = iso(input.accepted_at);
  const clock = advancePolicyClock(policy, prior, acceptedAt);
  let state = clock.state;
  let actionDigest: string;
  let contextManifestDigest: string;
  try {
    actionDigest = normalizeSha256Digest(input.action_digest);
    contextManifestDigest = normalizeSha256Digest(input.context_manifest_digest);
  } catch {
    return { state, accepted: false, idempotent: false, reason: "invalid_digest" };
  }
  const existing = state.decisions.find(
    (decision) =>
      decision.id === input.id ||
      (input.idempotency_key !== undefined && decision.idempotency_key === input.idempotency_key),
  );
  if (existing) {
    const same =
      existing.stage_id === input.stage_id &&
      existing.participant_id === input.participant_id &&
      existing.kind === input.kind &&
      existing.action_digest === actionDigest &&
      existing.context_manifest_digest === contextManifestDigest;
    return {
      state,
      accepted: same,
      idempotent: same,
      ...(same ? {} : { reason: "decision_idempotency_conflict" }),
    };
  }
  if (state.lifecycle !== "open") {
    return { state, accepted: false, idempotent: false, reason: "case_not_open" };
  }
  if (actionDigest !== state.action_digest || contextManifestDigest !== state.context_manifest_digest) {
    return { state, accepted: false, idempotent: false, reason: "digest_mismatch" };
  }
  const stage = policy.stage_by_id[input.stage_id];
  if (!stage) {
    return { state, accepted: false, idempotent: false, reason: "unknown_stage" };
  }
  const runtime = state.stages[input.stage_id]!;
  if (runtime.state !== "open") {
    return { state, accepted: false, idempotent: false, reason: "stage_not_open" };
  }
  // `continue_escalation` deliberately leaves a stage open so the coordinator
  // can route it. That is not an extension of the original decision window:
  // the stage must be re-armed by a fresh, policy-declared delivery attempt.
  if (runtime.timed_out_at !== undefined) {
    return { state, accepted: false, idempotent: false, reason: "stage_deadline_elapsed" };
  }
  if (
    !runtime.participant_ids.includes(input.participant_id) &&
    !(runtime.non_voting_participant_ids ?? []).includes(input.participant_id)
  ) {
    return { state, accepted: false, idempotent: false, reason: "participant_not_in_snapshot" };
  }
  if (
    (runtime.non_voting_participant_ids ?? []).includes(input.participant_id) &&
    input.kind !== "acknowledge"
  ) {
    return { state, accepted: false, idempotent: false, reason: "participant_not_authorized_to_vote" };
  }
  if (!stage.decisions.allow.includes(input.kind)) {
    return { state, accepted: false, idempotent: false, reason: "decision_not_allowed" };
  }
  if (
    policy.source.spec.safety.require_distinct_humans &&
    input.kind === "approve" &&
    decisionConflictsWithDistinctHumanRequirement(state, input.participant_id, input.stage_id)
  ) {
    return { state, accepted: false, idempotent: false, reason: "distinct_human_requirement" };
  }
  if (eligibilityCheck) {
    const checked = eligibilityCheck({
      case_state: state,
      stage,
      participant_id: input.participant_id,
      at: acceptedAt,
    });
    const eligible = typeof checked === "boolean" ? checked : checked.eligible;
    if (!eligible) {
      return {
        state,
        accepted: false,
        idempotent: false,
        reason: typeof checked === "boolean" ? "participant_ineligible" : checked.reason ?? "participant_ineligible",
      };
    }
  }
  const decision: RecordedDecision = {
    id: input.id,
    ...(input.idempotency_key === undefined ? {} : { idempotency_key: input.idempotency_key }),
    stage_id: input.stage_id,
    participant_id: input.participant_id,
    kind: input.kind,
    accepted_at: acceptedAt,
    action_digest: actionDigest,
    context_manifest_digest: contextManifestDigest,
  };
  state.decisions.push(decision);
  runtime.decision_ids.push(decision.id);
  state.version += 1;
  withTrace(state, {
    at: acceptedAt,
    type: "decision.accepted",
    stage_id: input.stage_id,
    reason: "validated_against_pinned_policy",
  });

  if (input.kind === "request_changes") {
    completeCase(state, "revision_requested", acceptedAt, "revision_requested");
    return { state, accepted: true, idempotent: false };
  }
  if (input.kind === "decline") {
    const effect = stage.decisions.decline_effect ?? "block_case";
    if (effect === "block_case") {
      completeCase(state, "declined", acceptedAt, "declined_by_participant");
      return { state, accepted: true, idempotent: false };
    }
    if (effect === "block_stage") {
      runtime.state = "blocked";
      runtime.completed_at = acceptedAt;
      withTrace(state, {
        at: acceptedAt,
        type: "stage.blocked",
        stage_id: stage.id,
        reason: "declined_by_participant",
      });
      return { state, accepted: true, idempotent: false };
    }
    return { state, accepted: true, idempotent: false };
  }

  evaluateStageSatisfaction(state, stage, runtime, acceptedAt);
  openEligibleStages(state, policy, acceptedAt, participantsByStage);
  checkCaseCompletion(state, policy, acceptedAt);
  return { state, accepted: true, idempotent: false };
}

/** Returns true only once policy satisfaction and any scheduled effective time are complete. */
export interface EffectiveTimeRecheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Moves an already-satisfied case through its scheduled effective time only after
 * the host rechecks action/context freshness and live preconditions.
 */
export function releaseEffectivePolicyCase(
  prior: PolicyCaseState,
  at: Date | string,
  recheck: EffectiveTimeRecheck,
): PolicyCaseState {
  const state = cloneCanonical(prior);
  const now = iso(at);
  if (state.lifecycle !== "awaiting_effective_time" || state.outcome !== "approved") {
    return state;
  }
  if (!state.effective_at || new Date(now).getTime() < new Date(state.effective_at).getTime()) {
    return state;
  }
  if (recheck.allowed !== true) {
    state.lifecycle = "superseded";
    state.outcome = null;
    withTrace(state, {
      at: now,
      type: "case.effective_time_recheck_failed",
      reason: recheck.reason ?? "effective_time_recheck_failed",
    });
    return state;
  }
  state.lifecycle = "resolved";
  withTrace(state, { at: now, type: "execution.release_eligible", reason: "effective_time_recheck_passed" });
  return state;
}

export function isPolicyExecutionReleased(state: PolicyCaseState): boolean {
  return state.outcome === "approved" && state.lifecycle === "resolved";
}
