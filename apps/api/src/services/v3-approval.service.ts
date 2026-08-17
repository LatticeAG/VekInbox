import {
  and,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import {
  approvalCases,
  approvalPolicies,
  approvalTemplates,
  approvalThreads,
  auditLedgerEntries,
  auditLedgerHeads,
  caseStages,
  commandIdempotency,
  contextManifests,
  decisions,
  memberships,
  outbox,
  policyVersions,
  scheduledDecisions,
  scheduleWork,
  stageParticipants,
  templateVersions,
  workspaces,
  type Database,
} from "@latticeag/vekinbox-db";
import {
  bindApprovalTemplate,
  canonicalJson,
  compileApprovalPolicy,
  digestCanonical,
  getBuiltinApprovalTemplate,
  openPolicyCase,
  planScheduledApproval,
  processScheduledApproval,
  sha256Hex,
  submitPolicyDecision,
  type ApprovalActionIntent,
  type ApprovalPolicyDocument,
  type ContextManifest,
  type PolicyCaseState,
} from "@latticeag/vekinbox-core";
import {
  generateId,
  notFound,
  VekInboxError,
} from "@latticeag/vekinbox-shared";
import { getDb } from "../lib/db.js";
import type {
  V3CreateApprovalCaseInput,
  V3DecisionInput,
  V3ScheduledDecisionInput,
} from "../lib/v3-approval-contract.js";
import type { ApiKeyAuth } from "../middleware/auth.js";

type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbExecutor = Database | DbTransaction;

const COMMAND_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const V3_AUDIT_KEY_ID = "v3-local-hash-chain";

type Actor = {
  actorType: "agent" | "user" | "system";
  principalId: string;
};

export type V3Scope = {
  tenantId: string;
  workspaceId: string;
};

type Scope = V3Scope;

type StoredCase = typeof approvalCases.$inferSelect;
type StoredStage = typeof caseStages.$inferSelect;

export interface V3CaseResponse {
  id: string;
  thread_id: string;
  revision_number: number;
  version: number;
  lifecycle: StoredCase["lifecycle"];
  outcome: StoredCase["outcome"];
  risk_class: StoredCase["riskClass"];
  action_digest: string;
  context_manifest_digest: string;
  template_version_id: string;
  policy_version_id: string;
  open_at: string | null;
  effective_at: string | null;
  stages: Array<{
    id: string;
    key: string;
    index: number;
    state: StoredStage["state"];
    deadline_at: string | null;
    participants: string[];
  }>;
  trace: unknown[];
}

export interface V3CommandResult<T> {
  status: 200 | 201 | 202;
  body: T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isoOrNull(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function conflict(message: string, details?: Record<string, unknown>): never {
  throw new VekInboxError("conflict", message, 409, details);
}

function validation(message: string, details?: Record<string, unknown>): never {
  throw new VekInboxError("validation_error", message, 400, details);
}

function toCaseLifecycle(lifecycle: PolicyCaseState["lifecycle"]): StoredCase["lifecycle"] {
  return lifecycle;
}

function toCaseOutcome(outcome: PolicyCaseState["outcome"]): StoredCase["outcome"] {
  return outcome;
}

function toStageState(state: PolicyCaseState["stages"][string]["state"]): StoredStage["state"] {
  return state;
}

function parseRuntimeState(value: unknown, caseId: string): PolicyCaseState {
  const runtime = value as PolicyCaseState;
  if (!runtime || typeof runtime !== "object" || runtime.case_id !== caseId || !runtime.stages) {
    throw new Error(`Approval case ${caseId} has an invalid persisted runtime state`);
  }
  return runtime;
}

function responseForCase(
  row: StoredCase,
  stages: Array<StoredStage & { participants: string[] }>,
): V3CaseResponse {
  const runtime = parseRuntimeState(row.runtimeState, row.id);
  return {
    id: row.id,
    thread_id: row.threadId,
    revision_number: row.revisionNumber,
    version: row.version,
    lifecycle: row.lifecycle,
    outcome: row.outcome,
    risk_class: row.riskClass,
    action_digest: row.actionDigest,
    context_manifest_digest: row.contextManifestDigest,
    template_version_id: row.templateVersionId,
    policy_version_id: row.policyVersionId,
    open_at: isoOrNull(row.openAt),
    effective_at: isoOrNull(row.effectiveAt),
    stages: stages.map((stage) => ({
      id: stage.id,
      key: stage.stageKey,
      index: stage.stageIndex,
      state: stage.state,
      deadline_at: isoOrNull(stage.deadlineAt),
      participants: stage.participants,
    })),
    trace: Array.isArray(runtime.trace) ? runtime.trace : [],
  };
}

async function loadScopedWorkspace(db: DbExecutor, workspaceId: string): Promise<Scope> {
  const [workspace] = await db
    .select({ id: workspaces.id, organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) {
    throw notFound("Project", workspaceId);
  }
  return { tenantId: workspace.organizationId, workspaceId: workspace.id };
}

async function loadCase(
  db: DbExecutor,
  scope: Scope,
  caseId: string,
): Promise<StoredCase> {
  const [row] = await db
    .select()
    .from(approvalCases)
    .where(
      and(
        eq(approvalCases.id, caseId),
        eq(approvalCases.tenantId, scope.tenantId),
        eq(approvalCases.workspaceId, scope.workspaceId),
      ),
    )
    .limit(1);
  if (!row) {
    throw notFound("Approval case", caseId);
  }
  return row;
}

async function loadCaseStages(
  db: DbExecutor,
  scope: Scope,
  caseId: string,
): Promise<Array<StoredStage & { participants: string[] }>> {
  const stageRows = await db
    .select()
    .from(caseStages)
    .where(
      and(
        eq(caseStages.tenantId, scope.tenantId),
        eq(caseStages.workspaceId, scope.workspaceId),
        eq(caseStages.caseId, caseId),
      ),
    )
    .orderBy(caseStages.stageIndex);
  if (stageRows.length === 0) return [];
  const participantRows = await db
    .select({ stageId: stageParticipants.stageId, principalId: stageParticipants.principalId })
    .from(stageParticipants)
    .where(inArray(stageParticipants.stageId, stageRows.map((stage) => stage.id)));
  const participantMap = new Map<string, string[]>();
  for (const participant of participantRows) {
    const ids = participantMap.get(participant.stageId) ?? [];
    ids.push(participant.principalId);
    participantMap.set(participant.stageId, ids);
  }
  return stageRows.map((stage) => ({
    ...stage,
    participants: (participantMap.get(stage.id) ?? []).sort(),
  }));
}

async function existingCommand(
  db: DbExecutor,
  scope: Scope,
  principalId: string,
  method: string,
  route: string,
  idempotencyKey: string,
  requestHash: string,
): Promise<Record<string, unknown> | null> {
  const [command] = await db
    .select()
    .from(commandIdempotency)
    .where(
      and(
        eq(commandIdempotency.tenantId, scope.tenantId),
        eq(commandIdempotency.workspaceId, scope.workspaceId),
        eq(commandIdempotency.principalId, principalId),
        eq(commandIdempotency.method, method),
        eq(commandIdempotency.canonicalRoute, route),
        eq(commandIdempotency.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!command) return null;
  if (command.canonicalRequestHash !== requestHash) {
    conflict("Idempotency-Key was already used with a different payload");
  }
  if (!command.responseBody || command.responseStatus === null) {
    conflict("A command with this Idempotency-Key is still being processed");
  }
  return asRecord(command.responseBody);
}

async function recordCommand(
  db: DbExecutor,
  params: {
    scope: Scope;
    principalId: string;
    method: string;
    route: string;
    idempotencyKey: string;
    requestHash: string;
    status: number;
    body: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date();
  await db.insert(commandIdempotency).values({
    id: generateId("outbox"),
    tenantId: params.scope.tenantId,
    workspaceId: params.scope.workspaceId,
    principalId: params.principalId,
    method: params.method,
    canonicalRoute: params.route,
    idempotencyKey: params.idempotencyKey,
    canonicalRequestHash: params.requestHash,
    responseStatus: params.status,
    responseBody: params.body,
    completedAt: now,
    expiresAt: new Date(now.getTime() + COMMAND_RETENTION_MS),
    createdAt: now,
  });
}

async function appendOutbox(
  db: DbExecutor,
  params: {
    scope: Scope;
    caseId: string;
    eventType: string;
    aggregateId: string;
    idempotencyKey: string;
    correlationId: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .insert(outbox)
    .values({
      id: generateId("outbox"),
      tenantId: params.scope.tenantId,
      workspaceId: params.scope.workspaceId,
      caseId: params.caseId,
      eventType: params.eventType,
      aggregateType: "approval_case",
      aggregateId: params.aggregateId,
      payload: params.payload,
      payloadHash: digestCanonical(params.payload),
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
      availableAt: new Date(),
    })
    .onConflictDoNothing();
}

/**
 * Appends a database-CAS hash-chain fact.  The payload stays hashed while its
 * bound evidence digests remain part of the hashed body, so the audit table
 * never becomes a copy of reviewer rationale or secret context.
 */
async function appendAudit(
  db: DbExecutor,
  params: {
    scope: Scope;
    caseId: string;
    eventType: string;
    actor: Actor;
    correlationId: string;
    payload: Record<string, unknown>;
    evidenceDigests: string[];
  },
): Promise<void> {
  const partitionKey = `case:${params.caseId}`;
  const genesis = digestCanonical({
    kind: "vekinbox/audit-genesis/v1",
    tenant_id: params.scope.tenantId,
    partition: partitionKey,
  });
  const headId = `ledger_${digestCanonical({ tenant: params.scope.tenantId, workspace: params.scope.workspaceId, partitionKey }).slice(0, 32)}`;
  await db
    .insert(auditLedgerHeads)
    .values({
      id: headId,
      tenantId: params.scope.tenantId,
      workspaceId: params.scope.workspaceId,
      partitionKey,
      lastSequence: 0,
      lastHash: genesis,
      version: 1,
    })
    .onConflictDoNothing();

  const [head] = await db
    .select()
    .from(auditLedgerHeads)
    .where(
      and(
        eq(auditLedgerHeads.tenantId, params.scope.tenantId),
        eq(auditLedgerHeads.workspaceId, params.scope.workspaceId),
        eq(auditLedgerHeads.partitionKey, partitionKey),
      ),
    )
    .limit(1);
  if (!head) throw new Error("Audit ledger head was not created");

  const now = new Date();
  const entryId = generateId("audit");
  const sequence = head.lastSequence + 1;
  const payloadHash = digestCanonical(params.payload);
  const body = {
    id: entryId,
    tenant_id: params.scope.tenantId,
    partition: partitionKey,
    sequence,
    occurred_at: now.toISOString(),
    event_type: params.eventType,
    actor_type: params.actor.actorType,
    actor_id: params.actor.principalId,
    case_id: params.caseId,
    payload_hash: payloadHash,
    evidence_digests: [...new Set(params.evidenceDigests)].sort(),
  };
  const entryHash = sha256Hex(`${head.lastHash}\n${canonicalJson(body)}`);

  const [advanced] = await db
    .update(auditLedgerHeads)
    .set({
      lastSequence: sequence,
      lastHash: entryHash,
      version: head.version + 1,
      updatedAt: now,
    })
    .where(and(eq(auditLedgerHeads.id, head.id), eq(auditLedgerHeads.version, head.version)))
    .returning({ id: auditLedgerHeads.id });
  if (!advanced) {
    conflict("Audit ledger is being updated; retry the command");
  }

  await db.insert(auditLedgerEntries).values({
    id: entryId,
    tenantId: params.scope.tenantId,
    workspaceId: params.scope.workspaceId,
    partitionKey,
    sequence,
    eventType: params.eventType,
    actorType: params.actor.actorType,
    actorPrincipalId: params.actor.principalId,
    caseId: params.caseId,
    correlationId: params.correlationId,
    canonicalPayloadHash: payloadHash,
    previousHash: head.lastHash,
    entryHash,
    keyId: V3_AUDIT_KEY_ID,
    createdAt: now,
  });
}

async function resolveParticipants(
  db: DbExecutor,
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), sql`${memberships.role} <> 'viewer'`));
  return [...new Set(rows.map((row) => row.userId))].sort();
}

async function ensureBuiltinTemplateVersion(
  db: DbExecutor,
  scope: Scope,
  templateId: string,
  version: number,
): Promise<{ templateVersionId: string; policyVersionId: string }> {
  const template = getBuiltinApprovalTemplate(templateId);
  if (template.version !== version) {
    validation(`Built-in template '${templateId}' version ${version} is not available`);
  }

  let [templateRow] = await db
    .select()
    .from(approvalTemplates)
    .where(
      and(
        eq(approvalTemplates.tenantId, scope.tenantId),
        eq(approvalTemplates.workspaceId, scope.workspaceId),
        eq(approvalTemplates.name, `builtin:${template.id}`),
      ),
    )
    .limit(1);
  if (!templateRow) {
    const id = generateId("tmpl");
    await db
      .insert(approvalTemplates)
      .values({
        id,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        name: `builtin:${template.id}`,
        lifecycle: "published",
      })
      .onConflictDoNothing();
    [templateRow] = await db
      .select()
      .from(approvalTemplates)
      .where(
        and(
          eq(approvalTemplates.tenantId, scope.tenantId),
          eq(approvalTemplates.workspaceId, scope.workspaceId),
          eq(approvalTemplates.name, `builtin:${template.id}`),
        ),
      )
      .limit(1);
  }
  if (!templateRow) throw new Error("Unable to persist built-in template");

  let [policyRow] = await db
    .select()
    .from(approvalPolicies)
    .where(
      and(
        eq(approvalPolicies.tenantId, scope.tenantId),
        eq(approvalPolicies.workspaceId, scope.workspaceId),
        eq(approvalPolicies.name, `builtin:${template.id}:policy`),
      ),
    )
    .limit(1);
  if (!policyRow) {
    const id = generateId("policy");
    await db
      .insert(approvalPolicies)
      .values({
        id,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        name: `builtin:${template.id}:policy`,
        lifecycle: "published",
      })
      .onConflictDoNothing();
    [policyRow] = await db
      .select()
      .from(approvalPolicies)
      .where(
        and(
          eq(approvalPolicies.tenantId, scope.tenantId),
          eq(approvalPolicies.workspaceId, scope.workspaceId),
          eq(approvalPolicies.name, `builtin:${template.id}:policy`),
        ),
      )
      .limit(1);
  }
  if (!policyRow) throw new Error("Unable to persist built-in policy");

  let [policyVersion] = await db
    .select()
    .from(policyVersions)
    .where(
      and(
        eq(policyVersions.policyId, policyRow.id),
        eq(policyVersions.version, template.version),
      ),
    )
    .limit(1);
  if (!policyVersion) {
    const id = generateId("pver");
    await db
      .insert(policyVersions)
      .values({
        id,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        policyId: policyRow.id,
        version: template.version,
        normalizedDsl: template.policy.source,
        compilerVersion: template.policy.compiler_version,
        policyHash: template.policy.policy_hash,
        validationReport: { built_in_template: template.id },
        publishedAt: new Date(),
      })
      .onConflictDoNothing();
    [policyVersion] = await db
      .select()
      .from(policyVersions)
      .where(
        and(
          eq(policyVersions.policyId, policyRow.id),
          eq(policyVersions.version, template.version),
        ),
      )
      .limit(1);
  }
  if (!policyVersion) throw new Error("Unable to persist built-in policy version");

  let [templateVersion] = await db
    .select()
    .from(templateVersions)
    .where(
      and(
        eq(templateVersions.templateId, templateRow.id),
        eq(templateVersions.version, template.version),
      ),
    )
    .limit(1);
  if (!templateVersion) {
    const id = generateId("tver");
    await db
      .insert(templateVersions)
      .values({
        id,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        templateId: templateRow.id,
        version: template.version,
        actionInputSchema: template.action_requirements,
        contextRequirements: template.context_requirements,
        decisionCatalog: { stages: template.policy.stages.map((stage) => stage.decisions) },
        policyVersionId: policyVersion.id,
        riskClass: template.risk_class,
        actionCatalogDigest: digestCanonical(template.action_requirements),
        templateDocument: {
          id: template.id,
          version: template.version,
          template_hash: template.template_hash,
        },
        templateHash: template.template_hash,
        publishedAt: new Date(),
      })
      .onConflictDoNothing();
    [templateVersion] = await db
      .select()
      .from(templateVersions)
      .where(
        and(
          eq(templateVersions.templateId, templateRow.id),
          eq(templateVersions.version, template.version),
        ),
      )
      .limit(1);
  }
  if (!templateVersion) throw new Error("Unable to persist built-in template version");
  return { templateVersionId: templateVersion.id, policyVersionId: policyVersion.id };
}

function scheduleOpenRuntime(
  policy: ReturnType<typeof getBuiltinApprovalTemplate>["policy"],
  input: {
    caseId: string;
    actionDigest: string;
    contextDigest: string;
    opensAt: Date;
  },
): PolicyCaseState {
  const opened = openPolicyCase(policy, {
    case_id: input.caseId,
    action_digest: input.actionDigest,
    context_manifest_digest: input.contextDigest,
    opened_at: input.opensAt,
  });
  // A planned case carries the immutable bindings but no active stage. The
  // durable schedule worker creates the normal open snapshot at due time.
  return {
    ...opened,
    lifecycle: "scheduled",
    outcome: null,
    stages: Object.fromEntries(
      Object.entries(opened.stages).map(([key, stage]) => [
        key,
        {
          ...stage,
          state: "pending",
          participant_ids: [],
          non_voting_participant_ids: [],
          decision_ids: [],
          opened_at: undefined,
          deadline_at: undefined,
        },
      ]),
    ),
    trace: [{ at: input.opensAt.toISOString(), type: "case.scheduled", reason: "open_at" }],
  };
}

function validateSchedule(
  policy: ReturnType<typeof getBuiltinApprovalTemplate>["policy"],
  schedule: V3CreateApprovalCaseInput["schedule"],
): { openAt: Date | null; effectiveAt: Date | null } {
  if (!schedule) return { openAt: null, effectiveAt: null };
  const openAt = schedule.open_at ? new Date(schedule.open_at) : null;
  const effectiveAt = schedule.effective_at ? new Date(schedule.effective_at) : null;
  if (openAt && Number.isNaN(openAt.getTime())) validation("schedule.open_at is invalid");
  if (effectiveAt && Number.isNaN(effectiveAt.getTime())) validation("schedule.effective_at is invalid");
  if (openAt && policy.source.spec.scheduling?.allow_open_at !== true) {
    validation("This policy does not allow scheduled opening");
  }
  if (effectiveAt && policy.source.spec.scheduling?.allow_effective_at !== true) {
    validation("This policy does not allow a future effective time");
  }
  if (openAt && effectiveAt && effectiveAt.getTime() <= openAt.getTime()) {
    validation("schedule.effective_at must be after schedule.open_at");
  }
  return { openAt, effectiveAt };
}

/** Durable case creation used by the v2 agent route. */
export async function createV3ApprovalCase(
  auth: ApiKeyAuth,
  projectId: string,
  input: V3CreateApprovalCaseInput,
  idempotencyKey: string,
): Promise<V3CommandResult<V3CaseResponse>> {
  if (auth.workspaceId !== projectId) {
    throw notFound("Project", projectId);
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    const scope = await loadScopedWorkspace(tx, projectId);
    const commandRoute = `/v2/projects/${projectId}/approval-cases`;
    const requestHash = digestCanonical(input);
    const replay = await existingCommand(
      tx,
      scope,
      auth.agentId,
      "POST",
      commandRoute,
      idempotencyKey,
      requestHash,
    );
    if (replay) return { status: 200, body: replay as unknown as V3CaseResponse };

    const template = getBuiltinApprovalTemplate(input.template.id);
    if (template.version !== input.template.version) {
      validation(`Template '${input.template.id}' version ${input.template.version} is not available`);
    }
    let bound;
    try {
      bound = bindApprovalTemplate(template, {
        action: input.action as ApprovalActionIntent,
        context: input.context_manifest as ContextManifest,
      });
    } catch (error) {
      validation(error instanceof Error ? error.message : "Invalid template-bound action or context");
    }
    // TypeScript cannot infer that `validation` never returns across a catch.
    if (!bound) throw new Error("Unable to bind approval template");
    const schedule = validateSchedule(bound.policy, input.schedule);
    const now = new Date();
    if (schedule.openAt && schedule.openAt.getTime() <= now.getTime()) {
      validation("schedule.open_at must be in the future");
    }
    if (schedule.effectiveAt && schedule.effectiveAt.getTime() <= now.getTime()) {
      validation("schedule.effective_at must be in the future");
    }

    const [existingThread] = await tx
      .select()
      .from(approvalThreads)
      .where(
        and(
          eq(approvalThreads.workspaceId, projectId),
          eq(approvalThreads.agentPrincipalId, auth.agentId),
          eq(approvalThreads.externalKey, input.external_key),
        ),
      )
      .limit(1);
    if (existingThread?.activeCaseId) {
      const existingCase = await loadCase(tx, scope, existingThread.activeCaseId);
      if (existingCase.actionDigest !== bound.action_digest) {
        conflict("external_key already identifies a different immutable action; create a superseding revision");
      }
      const response = responseForCase(existingCase, await loadCaseStages(tx, scope, existingCase.id));
      await recordCommand(tx, {
        scope,
        principalId: auth.agentId,
        method: "POST",
        route: commandRoute,
        idempotencyKey,
        requestHash,
        status: 200,
        body: response as unknown as Record<string, unknown>,
      });
      return { status: 200, body: response };
    }

    const ids = await ensureBuiltinTemplateVersion(tx, scope, template.id, template.version);
    const threadId = generateId("thread");
    const caseId = generateId("case");
    const participants = await resolveParticipants(tx, projectId);
    const participantsByStage = Object.fromEntries(
      bound.policy.stages.map((stage) => [stage.id, participants]),
    );
    const runtime = schedule.openAt
      ? scheduleOpenRuntime(bound.policy, {
          caseId,
          actionDigest: bound.action_digest,
          contextDigest: bound.context_manifest_digest,
          opensAt: schedule.openAt,
        })
      : openPolicyCase(bound.policy, {
          case_id: caseId,
          action_digest: bound.action_digest,
          context_manifest_digest: bound.context_manifest_digest,
          opened_at: now,
          ...(schedule.effectiveAt ? { effective_at: schedule.effectiveAt } : {}),
          participants_by_stage: participantsByStage,
        });
    runtime.version = 1;

    await tx.insert(approvalThreads).values({
      id: threadId,
      tenantId: scope.tenantId,
      workspaceId: projectId,
      agentPrincipalId: auth.agentId,
      externalKey: input.external_key,
    });
    const [created] = await tx
      .insert(approvalCases)
      .values({
        id: caseId,
        tenantId: scope.tenantId,
        workspaceId: projectId,
        threadId,
        revisionNumber: 1,
        lifecycle: toCaseLifecycle(runtime.lifecycle),
        outcome: toCaseOutcome(runtime.outcome),
        riskClass: bound.risk_class,
        version: 1,
        runtimeState: runtime,
        canonicalAction: bound.canonical_action,
        actionDigest: bound.action_digest,
        contextManifestDigest: bound.context_manifest_digest,
        templateVersionId: ids.templateVersionId,
        policyVersionId: ids.policyVersionId,
        openAt: schedule.openAt,
        effectiveAt: schedule.effectiveAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx
      .update(approvalThreads)
      .set({ activeCaseId: caseId, updatedAt: now })
      .where(eq(approvalThreads.id, threadId));

    const stageRows = bound.policy.stages.map((stage) => {
      const runtimeStage = runtime.stages[stage.id]!;
      return {
        id: generateId("stage"),
        tenantId: scope.tenantId,
        workspaceId: projectId,
        caseId,
        stageKey: stage.id,
        stageIndex: stage.order,
        activationDependencies: stage.activation,
        approvalRule: stage.approval_rule,
        requiredCount: stage.approval_rule.required_count ?? null,
        denominator: runtimeStage.participant_ids.length || null,
        state: toStageState(runtimeStage.state),
        openedAt: runtimeStage.opened_at ? new Date(runtimeStage.opened_at) : null,
        deadlineAt: runtimeStage.deadline_at ? new Date(runtimeStage.deadline_at) : null,
        effectiveAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
    });
    await tx.insert(caseStages).values(stageRows);
    const stageByKey = new Map(stageRows.map((stage) => [stage.stageKey, stage]));
    const participantRows = stageRows.flatMap((stage) => {
      const runtimeStage = runtime.stages[stage.stageKey]!;
      return runtimeStage.participant_ids.map((principalId) => ({
        id: generateId("mbr"),
        tenantId: scope.tenantId,
        workspaceId: projectId,
        caseId,
        stageId: stage.id,
        principalId,
        resolverType: bound.policy.stage_by_id[stage.stageKey]?.participants.resolver ?? "static",
        resolverSnapshot: { participant_ids: runtimeStage.participant_ids },
        eligibilitySnapshot: { resolved_at: now.toISOString() },
        status: "eligible" as const,
        addedAt: now,
      }));
    });
    if (participantRows.length) await tx.insert(stageParticipants).values(participantRows);

    await tx.insert(contextManifests).values({
      id: generateId("ctx"),
      tenantId: scope.tenantId,
      workspaceId: projectId,
      caseId,
      canonicalItems: bound.context_manifest.items,
      digest: bound.context_manifest_digest,
      classification: bound.context_manifest.effective_classification,
      classificationSummary: {
        item_count: bound.context_manifest.items.length,
        item_types: bound.context_manifest.items.map((item) => item.type),
      },
      sealedAt: now,
      createdAt: now,
    });

    if (schedule.openAt) {
      await tx.insert(scheduleWork).values({
        id: generateId("sched"),
        tenantId: scope.tenantId,
        workspaceId: projectId,
        caseId,
        workType: "case_open",
        dueAt: schedule.openAt,
        conditionHash: digestCanonical({ case_id: caseId, version: 1, kind: "case_open" }),
        caseVersion: 1,
        workKey: `${caseId}:case_open:1`,
        status: "pending",
      });
    }
    for (const stage of stageRows) {
      const runtimeStage = runtime.stages[stage.stageKey]!;
      if (!schedule.openAt && runtimeStage.deadline_at) {
        await tx.insert(scheduleWork).values({
          id: generateId("sched"),
          tenantId: scope.tenantId,
          workspaceId: projectId,
          caseId,
          stageId: stage.id,
          workType: "stage_deadline",
          dueAt: new Date(runtimeStage.deadline_at),
          conditionHash: digestCanonical({ case_id: caseId, stage_id: stage.stageKey, deadline: runtimeStage.deadline_at }),
          caseVersion: 1,
          workKey: `${caseId}:stage_deadline:${stage.stageKey}:1`,
          status: "pending",
        });
      }
    }

    const response = responseForCase(created!, await loadCaseStages(tx, scope, caseId));
    await appendAudit(tx, {
      scope,
      caseId,
      eventType: schedule.openAt ? "approval_case.scheduled" : "approval_case.created",
      actor: { actorType: "agent", principalId: auth.agentId },
      correlationId: idempotencyKey,
      payload: {
        thread_id: threadId,
        template_version_id: ids.templateVersionId,
        policy_version_id: ids.policyVersionId,
        action_digest: bound.action_digest,
        context_manifest_digest: bound.context_manifest_digest,
      },
      evidenceDigests: [bound.action_digest, bound.context_manifest_digest],
    });
    await appendOutbox(tx, {
      scope,
      caseId,
      eventType: schedule.openAt ? "approval_case.scheduled" : "approval_case.created",
      aggregateId: caseId,
      idempotencyKey: `${caseId}:created`,
      correlationId: idempotencyKey,
      payload: response as unknown as Record<string, unknown>,
    });
    await recordCommand(tx, {
      scope,
      principalId: auth.agentId,
      method: "POST",
      route: commandRoute,
      idempotencyKey,
      requestHash,
      status: 201,
      body: response as unknown as Record<string, unknown>,
    });
    return { status: 201, body: response };
  });
}

export async function getV3ApprovalCase(
  scope: Scope,
  caseId: string,
  agentId?: string,
): Promise<V3CaseResponse> {
  const db = getDb();
  const row = await loadCase(db, scope, caseId);
  if (agentId) {
    const [thread] = await db
      .select({ agentPrincipalId: approvalThreads.agentPrincipalId })
      .from(approvalThreads)
      .where(and(eq(approvalThreads.id, row.threadId), eq(approvalThreads.workspaceId, scope.workspaceId)))
      .limit(1);
    if (!thread || thread.agentPrincipalId !== agentId) throw notFound("Approval case", caseId);
  }
  return responseForCase(row, await loadCaseStages(db, scope, caseId));
}

export async function getV3CaseScope(caseId: string): Promise<Scope> {
  const db = getDb();
  const [row] = await db
    .select({ tenantId: approvalCases.tenantId, workspaceId: approvalCases.workspaceId })
    .from(approvalCases)
    .where(eq(approvalCases.id, caseId))
    .limit(1);
  if (!row) throw notFound("Approval case", caseId);
  return row;
}

async function currentReviewerEligibility(
  db: DbExecutor,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [membership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);
  return Boolean(membership && membership.role !== "viewer");
}

/** Atomically records a human decision under the authoritative case CAS version. */
export async function submitV3Decision(params: {
  caseId: string;
  scope: Scope;
  actorId: string;
  expectedVersion: number;
  idempotencyKey: string;
  input: V3DecisionInput;
}): Promise<{ decision_id: string; accepted: boolean; idempotent: boolean; case: V3CaseResponse }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const row = await loadCase(tx, params.scope, params.caseId);
    if (row.version !== params.expectedVersion) {
      conflict("Approval case version is stale; refresh and retry", { safe_refresh: true, current_version: row.version });
    }
    if (row.lifecycle !== "open") {
      conflict(`Approval case is not open (lifecycle: ${row.lifecycle})`);
    }
    const currentEligible = await currentReviewerEligibility(tx, params.scope.workspaceId, params.actorId);
    if (!currentEligible) {
      throw new VekInboxError("forbidden", "Reviewer access is required", 403);
    }
    const [priorDecision] = await tx
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.caseId, params.caseId),
          eq(decisions.actorPrincipalId, params.actorId),
          eq(decisions.idempotencyKey, params.idempotencyKey),
        ),
      )
      .limit(1);
    if (priorDecision) {
      if (priorDecision.response !== params.input.response) {
        conflict("Idempotency-Key was already used with a different decision");
      }
      return {
        decision_id: priorDecision.id,
        accepted: true,
        idempotent: true,
        case: responseForCase(row, await loadCaseStages(tx, params.scope, params.caseId)),
      };
    }

    const [policyVersion] = await tx
      .select()
      .from(policyVersions)
      .where(
        and(
          eq(policyVersions.id, row.policyVersionId),
          eq(policyVersions.tenantId, params.scope.tenantId),
          eq(policyVersions.workspaceId, params.scope.workspaceId),
        ),
      )
      .limit(1);
    if (!policyVersion) throw new Error("Pinned policy version is missing");
    const policy = compileApprovalPolicy(policyVersion.normalizedDsl as ApprovalPolicyDocument);
    const prior = parseRuntimeState(row.runtimeState, row.id);
    prior.version = row.version;
    const decisionId = generateId("dec");
    const acceptedAt = new Date();
    const result = submitPolicyDecision(
      policy,
      prior,
      {
        id: decisionId,
        idempotency_key: params.idempotencyKey,
        stage_id: params.input.stage_id,
        participant_id: params.actorId,
        kind: params.input.response,
        action_digest: row.actionDigest,
        context_manifest_digest: row.contextManifestDigest,
        accepted_at: acceptedAt,
      },
      () => currentEligible,
    );
    if (!result.accepted) {
      conflict(`Decision was not accepted: ${result.reason ?? "policy_rejected"}`, {
        reason: result.reason ?? "policy_rejected",
      });
    }
    const nextVersion = row.version + 1;
    result.state.version = nextVersion;
    const [stage] = await tx
      .select()
      .from(caseStages)
      .where(
        and(
          eq(caseStages.caseId, row.id),
          eq(caseStages.stageKey, params.input.stage_id),
          eq(caseStages.workspaceId, params.scope.workspaceId),
        ),
      )
      .limit(1);
    if (!stage) throw new Error("Policy stage projection is missing");
    const [lastDecision] = await tx
      .select({ sequence: decisions.sequence })
      .from(decisions)
      .where(eq(decisions.caseId, row.id))
      .orderBy(desc(decisions.sequence))
      .limit(1);
    await tx.insert(decisions).values({
      id: decisionId,
      tenantId: params.scope.tenantId,
      workspaceId: params.scope.workspaceId,
      caseId: row.id,
      stageId: stage.id,
      sequence: (lastDecision?.sequence ?? 0) + 1,
      actorPrincipalId: params.actorId,
      response: params.input.response,
      reason: params.input.reason ?? null,
      structuredPayload: params.input.payload,
      assuranceFacts: { authentication: "session", checked_at: acceptedAt.toISOString() },
      actionDigest: row.actionDigest,
      contextManifestDigest: row.contextManifestDigest,
      idempotencyKey: params.idempotencyKey,
      acceptedAt,
      createdAt: acceptedAt,
    });

    const [updated] = await tx
      .update(approvalCases)
      .set({
        lifecycle: toCaseLifecycle(result.state.lifecycle),
        outcome: toCaseOutcome(result.state.outcome),
        version: nextVersion,
        runtimeState: result.state,
        resolvedAt:
          result.state.lifecycle === "resolved" ||
          result.state.lifecycle === "expired" ||
          result.state.lifecycle === "cancelled"
            ? acceptedAt
            : null,
        updatedAt: acceptedAt,
      })
      .where(
        and(
          eq(approvalCases.id, row.id),
          eq(approvalCases.tenantId, params.scope.tenantId),
          eq(approvalCases.workspaceId, params.scope.workspaceId),
          eq(approvalCases.version, params.expectedVersion),
        ),
      )
      .returning();
    if (!updated) {
      conflict("Approval case changed while the decision was being evaluated", { safe_refresh: true });
    }

    for (const persistedStage of await loadCaseStages(tx, params.scope, row.id)) {
      const runtimeStage = result.state.stages[persistedStage.stageKey];
      if (!runtimeStage) continue;
      await tx
        .update(caseStages)
        .set({
          state: toStageState(runtimeStage.state),
          openedAt: runtimeStage.opened_at ? new Date(runtimeStage.opened_at) : null,
          deadlineAt: runtimeStage.deadline_at ? new Date(runtimeStage.deadline_at) : null,
          version: persistedStage.version + 1,
          updatedAt: acceptedAt,
        })
        .where(eq(caseStages.id, persistedStage.id));
    }
    await appendAudit(tx, {
      scope: params.scope,
      caseId: row.id,
      eventType: "decision.accepted",
      actor: { actorType: "user", principalId: params.actorId },
      correlationId: params.idempotencyKey,
      payload: {
        decision_id: decisionId,
        stage_id: params.input.stage_id,
        response: params.input.response,
        action_digest: row.actionDigest,
        context_manifest_digest: row.contextManifestDigest,
      },
      evidenceDigests: [row.actionDigest, row.contextManifestDigest],
    });
    await appendOutbox(tx, {
      scope: params.scope,
      caseId: row.id,
      eventType: "approval_case.decision_recorded",
      aggregateId: row.id,
      idempotencyKey: `${row.id}:decision:${decisionId}`,
      correlationId: params.idempotencyKey,
      payload: {
        case_id: row.id,
        decision_id: decisionId,
        version: nextVersion,
        lifecycle: result.state.lifecycle,
        outcome: result.state.outcome,
      },
    });
    const response = responseForCase(updated!, await loadCaseStages(tx, params.scope, row.id));
    return { decision_id: decisionId, accepted: true, idempotent: false, case: response };
  });
}

export async function createV3ScheduledDecision(params: {
  caseId: string;
  scope: Scope;
  actorId: string;
  expectedVersion: number;
  idempotencyKey: string;
  input: V3ScheduledDecisionInput;
}): Promise<V3CommandResult<Record<string, unknown>>> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const row = await loadCase(tx, params.scope, params.caseId);
    if (row.version !== params.expectedVersion) {
      conflict("Approval case version is stale; refresh and retry", { safe_refresh: true, current_version: row.version });
    }
    if (row.lifecycle !== "open") conflict("Only an open approval case can receive a scheduled decision");
    if (!(await currentReviewerEligibility(tx, params.scope.workspaceId, params.actorId))) {
      throw new VekInboxError("forbidden", "Reviewer access is required", 403);
    }
    const runtime = parseRuntimeState(row.runtimeState, row.id);
    const runtimeStage = runtime.stages[params.input.stage_id];
    if (!runtimeStage || runtimeStage.state !== "open" || !runtimeStage.participant_ids.includes(params.actorId)) {
      throw new VekInboxError("forbidden", "You are not an eligible participant for this stage", 403);
    }
    const id = generateId("sched");
    const plan = planScheduledApproval({
      id,
      case_id: row.id,
      stage_id: params.input.stage_id,
      reviewer_id: params.actorId,
      intended_decision: params.input.response,
      action_digest: row.actionDigest,
      context_manifest_digest: row.contextManifestDigest,
      effective_at: params.input.effective_at,
      requested_at: new Date(),
      risk_class: row.riskClass,
      applicable_deadline_at: runtimeStage.deadline_at,
      original_timezone: params.input.timezone,
      original_local_time: params.input.effective_at,
    });
    const [stage] = await tx
      .select({ id: caseStages.id })
      .from(caseStages)
      .where(and(eq(caseStages.caseId, row.id), eq(caseStages.stageKey, params.input.stage_id)))
      .limit(1);
    if (!stage) throw new Error("Policy stage projection is missing");
    await tx.insert(scheduledDecisions).values({
      id,
      tenantId: params.scope.tenantId,
      workspaceId: params.scope.workspaceId,
      caseId: row.id,
      stageId: stage.id,
      requestingPrincipalId: params.actorId,
      response: params.input.response,
      payloadDigest: digestCanonical(params.input.payload),
      actionDigest: row.actionDigest,
      contextManifestDigest: row.contextManifestDigest,
      effectiveAt: new Date(plan.effective_at),
      timezone: params.input.timezone,
      localTimeExpression: params.input.effective_at,
      maxLeadSeconds: Math.round((new Date(plan.effective_at).getTime() - Date.now()) / 1_000),
      requiresFreshConfirmation: plan.requires_confirmation,
      minimumAssurance: plan.minimum_assurance,
      status: plan.status,
      expiresAt: new Date(plan.confirmation_expires_at),
    });
    await tx.insert(scheduleWork).values({
      id: generateId("sched"),
      tenantId: params.scope.tenantId,
      workspaceId: params.scope.workspaceId,
      caseId: row.id,
      stageId: stage.id,
      workType: "scheduled_decision",
      dueAt: new Date(plan.effective_at),
      conditionHash: digestCanonical({ scheduled_decision_id: id, case_version: row.version }),
      caseVersion: row.version,
      workKey: `${row.id}:scheduled_decision:${id}`,
      status: "pending",
    });
    const body = {
      id,
      status: plan.status,
      effective_at: plan.effective_at,
      confirmation_expires_at: plan.confirmation_expires_at,
      requires_confirmation: plan.requires_confirmation,
      minimum_assurance: plan.minimum_assurance,
      action_digest: row.actionDigest,
      context_manifest_digest: row.contextManifestDigest,
    };
    await appendAudit(tx, {
      scope: params.scope,
      caseId: row.id,
      eventType: "scheduled_decision.created",
      actor: { actorType: "user", principalId: params.actorId },
      correlationId: params.idempotencyKey,
      payload: body,
      evidenceDigests: [row.actionDigest, row.contextManifestDigest],
    });
    return { status: 202, body };
  });
}

export async function getV3ScheduledDecisionScope(scheduledDecisionId: string): Promise<Scope> {
  const db = getDb();
  const [row] = await db
    .select({ tenantId: scheduledDecisions.tenantId, workspaceId: scheduledDecisions.workspaceId })
    .from(scheduledDecisions)
    .where(eq(scheduledDecisions.id, scheduledDecisionId))
    .limit(1);
  if (!row) throw notFound("Scheduled decision", scheduledDecisionId);
  return row;
}

/**
 * A planned decision is still only an intent. At confirmation we run the
 * pure scheduling gate against the current case snapshot, then submit it
 * through the normal decision CAS path using a schedule-stable idempotency
 * key. No timer or background job can manufacture an approval on its own.
 */
export async function confirmV3ScheduledDecision(params: {
  scheduledDecisionId: string;
  scope: Scope;
  actorId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<{ decision_id: string; accepted: boolean; idempotent: boolean; case: V3CaseResponse }> {
  const db = getDb();
  const [scheduled] = await db
    .select()
    .from(scheduledDecisions)
    .where(
      and(
        eq(scheduledDecisions.id, params.scheduledDecisionId),
        eq(scheduledDecisions.tenantId, params.scope.tenantId),
        eq(scheduledDecisions.workspaceId, params.scope.workspaceId),
      ),
    )
    .limit(1);
  if (!scheduled) throw notFound("Scheduled decision", params.scheduledDecisionId);
  if (scheduled.requestingPrincipalId !== params.actorId) {
    throw new VekInboxError("forbidden", "Only the scheduled reviewer can confirm this decision", 403);
  }
  const row = await loadCase(db, params.scope, scheduled.caseId);
  if (row.version !== params.expectedVersion) {
    conflict("Approval case version is stale; refresh and retry", { safe_refresh: true, current_version: row.version });
  }
  const eligible = await currentReviewerEligibility(db, params.scope.workspaceId, params.actorId);
  const runtime = parseRuntimeState(row.runtimeState, row.id);
  const stage = runtime.stages[
    (await db
      .select({ stageKey: caseStages.stageKey })
      .from(caseStages)
      .where(eq(caseStages.id, scheduled.stageId))
      .limit(1))[0]?.stageKey ?? ""
  ];
  if (!stage) conflict("The scheduled stage is no longer available");
  const processed = processScheduledApproval({
    approval: {
      id: scheduled.id,
      case_id: scheduled.caseId,
      stage_id:
        (await db
          .select({ stageKey: caseStages.stageKey })
          .from(caseStages)
          .where(eq(caseStages.id, scheduled.stageId))
          .limit(1))[0]?.stageKey ?? "",
      reviewer_id: scheduled.requestingPrincipalId,
      intended_decision: scheduled.response,
      action_digest: scheduled.actionDigest,
      context_manifest_digest: scheduled.contextManifestDigest,
      effective_at: scheduled.effectiveAt.toISOString(),
      requested_at: scheduled.createdAt.toISOString(),
      risk_class: row.riskClass,
      requires_confirmation: scheduled.requiresFreshConfirmation,
      minimum_assurance: scheduled.minimumAssurance,
      confirmation_expires_at: scheduled.expiresAt?.toISOString() ?? scheduled.effectiveAt.toISOString(),
      status: scheduled.status,
      ...(scheduled.localTimeExpression ? { original_local_time: scheduled.localTimeExpression } : {}),
      ...(scheduled.timezone ? { original_timezone: scheduled.timezone } : {}),
    },
    at: new Date(),
    snapshot: {
      lifecycle: runtime.lifecycle,
      action_digest: row.actionDigest,
      context_manifest_digest: row.contextManifestDigest,
      applicable_deadline_at: stage.deadline_at,
    },
    is_currently_eligible: eligible && stage.participant_ids.includes(params.actorId),
    confirmation: {
      reviewer_id: params.actorId,
      confirmed_at: new Date(),
      assurance: "verified_session",
    },
  });
  if (!processed.decision) {
    const terminal = processed.approval.status;
    if (terminal !== "pending_confirmation") {
      await db
        .update(scheduledDecisions)
        .set({ status: terminal, cancellationReason: processed.reason, updatedAt: new Date() })
        .where(and(eq(scheduledDecisions.id, scheduled.id), eq(scheduledDecisions.status, "pending_confirmation")));
    }
    conflict(`Scheduled decision cannot be confirmed: ${processed.reason}`, { reason: processed.reason });
  }
  const stableDecisionKey = `scheduled:${scheduled.id}`;
  const result = await submitV3Decision({
    caseId: row.id,
    scope: params.scope,
    actorId: params.actorId,
    expectedVersion: params.expectedVersion,
    idempotencyKey: stableDecisionKey,
    input: {
      stage_id: processed.decision.stage_id,
      response: processed.decision.kind,
      payload: { scheduled_decision_id: scheduled.id, scheduled_payload_digest: scheduled.payloadDigest },
    },
  });
  await db
    .update(scheduledDecisions)
    .set({
      status: "confirmed_and_submitted",
      confirmedAt: new Date(),
      submittedDecisionId: result.decision_id,
      updatedAt: new Date(),
    })
    .where(eq(scheduledDecisions.id, scheduled.id));
  return result;
}

export async function cancelV3ScheduledDecision(params: {
  scheduledDecisionId: string;
  scope: Scope;
  actorId: string;
}): Promise<{ id: string; status: string }> {
  const db = getDb();
  const [updated] = await db
    .update(scheduledDecisions)
    .set({
      status: "cancelled",
      cancellationReason: "retracted_by_reviewer",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduledDecisions.id, params.scheduledDecisionId),
        eq(scheduledDecisions.tenantId, params.scope.tenantId),
        eq(scheduledDecisions.workspaceId, params.scope.workspaceId),
        eq(scheduledDecisions.requestingPrincipalId, params.actorId),
        eq(scheduledDecisions.status, "pending_confirmation"),
      ),
    )
    .returning({ id: scheduledDecisions.id, status: scheduledDecisions.status });
  if (!updated) {
    conflict("Scheduled decision cannot be cancelled");
  }
  return updated!;
}

export async function listV3Timeline(scope: Scope, caseId: string): Promise<Record<string, unknown>> {
  const db = getDb();
  await loadCase(db, scope, caseId);
  const [decisionRows, auditRows] = await Promise.all([
    db
      .select()
      .from(decisions)
      .where(and(eq(decisions.tenantId, scope.tenantId), eq(decisions.workspaceId, scope.workspaceId), eq(decisions.caseId, caseId)))
      .orderBy(decisions.sequence),
    db
      .select()
      .from(auditLedgerEntries)
      .where(and(eq(auditLedgerEntries.tenantId, scope.tenantId), eq(auditLedgerEntries.workspaceId, scope.workspaceId), eq(auditLedgerEntries.caseId, caseId)))
      .orderBy(auditLedgerEntries.sequence),
  ]);
  return {
    decisions: decisionRows.map((decision) => ({
      id: decision.id,
      stage_id: decision.stageId,
      response: decision.response,
      accepted_at: decision.acceptedAt.toISOString(),
      action_digest: decision.actionDigest,
      context_manifest_digest: decision.contextManifestDigest,
    })),
    audit: auditRows.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      event_type: entry.eventType,
      previous_hash: entry.previousHash,
      entry_hash: entry.entryHash,
      payload_hash: entry.canonicalPayloadHash,
      created_at: entry.createdAt.toISOString(),
    })),
  };
}
