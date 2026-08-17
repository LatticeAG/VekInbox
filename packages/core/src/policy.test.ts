import { describe, expect, it } from "vitest";
import {
  addEscalationParticipants,
  compileApprovalPolicy,
  openPolicyCase,
  PolicyValidationError,
  recordPolicyDeliveryAttempt,
  submitPolicyDecision,
} from "./index.js";

const actionDigest = "a".repeat(64);
const contextDigest = "b".repeat(64);
const openedAt = "2026-07-21T10:00:00.000Z";

function policyWithStages(stages: unknown[], timeoutOutcome = "decline") {
  return {
    apiVersion: "vekinbox/v3",
    kind: "ApprovalPolicy",
    metadata: { name: "test-policy", scope: "project" },
    spec: {
      safety: { timeout_outcome: timeoutOutcome },
      workflow: {
        case_completion: { kind: "all_required_stages" },
        stages,
      },
    },
  };
}

function decision(stageId: string, participantId: string, id: string, acceptedAt: string) {
  return {
    id,
    idempotency_key: id,
    stage_id: stageId,
    participant_id: participantId,
    kind: "approve" as const,
    action_digest: actionDigest,
    context_manifest_digest: contextDigest,
    accepted_at: acceptedAt,
  };
}

describe("approval policy parser and execution engine", () => {
  it("executes a quorum followed by a dependent single-reviewer chain", () => {
    const policy = compileApprovalPolicy(
      policyWithStages([
        {
          id: "engineering",
          activation: { depends_on: [], dependency_join: "all_satisfied" },
          approval_rule: {
            kind: "quorum",
            required_count: 2,
            denominator: "snapshot_at_stage_open",
          },
          participants: { ids: ["eng-1", "eng-2"] },
          decisions: { allow: ["approve", "decline", "request_changes"], decline_effect: "block_case" },
          deadline: { anchor: "stage_opened", after: "PT20M" },
        },
        {
          id: "manager",
          activation: { depends_on: ["engineering"], dependency_join: "all_satisfied" },
          approval_rule: { kind: "single" },
          participants: { ids: ["manager-1"] },
          decisions: { allow: ["approve", "decline", "request_changes"], decline_effect: "block_case" },
          deadline: { anchor: "stage_opened", after: "PT20M" },
        },
      ]),
    );

    let state = openPolicyCase(policy, {
      case_id: "case-chain",
      action_digest: actionDigest,
      context_manifest_digest: contextDigest,
      opened_at: openedAt,
    });
    expect(state.stages.engineering?.state).toBe("open");
    expect(state.stages.manager?.state).toBe("pending");

    let result = submitPolicyDecision(
      policy,
      state,
      decision("engineering", "eng-1", "decision-eng-1", "2026-07-21T10:01:00.000Z"),
    );
    expect(result.accepted).toBe(true);
    expect(result.state.stages.engineering?.state).toBe("open");

    result = submitPolicyDecision(
      policy,
      result.state,
      decision("engineering", "eng-2", "decision-eng-2", "2026-07-21T10:02:00.000Z"),
    );
    expect(result.state.stages.engineering?.state).toBe("satisfied");
    expect(result.state.stages.manager?.state).toBe("open");

    result = submitPolicyDecision(
      policy,
      result.state,
      decision("manager", "manager-1", "decision-manager", "2026-07-21T10:03:00.000Z"),
    );
    state = result.state;
    expect(result.accepted).toBe(true);
    expect(state.lifecycle).toBe("resolved");
    expect(state.outcome).toBe("approved");
  });

  it("requires every participant for an all-of stage", () => {
    const policy = compileApprovalPolicy(
      policyWithStages([
        {
          id: "all-reviewers",
          activation: { depends_on: [], dependency_join: "all_satisfied" },
          approval_rule: { kind: "all_of" },
          participants: { ids: ["reviewer-a", "reviewer-b"] },
          decisions: { allow: ["approve", "decline"] },
        },
      ]),
    );
    const state = openPolicyCase(policy, {
      case_id: "case-all-of",
      action_digest: actionDigest,
      context_manifest_digest: contextDigest,
      opened_at: openedAt,
    });
    const afterFirst = submitPolicyDecision(
      policy,
      state,
      decision("all-reviewers", "reviewer-a", "decision-a", "2026-07-21T10:01:00.000Z"),
    );
    expect(afterFirst.state.stages["all-reviewers"]?.state).toBe("open");

    const afterSecond = submitPolicyDecision(
      policy,
      afterFirst.state,
      decision("all-reviewers", "reviewer-b", "decision-b", "2026-07-21T10:02:00.000Z"),
    );
    expect(afterSecond.state.lifecycle).toBe("resolved");
    expect(afterSecond.state.outcome).toBe("approved");
  });

  it("keeps a static participant snapshot authoritative over host resolver input", () => {
    const policy = compileApprovalPolicy(
      policyWithStages([
        {
          id: "named-reviewer",
          activation: { depends_on: [], dependency_join: "all_satisfied" },
          approval_rule: { kind: "single" },
          participants: { ids: ["policy-reviewer"] },
          decisions: { allow: ["approve", "decline"] },
        },
      ]),
    );
    const state = openPolicyCase(policy, {
      case_id: "case-static-snapshot",
      action_digest: actionDigest,
      context_manifest_digest: contextDigest,
      opened_at: openedAt,
      participants_by_stage: { "named-reviewer": ["host-injected-reviewer"] },
    });

    expect(state.stages["named-reviewer"]?.participant_ids).toEqual(["policy-reviewer"]);
    expect(
      submitPolicyDecision(
        policy,
        state,
        decision("named-reviewer", "host-injected-reviewer", "injected", "2026-07-21T10:01:00.000Z"),
      ).reason,
    ).toBe("participant_not_in_snapshot");
  });

  it("does not let a non-voting escalation addition change the approval outcome", () => {
    const policy = compileApprovalPolicy(
      policyWithStages([
        {
          id: "review",
          activation: { depends_on: [], dependency_join: "all_satisfied" },
          approval_rule: { kind: "any_of" },
          participants: {
            ids: ["original-reviewer"],
            escalation_additions: { allowed: true, count_toward_rule: false },
          },
          decisions: { allow: ["approve", "decline"] },
        },
      ]),
    );
    const state = openPolicyCase(policy, {
      case_id: "case-non-voting-escalation",
      action_digest: actionDigest,
      context_manifest_digest: contextDigest,
      opened_at: openedAt,
    });
    const escalated = addEscalationParticipants(
      policy,
      state,
      "review",
      ["escalated-observer"],
      "2026-07-21T10:01:00.000Z",
    );
    const result = submitPolicyDecision(
      policy,
      escalated,
      decision("review", "escalated-observer", "observer-approval", "2026-07-21T10:02:00.000Z"),
    );

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("participant_not_authorized_to_vote");
    expect(result.state.lifecycle).toBe("open");
    expect(result.state.stages.review?.non_voting_participant_ids).toEqual(["escalated-observer"]);
  });

  it("fails closed at a deadline, including the exact deadline instant", () => {
    const policy = compileApprovalPolicy(
      policyWithStages([
        {
          id: "review",
          activation: { depends_on: [], dependency_join: "all_satisfied" },
          approval_rule: { kind: "single" },
          participants: { ids: ["reviewer"] },
          decisions: { allow: ["approve", "decline"] },
          deadline: { anchor: "stage_opened", after: "PT5M" },
        },
      ]),
    );
    const state = openPolicyCase(policy, {
      case_id: "case-timeout",
      action_digest: actionDigest,
      context_manifest_digest: contextDigest,
      opened_at: openedAt,
    });
    const result = submitPolicyDecision(
      policy,
      state,
      decision("review", "reviewer", "late-decision", "2026-07-21T10:05:00.000Z"),
    );

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("case_not_open");
    expect(result.state.outcome).toBe("declined");
  });

  it("does not let continuing escalation accept a late vote without a fresh delivery window", () => {
    const policy = compileApprovalPolicy(
      policyWithStages(
        [
          {
            id: "review",
            activation: { depends_on: [], dependency_join: "all_satisfied" },
            approval_rule: { kind: "single" },
            participants: { ids: ["reviewer"] },
            decisions: { allow: ["approve", "decline"] },
            deadline: { anchor: "last_delivery_attempted", after: "PT5M" },
          },
        ],
        "continue_escalation",
      ),
    );
    const initiallyOpened = openPolicyCase(policy, {
      case_id: "case-continuing-timeout",
      action_digest: actionDigest,
      context_manifest_digest: contextDigest,
      opened_at: openedAt,
    });
    const delivered = recordPolicyDeliveryAttempt(
      policy,
      initiallyOpened,
      "review",
      "2026-07-21T10:00:00.000Z",
    );

    const late = submitPolicyDecision(
      policy,
      delivered,
      decision("review", "reviewer", "late", "2026-07-21T10:05:00.000Z"),
    );
    expect(late.accepted).toBe(false);
    expect(late.reason).toBe("stage_deadline_elapsed");
    expect(late.state.lifecycle).toBe("open");

    const rearmed = recordPolicyDeliveryAttempt(
      policy,
      late.state,
      "review",
      "2026-07-21T10:06:00.000Z",
    );
    const accepted = submitPolicyDecision(
      policy,
      rearmed,
      decision("review", "reviewer", "fresh-window", "2026-07-21T10:06:01.000Z"),
    );
    expect(accepted.accepted).toBe(true);
    expect(accepted.state.outcome).toBe("approved");
  });

  it("requires an explicit policy opt-in before accepting a future effective time", () => {
    const source = policyWithStages([
      {
        id: "review",
        activation: { depends_on: [], dependency_join: "all_satisfied" },
        approval_rule: { kind: "single" },
        participants: { ids: ["reviewer"] },
        decisions: { allow: ["approve", "decline"] },
      },
    ]);
    const policy = compileApprovalPolicy(source);
    expect(() =>
      openPolicyCase(policy, {
        case_id: "case-effective-denied",
        action_digest: actionDigest,
        context_manifest_digest: contextDigest,
        opened_at: openedAt,
        effective_at: "2026-07-21T11:00:00.000Z",
      }),
    ).toThrow("effective_at is not allowed");

    const allowed = compileApprovalPolicy({
      ...source,
      spec: {
        ...source.spec,
        scheduling: { allow_effective_at: true, require_recheck_before_effective: true },
      },
    });
    expect(
      openPolicyCase(allowed, {
        case_id: "case-effective-allowed",
        action_digest: actionDigest,
        context_manifest_digest: contextDigest,
        opened_at: openedAt,
        effective_at: "2026-07-21T11:00:00.000Z",
      }).lifecycle,
    ).toBe("open");
  });

  it("rejects unsafe timeout outcomes and cyclic stage dependencies", () => {
    const unsafeTimeout = policyWithStages(
      [
        {
          id: "review",
          activation: { depends_on: [], dependency_join: "all_satisfied" },
          approval_rule: { kind: "single" },
          participants: { ids: ["reviewer"] },
          decisions: { allow: ["approve", "decline"] },
        },
      ],
      "approve",
    );
    expect(() => compileApprovalPolicy(unsafeTimeout)).toThrow(PolicyValidationError);

    const cyclic = policyWithStages([
      {
        id: "first",
        activation: { depends_on: ["second"], dependency_join: "all_satisfied" },
        approval_rule: { kind: "single" },
        participants: { ids: ["one"] },
        decisions: { allow: ["approve", "decline"] },
      },
      {
        id: "second",
        activation: { depends_on: ["first"], dependency_join: "all_satisfied" },
        approval_rule: { kind: "single" },
        participants: { ids: ["two"] },
        decisions: { allow: ["approve", "decline"] },
      },
    ]);
    expect(() => compileApprovalPolicy(cyclic)).toThrow("dependency graph must be acyclic");
  });
});
