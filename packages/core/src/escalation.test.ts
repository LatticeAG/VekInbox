import { describe, expect, it } from "vitest";
import {
  compileApprovalPolicy,
  compileEscalationLadder,
  evaluateEscalationLadder,
  openPolicyCase,
} from "./index.js";

const actionDigest = "a".repeat(64);
const contextDigest = "b".repeat(64);

function openReviewCase() {
  const policy = compileApprovalPolicy({
    apiVersion: "vekinbox/v3",
    kind: "ApprovalPolicy",
    metadata: { name: "escalation-test", scope: "project" },
    spec: {
      safety: { timeout_outcome: "continue_escalation" },
      workflow: {
        case_completion: { kind: "all_required_stages" },
        stages: [
          {
            id: "review",
            activation: { depends_on: [], dependency_join: "all_satisfied" },
            approval_rule: { kind: "any_of" },
            participants: { ids: ["owner"], on_eligibility_loss: "block_and_escalate" },
            decisions: { allow: ["approve", "decline"] },
            deadline: { anchor: "stage_opened", after: "PT30M" },
          },
        ],
      },
    },
  });
  const caseState = openPolicyCase(policy, {
    case_id: "case-escalation",
    action_digest: actionDigest,
    context_manifest_digest: contextDigest,
    opened_at: "2026-07-21T10:00:00.000Z",
  });
  return { policy, caseState };
}

describe("escalation ladder", () => {
  it("uses a declared manager fallback and makes notification work idempotent", () => {
    const { policy, caseState } = openReviewCase();
    const ladder = compileEscalationLadder(policy, {
      id: "manager-ladder",
      steps: [
        {
          id: "notify-manager",
          scope: "stage",
          stage_ids: ["review"],
          due: { anchor: "stage_opened", after: "PT1M" },
          condition: "stage_unsatisfied",
          effect: "notify",
          targets: [
            {
              kind: "manager",
              subject_id: "owner",
              fallback: { kind: "user", user_id: "backup-manager" },
            },
          ],
        },
      ],
    });
    const resolveTarget = (target: { kind: string }) => {
      if (target.kind === "manager") return null;
      return { participant_ids: ["backup-manager"], source: "declared-manager-fallback" };
    };

    const first = evaluateEscalationLadder({
      policy,
      ladder,
      case_state: caseState,
      at: "2026-07-21T10:01:00.000Z",
      resolve_target: resolveTarget,
    });
    expect(first.new_runs).toHaveLength(1);
    expect(first.new_runs[0]).toMatchObject({
      status: "executed",
      reason: "executed_with_manager_or_target_fallback",
      target_ids: ["backup-manager"],
    });
    expect(first.notification_intents).toEqual([
      expect.objectContaining({
        recipient_id: "backup-manager",
        idempotency_key: "manager-ladder:notify-manager:review:backup-manager",
      }),
    ]);

    const repeated = evaluateEscalationLadder({
      policy,
      ladder,
      case_state: first.case_state,
      runtime: first.runtime,
      at: "2026-07-21T10:02:00.000Z",
      resolve_target: resolveTarget,
    });
    expect(repeated.new_runs).toEqual([]);
    expect(repeated.notification_intents).toEqual([]);
  });

  it("can only terminate a stalled case with a non-approval outcome", () => {
    const { policy, caseState } = openReviewCase();
    const ladder = compileEscalationLadder(policy, {
      id: "terminal-ladder",
      steps: [
        {
          id: "decline-stalled-case",
          scope: "case",
          due: { anchor: "case_opened", after: "PT1M" },
          condition: "case_open",
          effect: "terminate",
          outcome: "declined",
        },
      ],
    });
    const result = evaluateEscalationLadder({
      policy,
      ladder,
      case_state: caseState,
      at: "2026-07-21T10:01:00.000Z",
      resolve_target: () => null,
    });

    expect(result.case_state.lifecycle).toBe("resolved");
    expect(result.case_state.outcome).toBe("declined");
    expect(result.new_runs[0]?.status).toBe("executed");
  });

  it("rejects unsafe termination data and notifies an added escalation participant", () => {
    const { policy, caseState } = openReviewCase();
    expect(() =>
      compileEscalationLadder(policy, {
        id: "unsafe-terminal",
        steps: [
          {
            id: "unsafe",
            scope: "case",
            due: { anchor: "case_opened", after: "PT1M" },
            condition: "case_open",
            effect: "terminate",
            outcome: "approved" as never,
          },
        ],
      }),
    ).toThrow("declined, expired, or cancelled");

    const addablePolicy = compileApprovalPolicy({
      ...policy.source,
      spec: {
        ...policy.source.spec,
        workflow: {
          ...policy.source.spec.workflow,
          stages: policy.source.spec.workflow.stages.map((stage) => ({
            ...stage,
            participants: {
              ...stage.participants,
              escalation_additions: { allowed: true, count_toward_rule: true },
            },
          })),
        },
      },
    });
    const addableCase = openPolicyCase(addablePolicy, {
      case_id: caseState.case_id,
      action_digest: actionDigest,
      context_manifest_digest: contextDigest,
      opened_at: caseState.case_opened_at,
    });
    const ladder = compileEscalationLadder(addablePolicy, {
      id: "add-reviewer",
      steps: [
        {
          id: "add-on-call",
          scope: "stage",
          stage_ids: ["review"],
          due: { anchor: "stage_opened", after: "PT1M" },
          condition: "stage_unsatisfied",
          effect: "add_participants",
          targets: [{ kind: "user", user_id: "on-call" }],
        },
      ],
    });
    const result = evaluateEscalationLadder({
      policy: addablePolicy,
      ladder,
      case_state: addableCase,
      at: "2026-07-21T10:01:00.000Z",
      resolve_target: () => ({ participant_ids: ["on-call"], source: "on-call-snapshot" }),
    });
    expect(result.case_state.stages.review?.participant_ids).toContain("on-call");
    expect(result.notification_intents).toEqual([
      expect.objectContaining({ recipient_id: "on-call", reason: "participant_added" }),
    ]);
  });
});
