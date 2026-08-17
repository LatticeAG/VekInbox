import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
  approvalCases,
  caseStages,
  memberships,
  outbox,
  policyVersions,
  scheduleWork,
  stageParticipants,
  type Database,
} from "@latticeag/vekinbox-db";
import {
  advancePolicyClock,
  compileApprovalPolicy,
  digestCanonical,
  openPolicyCase,
  type ApprovalPolicyDocument,
  type PolicyCaseState,
} from "@latticeag/vekinbox-core";
import { generateId } from "@latticeag/vekinbox-shared";
import { getDb } from "../lib/db.js";

type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const leaseOwner = `v3-scheduler:${process.pid}`;
const LEASE_MS = 60_000;

function runtimeFrom(value: unknown, caseId: string): PolicyCaseState {
  const runtime = value as PolicyCaseState;
  if (!runtime || runtime.case_id !== caseId || !runtime.stages) {
    throw new Error(`Approval case ${caseId} has invalid V3 runtime state`);
  }
  return runtime;
}

async function activeParticipantIds(tx: DbTransaction, workspaceId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), sql`${memberships.role} <> 'viewer'`));
  return [...new Set(rows.map((row) => row.userId))].sort();
}

async function syncStageProjection(
  tx: DbTransaction,
  input: {
    caseId: string;
    workspaceId: string;
    state: PolicyCaseState;
    at: Date;
    addParticipants?: boolean;
  },
): Promise<void> {
  const stages = await tx
    .select()
    .from(caseStages)
    .where(and(eq(caseStages.caseId, input.caseId), eq(caseStages.workspaceId, input.workspaceId)));
  for (const stage of stages) {
    const runtimeStage = input.state.stages[stage.stageKey];
    if (!runtimeStage) continue;
    await tx
      .update(caseStages)
      .set({
        state: runtimeStage.state,
        openedAt: runtimeStage.opened_at ? new Date(runtimeStage.opened_at) : null,
        deadlineAt: runtimeStage.deadline_at ? new Date(runtimeStage.deadline_at) : null,
        version: stage.version + 1,
        updatedAt: input.at,
      })
      .where(eq(caseStages.id, stage.id));

    if (!input.addParticipants || runtimeStage.participant_ids.length === 0) continue;
    await tx
      .insert(stageParticipants)
      .values(
        runtimeStage.participant_ids.map((principalId) => ({
          id: generateId("mbr"),
          tenantId: stage.tenantId,
          workspaceId: stage.workspaceId,
          caseId: stage.caseId,
          stageId: stage.id,
          principalId,
          resolverType: "workspace_reviewer_snapshot",
          resolverSnapshot: { participant_ids: runtimeStage.participant_ids },
          eligibilitySnapshot: { opened_at: runtimeStage.opened_at },
          status: "eligible" as const,
          addedAt: input.at,
        })),
      )
      .onConflictDoNothing();
  }
}

async function appendSchedulerOutbox(
  tx: DbTransaction,
  input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    workId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx
    .insert(outbox)
    .values({
      id: generateId("outbox"),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      caseId: input.caseId,
      eventType: input.eventType,
      aggregateType: "approval_case",
      aggregateId: input.caseId,
      payload: input.payload,
      payloadHash: digestCanonical(input.payload),
      idempotencyKey: `schedule-work:${input.workId}`,
      correlationId: input.workId,
      availableAt: new Date(),
    })
    .onConflictDoNothing();
}

async function scheduleStageDeadlines(
  tx: DbTransaction,
  input: {
    tenantId: string;
    workspaceId: string;
    caseId: string;
    version: number;
    state: PolicyCaseState;
  },
): Promise<void> {
  const stages = await tx
    .select({ id: caseStages.id, stageKey: caseStages.stageKey })
    .from(caseStages)
    .where(and(eq(caseStages.caseId, input.caseId), eq(caseStages.workspaceId, input.workspaceId)));
  const byKey = new Map(stages.map((stage) => [stage.stageKey, stage]));
  for (const [stageKey, runtimeStage] of Object.entries(input.state.stages)) {
    if (!runtimeStage.deadline_at || runtimeStage.state !== "open") continue;
    const stage = byKey.get(stageKey);
    if (!stage) continue;
    await tx
      .insert(scheduleWork)
      .values({
        id: generateId("sched"),
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        caseId: input.caseId,
        stageId: stage.id,
        workType: "stage_deadline",
        dueAt: new Date(runtimeStage.deadline_at),
        conditionHash: digestCanonical({
          case_id: input.caseId,
          stage_id: stageKey,
          deadline_at: runtimeStage.deadline_at,
        }),
        caseVersion: input.version,
        workKey: `${input.caseId}:stage_deadline:${stageKey}:${input.version}`,
        status: "pending",
      })
      .onConflictDoNothing();
  }
}

async function processCaseOpen(tx: DbTransaction, work: typeof scheduleWork.$inferSelect): Promise<"completed" | "cancelled"> {
  const [row] = await tx
    .select()
    .from(approvalCases)
    .where(
      and(
        eq(approvalCases.id, work.caseId),
        eq(approvalCases.tenantId, work.tenantId),
        eq(approvalCases.workspaceId, work.workspaceId),
      ),
    )
    .limit(1);
  if (!row || row.lifecycle !== "scheduled" || row.version !== work.caseVersion) return "cancelled";
  const [policyVersion] = await tx
    .select({ normalizedDsl: policyVersions.normalizedDsl })
    .from(policyVersions)
    .where(
      and(
        eq(policyVersions.id, row.policyVersionId),
        eq(policyVersions.tenantId, row.tenantId),
        eq(policyVersions.workspaceId, row.workspaceId),
      ),
    )
    .limit(1);
  if (!policyVersion) throw new Error(`Pinned policy version ${row.policyVersionId} is missing`);
  const policy = compileApprovalPolicy(policyVersion.normalizedDsl as ApprovalPolicyDocument);
  const at = new Date();
  const participants = await activeParticipantIds(tx, row.workspaceId);
  const runtime = openPolicyCase(policy, {
    case_id: row.id,
    action_digest: row.actionDigest,
    context_manifest_digest: row.contextManifestDigest,
    opened_at: at,
    ...(row.effectiveAt ? { effective_at: row.effectiveAt } : {}),
    participants_by_stage: Object.fromEntries(policy.stages.map((stage) => [stage.id, participants])),
  });
  const nextVersion = row.version + 1;
  runtime.version = nextVersion;
  const [updated] = await tx
    .update(approvalCases)
    .set({
      lifecycle: runtime.lifecycle,
      outcome: runtime.outcome,
      runtimeState: runtime,
      version: nextVersion,
      openAt: at,
      updatedAt: at,
    })
    .where(and(eq(approvalCases.id, row.id), eq(approvalCases.version, row.version)))
    .returning({ id: approvalCases.id });
  if (!updated) return "cancelled";
  await syncStageProjection(tx, {
    caseId: row.id,
    workspaceId: row.workspaceId,
    state: runtime,
    at,
    addParticipants: true,
  });
  await scheduleStageDeadlines(tx, {
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    caseId: row.id,
    version: nextVersion,
    state: runtime,
  });
  await appendSchedulerOutbox(tx, {
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    caseId: row.id,
    workId: work.id,
    eventType: "approval_case.opened",
    payload: { case_id: row.id, version: nextVersion },
  });
  return "completed";
}

async function processStageDeadline(
  tx: DbTransaction,
  work: typeof scheduleWork.$inferSelect,
): Promise<"completed" | "cancelled"> {
  const [row] = await tx
    .select()
    .from(approvalCases)
    .where(
      and(
        eq(approvalCases.id, work.caseId),
        eq(approvalCases.tenantId, work.tenantId),
        eq(approvalCases.workspaceId, work.workspaceId),
      ),
    )
    .limit(1);
  if (!row || row.version !== work.caseVersion || row.lifecycle !== "open") return "cancelled";
  const [policyVersion] = await tx
    .select({ normalizedDsl: policyVersions.normalizedDsl })
    .from(policyVersions)
    .where(eq(policyVersions.id, row.policyVersionId))
    .limit(1);
  if (!policyVersion) throw new Error(`Pinned policy version ${row.policyVersionId} is missing`);
  const policy = compileApprovalPolicy(policyVersion.normalizedDsl as ApprovalPolicyDocument);
  const at = new Date();
  const timed = advancePolicyClock(policy, runtimeFrom(row.runtimeState, row.id), at);
  if (timed.timed_out_stage_ids.length === 0) return "completed";
  const nextVersion = row.version + 1;
  timed.state.version = nextVersion;
  const [updated] = await tx
    .update(approvalCases)
    .set({
      lifecycle: timed.state.lifecycle,
      outcome: timed.state.outcome,
      runtimeState: timed.state,
      version: nextVersion,
      resolvedAt:
        timed.state.lifecycle === "resolved" || timed.state.lifecycle === "expired" || timed.state.lifecycle === "cancelled"
          ? at
          : null,
      updatedAt: at,
    })
    .where(and(eq(approvalCases.id, row.id), eq(approvalCases.version, row.version)))
    .returning({ id: approvalCases.id });
  if (!updated) return "cancelled";
  await syncStageProjection(tx, { caseId: row.id, workspaceId: row.workspaceId, state: timed.state, at });
  await appendSchedulerOutbox(tx, {
    tenantId: row.tenantId,
    workspaceId: row.workspaceId,
    caseId: row.id,
    workId: work.id,
    eventType: "approval_case.stage_deadline_reached",
    payload: {
      case_id: row.id,
      stage_ids: timed.timed_out_stage_ids,
      lifecycle: timed.state.lifecycle,
      outcome: timed.state.outcome,
      version: nextVersion,
    },
  });
  return "completed";
}

async function processLeasedWork(work: typeof scheduleWork.$inferSelect): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    let terminal: "completed" | "cancelled";
    if (work.workType === "case_open") {
      terminal = await processCaseOpen(tx, work);
    } else if (work.workType === "stage_deadline") {
      terminal = await processStageDeadline(tx, work);
    } else {
      // A planned human decision is intentionally never auto-submitted. Its
      // confirmation route performs the fresh identity/assurance check.
      terminal = "completed";
    }
    await tx
      .update(scheduleWork)
      .set({ status: terminal, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null })
      .where(and(eq(scheduleWork.id, work.id), eq(scheduleWork.status, "leased")));
  });
}

/**
 * Postgres is the schedule source of truth. This reconciler leases due rows so
 * a Redis delayed job can only accelerate delivery, never decide authority.
 */
export async function reconcileV3ScheduleWork(limit = 50): Promise<number> {
  const db = getDb();
  const now = new Date();
  const candidates = await db
    .select()
    .from(scheduleWork)
    .where(and(eq(scheduleWork.status, "pending"), lte(scheduleWork.dueAt, now)))
    .orderBy(scheduleWork.dueAt)
    .limit(limit);
  let processed = 0;
  for (const candidate of candidates) {
    const [leased] = await db
      .update(scheduleWork)
      .set({
        status: "leased",
        leaseOwner,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        attempts: sql`${scheduleWork.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(scheduleWork.id, candidate.id), eq(scheduleWork.status, "pending")))
      .returning();
    if (!leased) continue;
    try {
      await processLeasedWork(leased);
      processed += 1;
    } catch (error) {
      await db
        .update(scheduleWork)
        .set({
          status: "pending",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: error instanceof Error ? error.message.slice(0, 2_000) : "unknown scheduler error",
          updatedAt: new Date(),
        })
        .where(and(eq(scheduleWork.id, leased.id), eq(scheduleWork.status, "leased")));
      throw error;
    }
  }
  return processed;
}
