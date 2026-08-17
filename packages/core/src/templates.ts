import {
  cloneCanonical,
  digestCanonical,
  formatSha256Digest,
} from "./canonical.js";
import {
  sealContextManifest,
  verifyContextManifest,
  type ContextItem,
  type ContextItemType,
  type ContextManifest,
} from "./evidence.js";
import {
  compileApprovalPolicy,
  type ApprovalRule,
  type ApprovalPolicyDocument,
  type CompiledApprovalPolicy,
  type PolicyStage,
} from "./policy.js";
import type { RiskClass } from "./scheduling.js";

export type { RiskClass } from "./scheduling.js";

export const RISK_CLASSES = ["R0", "R1", "R2", "R3", "R4"] as const;

export const TEMPLATE_CANONICALIZATION = "vekinbox-action/v1" as const;

export interface ApprovalActionIntent {
  operation: string;
  resource: Record<string, unknown>;
  arguments: Record<string, unknown>;
  preconditions?: unknown[];
  downstream_idempotency_key?: string;
  canonicalization?: typeof TEMPLATE_CANONICALIZATION;
}

export interface TemplateActionRequirements {
  /** Exact, published operation names. Wildcards are deliberately unsupported. */
  operations: readonly string[];
  required_resource_fields?: readonly string[];
  required_argument_paths?: readonly string[];
  require_downstream_idempotency_key?: boolean;
}

export interface TemplateContextRequirement {
  type: ContextItemType;
  min_items?: number;
}

export interface ApprovalTemplateSource {
  id: string;
  version: number;
  name: string;
  description: string;
  risk_class: RiskClass;
  action_requirements: TemplateActionRequirements;
  context_requirements: readonly TemplateContextRequirement[];
  policy: ApprovalPolicyDocument | CompiledApprovalPolicy;
}

export interface CompiledApprovalTemplate
  extends Omit<ApprovalTemplateSource, "policy"> {
  policy: CompiledApprovalPolicy;
  template_hash: string;
}

export interface BoundTemplateApproval {
  template_id: string;
  template_version: number;
  template_hash: string;
  risk_class: RiskClass;
  policy: CompiledApprovalPolicy;
  canonical_action: ApprovalActionIntent;
  /** v3 wire-facing digest, always explicitly algorithm-prefixed. */
  action_digest: string;
  context_manifest: ContextManifest;
  /** v3 wire-facing digest, always explicitly algorithm-prefixed. */
  context_manifest_digest: string;
}

export class TemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TemplateValidationError(`${name} must be a non-empty string`);
  }
  return value;
}

function validatePath(path: string, name: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(path)) {
    throw new TemplateValidationError(`${name} contains an invalid field path '${path}'`);
  }
}

function valueAtPath(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function hasRequiredValue(value: unknown): boolean {
  return value !== undefined && value !== null && (typeof value !== "string" || value.trim().length > 0);
}

function compilePinnedPolicy(
  source: ApprovalTemplateSource["policy"],
): CompiledApprovalPolicy {
  if ("compiler_version" in source) {
    const compiled = compileApprovalPolicy(source.source);
    if (compiled.policy_hash !== source.policy_hash) {
      throw new TemplateValidationError("compiled template policy hash does not match its source");
    }
    return compiled;
  }
  return compileApprovalPolicy(source);
}

function copyActionRequirements(
  input: TemplateActionRequirements,
): TemplateActionRequirements {
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    throw new TemplateValidationError("action_requirements.operations must be a non-empty array");
  }
  const operations = input.operations.map((operation) => {
    const value = requireNonEmptyString(operation, "action_requirements.operations");
    if (!/^[a-z][a-z0-9_.-]*$/.test(value)) {
      throw new TemplateValidationError(`operation '${value}' is not a stable operation identifier`);
    }
    return value;
  });
  if (new Set(operations).size !== operations.length) {
    throw new TemplateValidationError("action_requirements.operations cannot contain duplicates");
  }
  const copyPaths = (paths: readonly string[] | undefined, name: string): string[] | undefined => {
    if (paths === undefined) return undefined;
    if (!Array.isArray(paths)) {
      throw new TemplateValidationError(`${name} must be an array`);
    }
    const copied = paths.map((path) => {
      const value = requireNonEmptyString(path, name);
      validatePath(value, name);
      return value;
    });
    if (new Set(copied).size !== copied.length) {
      throw new TemplateValidationError(`${name} cannot contain duplicates`);
    }
    return copied;
  };
  const resourceFields = copyPaths(
    input.required_resource_fields,
    "action_requirements.required_resource_fields",
  );
  const argumentPaths = copyPaths(
    input.required_argument_paths,
    "action_requirements.required_argument_paths",
  );
  if (
    input.require_downstream_idempotency_key !== undefined &&
    typeof input.require_downstream_idempotency_key !== "boolean"
  ) {
    throw new TemplateValidationError("action_requirements.require_downstream_idempotency_key must be a boolean");
  }
  return {
    operations,
    ...(resourceFields === undefined ? {} : { required_resource_fields: resourceFields }),
    ...(argumentPaths === undefined ? {} : { required_argument_paths: argumentPaths }),
    ...(input.require_downstream_idempotency_key === undefined
      ? {}
      : { require_downstream_idempotency_key: input.require_downstream_idempotency_key }),
  };
}

function copyContextRequirements(
  input: readonly TemplateContextRequirement[],
): TemplateContextRequirement[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new TemplateValidationError("context_requirements must be a non-empty array");
  }
  const requirements = input.map((requirement, index) => {
    if (!requirement || typeof requirement !== "object") {
      throw new TemplateValidationError(`context_requirements[${index}] must be an object`);
    }
    const { type, min_items: minItems } = requirement;
    if (
      ![
        "structured_fields",
        "diff",
        "log_bundle",
        "screenshot",
        "artifact",
        "external_link",
        "reviewer_instruction",
        "decision_evidence",
      ].includes(type)
    ) {
      throw new TemplateValidationError(`context_requirements[${index}].type is unsupported`);
    }
    if (minItems !== undefined && (!Number.isInteger(minItems) || minItems <= 0)) {
      throw new TemplateValidationError(`context_requirements[${index}].min_items must be a positive integer`);
    }
    return { type, ...(minItems === undefined ? {} : { min_items: minItems }) };
  });
  if (new Set(requirements.map((requirement) => requirement.type)).size !== requirements.length) {
    throw new TemplateValidationError("context_requirements cannot repeat an item type");
  }
  return requirements;
}

/**
 * Compiles a human-authored template into a pinned policy/action/context contract.
 * It never accepts a caller-provided policy override or an unbounded operation.
 */
export function compileApprovalTemplate(
  source: ApprovalTemplateSource,
): CompiledApprovalTemplate {
  const id = requireNonEmptyString(source.id, "template.id");
  if (!/^tmpl_[A-Za-z0-9_-]+$/.test(id)) {
    throw new TemplateValidationError("template.id must use the tmpl_ prefix");
  }
  if (!Number.isInteger(source.version) || source.version <= 0) {
    throw new TemplateValidationError("template.version must be a positive integer");
  }
  const name = requireNonEmptyString(source.name, "template.name");
  const description = requireNonEmptyString(source.description, "template.description");
  if (!RISK_CLASSES.includes(source.risk_class)) {
    throw new TemplateValidationError("template.risk_class is unsupported");
  }
  const actionRequirements = copyActionRequirements(source.action_requirements);
  const contextRequirements = copyContextRequirements(source.context_requirements);
  const policy = compilePinnedPolicy(source.policy);
  const hashPayload = {
    id,
    version: source.version,
    name,
    description,
    risk_class: source.risk_class,
    action_requirements: actionRequirements,
    context_requirements: contextRequirements,
    policy_hash: policy.policy_hash,
  };
  return {
    id,
    version: source.version,
    name,
    description,
    risk_class: source.risk_class,
    action_requirements: actionRequirements,
    context_requirements: contextRequirements,
    policy,
    template_hash: digestCanonical(hashPayload),
  };
}

/** Validates and canonicalizes one immutable action against a published template. */
export function canonicalizeTemplateAction(
  template: CompiledApprovalTemplate,
  input: ApprovalActionIntent,
): ApprovalActionIntent {
  const operation = requireNonEmptyString(input.operation, "action.operation");
  if (!template.action_requirements.operations.includes(operation)) {
    throw new TemplateValidationError(
      `action.operation '${operation}' is not allowed by template '${template.id}'`,
    );
  }
  if (!isRecord(input.resource) || !isRecord(input.arguments)) {
    throw new TemplateValidationError("action.resource and action.arguments must be plain objects");
  }
  for (const field of template.action_requirements.required_resource_fields ?? []) {
    if (!hasRequiredValue(valueAtPath(input.resource, field))) {
      throw new TemplateValidationError(`action.resource.${field} is required by template '${template.id}'`);
    }
  }
  for (const path of template.action_requirements.required_argument_paths ?? []) {
    if (!hasRequiredValue(valueAtPath(input.arguments, path))) {
      throw new TemplateValidationError(`action.arguments.${path} is required by template '${template.id}'`);
    }
  }
  if (
    template.action_requirements.require_downstream_idempotency_key &&
    !hasRequiredValue(input.downstream_idempotency_key)
  ) {
    throw new TemplateValidationError(
      `action.downstream_idempotency_key is required by template '${template.id}'`,
    );
  }
  if (
    input.canonicalization !== undefined &&
    input.canonicalization !== TEMPLATE_CANONICALIZATION
  ) {
    throw new TemplateValidationError("action.canonicalization is unsupported");
  }
  const action = {
    operation,
    resource: input.resource,
    arguments: input.arguments,
    ...(input.preconditions === undefined ? {} : { preconditions: input.preconditions }),
    ...(input.downstream_idempotency_key === undefined
      ? {}
      : { downstream_idempotency_key: input.downstream_idempotency_key }),
    canonicalization: TEMPLATE_CANONICALIZATION,
  };
  // cloneCanonical both makes a safe copy and rejects non-canonical JS values.
  return cloneCanonical(action) as ApprovalActionIntent;
}

function canonicalizeManifest(
  context: ContextManifest | readonly ContextItem[],
): ContextManifest {
  if (Array.isArray(context)) {
    return sealContextManifest(context);
  }
  const manifest = context as ContextManifest;
  if (!verifyContextManifest(manifest)) {
    throw new TemplateValidationError("context manifest digest is invalid");
  }
  // Re-seal to normalize item ordering and optional digest prefix spelling.
  return sealContextManifest(manifest.items);
}

function assertContextRequirements(
  template: CompiledApprovalTemplate,
  manifest: ContextManifest,
): void {
  for (const requirement of template.context_requirements) {
    const count = manifest.items.filter((item) => item.type === requirement.type).length;
    if (count < (requirement.min_items ?? 1)) {
      throw new TemplateValidationError(
        `template '${template.id}' requires ${requirement.min_items ?? 1} context item(s) of type '${requirement.type}'`,
      );
    }
  }
}

/**
 * Pins a policy/template version to one canonical action and sealed context
 * manifest. The return value is safe to pass to the policy engine/API boundary.
 */
export function bindApprovalTemplate(
  template: CompiledApprovalTemplate,
  input: { action: ApprovalActionIntent; context: ContextManifest | readonly ContextItem[] },
): BoundTemplateApproval {
  const canonicalAction = canonicalizeTemplateAction(template, input.action);
  const manifest = canonicalizeManifest(input.context);
  assertContextRequirements(template, manifest);
  return {
    template_id: template.id,
    template_version: template.version,
    template_hash: template.template_hash,
    risk_class: template.risk_class,
    policy: template.policy,
    canonical_action: canonicalAction,
    action_digest: formatSha256Digest(digestCanonical(canonicalAction)),
    context_manifest: manifest,
    context_manifest_digest: formatSha256Digest(manifest.context_manifest_digest),
  };
}

function policy(
  name: string,
  stages: ApprovalPolicyDocument["spec"]["workflow"]["stages"],
  options?: {
    distinct?: boolean;
    effective?: boolean;
    /** Scheduled opening is allowed only by an explicitly published template. */
    open?: boolean;
    completion?: ApprovalPolicyDocument["spec"]["workflow"]["case_completion"];
  },
): ApprovalPolicyDocument {
  return {
    apiVersion: "vekinbox/v3",
    kind: "ApprovalPolicy",
    metadata: { name, scope: "project" },
    spec: {
      safety: {
        timeout_outcome: "decline",
        ...(options?.distinct ? { require_distinct_humans: true } : {}),
      },
      workflow: {
        case_completion: options?.completion ?? { kind: "all_required_stages" },
        stages,
      },
      ...(options?.effective || options?.open
        ? {
            scheduling: {
              allow_open_at: options?.open === true,
              allow_effective_at: options?.effective === true,
              ...(options?.effective ? { require_recheck_before_effective: true } : {}),
            },
          }
        : {}),
    },
  };
}

const decisionStage = (
  id: string,
  resolver: string,
  approvalRule: ApprovalRule,
  dependsOn: string[] = [],
): PolicyStage => ({
  id,
  activation: { depends_on: dependsOn, dependency_join: "all_satisfied" as const },
  approval_rule: approvalRule,
  participants: { resolver, on_eligibility_loss: "block_and_escalate" as const },
  decisions: {
    allow: ["approve", "decline", "request_changes"],
    decline_effect: "block_case" as const,
  },
  deadline: { anchor: "stage_opened" as const, after: "PT45M" },
});

/** Published, opinionated starting points for common consequential actions. */
export const BUILTIN_APPROVAL_TEMPLATES: readonly CompiledApprovalTemplate[] = Object.freeze([
  compileApprovalTemplate({
    id: "tmpl_production_deployment",
    version: 1,
    name: "Production deployment",
    description: "Release one immutable production artifact under engineering and change-manager review.",
    risk_class: "R3",
    action_requirements: {
      operations: ["deployment.release"],
      required_resource_fields: ["kind", "id", "environment"],
      required_argument_paths: ["artifact_digest", "strategy", "max_unavailable"],
      require_downstream_idempotency_key: true,
    },
    context_requirements: [
      { type: "diff" },
      { type: "artifact" },
      { type: "external_link" },
      { type: "structured_fields" },
    ],
    policy: policy(
      "production-deployment",
      [
        {
          ...decisionStage(
            "engineering",
            "release_engineering",
            { kind: "quorum", required_count: 2, denominator: "snapshot_at_stage_open" },
          ),
          participants: {
            resolver: "release_engineering",
            on_eligibility_loss: "block_and_escalate",
            escalation_additions: { allowed: true, count_toward_rule: true },
          },
        },
        decisionStage("change-manager", "change_managers", { kind: "any_of" }, ["engineering"]),
      ],
      { distinct: true, effective: true, open: true },
    ),
  }),
  compileApprovalTemplate({
    id: "tmpl_configuration_change",
    version: 1,
    name: "Configuration change",
    description: "Review a bounded before/after configuration change with an owner.",
    risk_class: "R2",
    action_requirements: {
      operations: ["configuration.change"],
      required_resource_fields: ["kind", "id", "environment"],
      required_argument_paths: ["before", "after"],
    },
    context_requirements: [{ type: "diff" }, { type: "structured_fields" }],
    policy: policy(
      "configuration-change",
      [decisionStage("resource-owner", "resource_owners", { kind: "any_of" })],
      { open: true },
    ),
  }),
  compileApprovalTemplate({
    id: "tmpl_monetary_action",
    version: 1,
    name: "Monetary action",
    description: "Authorize a bound payment with finance and security separation of duties.",
    risk_class: "R4",
    action_requirements: {
      operations: ["payment.execute"],
      required_resource_fields: ["kind", "id"],
      required_argument_paths: ["payee", "amount", "currency", "source_account", "payment_idempotency_key"],
      require_downstream_idempotency_key: true,
    },
    context_requirements: [{ type: "structured_fields" }, { type: "external_link" }],
    policy: policy(
      "monetary-action",
      [
        decisionStage(
          "finance",
          "finance_approvers",
          { kind: "quorum", required_count: 2, denominator: "snapshot_at_stage_open" },
        ),
        decisionStage("security", "security_approvers", { kind: "any_of" }),
      ],
      { distinct: true, open: true },
    ),
  }),
  compileApprovalTemplate({
    id: "tmpl_data_export",
    version: 1,
    name: "Data export or sharing",
    description: "Authorize a named dataset recipient and legal basis under data-owner and privacy review.",
    risk_class: "R4",
    action_requirements: {
      operations: ["data.export"],
      required_resource_fields: ["kind", "id"],
      required_argument_paths: ["dataset", "recipient", "legal_basis", "expiry"],
      require_downstream_idempotency_key: true,
    },
    context_requirements: [{ type: "structured_fields" }, { type: "external_link" }],
    policy: policy(
      "data-export",
      [
        decisionStage("data-owner", "data_owners", { kind: "any_of" }),
        decisionStage("privacy-security", "privacy_security", { kind: "any_of" }),
      ],
      { distinct: true, open: true },
    ),
  }),
  compileApprovalTemplate({
    id: "tmpl_privileged_access",
    version: 1,
    name: "Privileged access",
    description: "Grant time-bounded access after manager and security review.",
    risk_class: "R3",
    action_requirements: {
      operations: ["access.grant"],
      required_resource_fields: ["kind", "id", "environment"],
      required_argument_paths: ["principal", "privilege", "duration"],
    },
    context_requirements: [{ type: "structured_fields" }, { type: "external_link" }],
    policy: policy(
      "privileged-access",
      [
        decisionStage("manager", "subject_manager", { kind: "any_of" }),
        decisionStage("security", "security_on_call", { kind: "any_of" }, ["manager"]),
      ],
      { distinct: true, effective: true, open: true },
    ),
  }),
]);

export function listBuiltinApprovalTemplates(): readonly CompiledApprovalTemplate[] {
  return BUILTIN_APPROVAL_TEMPLATES;
}

export function getBuiltinApprovalTemplate(id: string): CompiledApprovalTemplate {
  const template = BUILTIN_APPROVAL_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) {
    throw new RangeError(`Unknown built-in approval template '${id}'`);
  }
  return template;
}
