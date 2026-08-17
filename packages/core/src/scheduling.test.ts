import { describe, expect, it } from "vitest";
import {
  cancelScheduledApproval,
  planCaseOpen,
  planScheduledApproval,
  processPlannedCaseOpen,
  processScheduledApproval,
} from "./index.js";

const actionDigest = `sha256:${"a".repeat(64)}`;
const contextDigest = `sha256:${"b".repeat(64)}`;
const requestedAt = "2030-01-01T00:00:00.000Z";
const effectiveAt = "2030-01-01T00:05:00.000Z";

function scheduled(riskClass: "R0" | "R3" = "R3") {
  return planScheduledApproval({
    id: `sch_${riskClass}`,
    case_id: "case_1",
    stage_id: "security",
    reviewer_id: "reviewer_1",
    intended_decision: "approve",
    action_digest: actionDigest,
    context_manifest_digest: contextDigest,
    requested_at: requestedAt,
    effective_at: effectiveAt,
    risk_class: riskClass,
    ...(riskClass === "R0" ? { allow_unattended: true } : {}),
  });
}

const openSnapshot = {
  lifecycle: "open" as const,
  action_digest: actionDigest,
  context_manifest_digest: contextDigest,
};

describe("scheduled and planned approvals", () => {
  it("requires a fresh step-up confirmation for consequential scheduled decisions", () => {
    const approval = scheduled();
    expect(approval.requires_confirmation).toBe(true);
    expect(approval.minimum_assurance).toBe("step_up");

    expect(
      processScheduledApproval({
        approval,
        snapshot: openSnapshot,
        at: "2030-01-01T00:04:59.000Z",
        is_currently_eligible: true,
      }).reason,
    ).toBe("not_due");

    expect(
      processScheduledApproval({
        approval,
        snapshot: openSnapshot,
        at: effectiveAt,
        is_currently_eligible: true,
      }).reason,
    ).toBe("fresh_confirmation_required");

    const processed = processScheduledApproval({
      approval,
      snapshot: openSnapshot,
      at: effectiveAt,
      is_currently_eligible: true,
      confirmation: {
        reviewer_id: "reviewer_1",
        confirmed_at: effectiveAt,
        assurance: "step_up",
      },
    });
    expect(processed.approval.status).toBe("confirmed_and_submitted");
    expect(processed.decision).toMatchObject({
      id: "scheduled:sch_R3",
      participant_id: "reviewer_1",
      action_digest: "a".repeat(64),
      context_manifest_digest: "b".repeat(64),
    });
  });

  it("does not convert stale, ineligible, or retracted intent into a decision", () => {
    const approval = scheduled();
    const stale = processScheduledApproval({
      approval,
      snapshot: { ...openSnapshot, action_digest: "c".repeat(64) },
      at: effectiveAt,
      is_currently_eligible: true,
    });
    expect(stale).toMatchObject({ reason: "case_or_bound_digest_changed" });
    expect(stale.approval.status).toBe("stale");
    expect(stale.decision).toBeUndefined();

    const retracted = cancelScheduledApproval(approval, "reviewer_changed_mind");
    expect(
      processScheduledApproval({
        approval: retracted,
        snapshot: openSnapshot,
        at: effectiveAt,
        is_currently_eligible: true,
      }).reason,
    ).toBe("scheduled_approval_not_pending");
  });

  it("fails closed for expired, future-dated, or malformed confirmation facts", () => {
    const approval = scheduled();
    const expired = processScheduledApproval({
      approval,
      snapshot: openSnapshot,
      at: "2030-01-01T00:21:00.000Z",
      is_currently_eligible: true,
      confirmation: {
        reviewer_id: "reviewer_1",
        confirmed_at: "2030-01-01T00:21:00.000Z",
        assurance: "step_up",
      },
    });
    expect(expired).toMatchObject({ reason: "confirmation_window_elapsed" });
    expect(expired.approval.status).toBe("expired");

    const futureConfirmation = processScheduledApproval({
      approval,
      snapshot: openSnapshot,
      at: effectiveAt,
      is_currently_eligible: true,
      confirmation: {
        reviewer_id: "reviewer_1",
        confirmed_at: "2030-01-01T00:06:00.000Z",
        assurance: "step_up",
      },
    });
    expect(futureConfirmation.approval.status).toBe("assurance_failed");

    expect(() =>
      planScheduledApproval({
        id: "unsafe-risk",
        case_id: "case_1",
        stage_id: "security",
        reviewer_id: "reviewer_1",
        intended_decision: "approve",
        action_digest: actionDigest,
        context_manifest_digest: contextDigest,
        requested_at: requestedAt,
        effective_at: effectiveAt,
        risk_class: "R5" as never,
      }),
    ).toThrow("risk_class");
  });

  it("only permits opted-in low-risk unattended conversions", () => {
    const approval = scheduled("R0");
    const processed = processScheduledApproval({
      approval,
      snapshot: openSnapshot,
      at: effectiveAt,
      is_currently_eligible: true,
    });
    expect(approval.requires_confirmation).toBe(false);
    expect(processed.decision?.kind).toBe("approve");
  });

  it("opens planned cases only when the version and scheduled state still match", () => {
    const planned = planCaseOpen({
      case_id: "case_plan",
      opens_at: effectiveAt,
      case_version: 2,
    });
    expect(
      processPlannedCaseOpen({
        planned,
        at: "2030-01-01T00:04:00.000Z",
        current_case_version: 2,
        case_is_scheduled: true,
      }).status,
    ).toBe("scheduled");
    expect(
      processPlannedCaseOpen({
        planned,
        at: effectiveAt,
        current_case_version: 3,
        case_is_scheduled: true,
      }).status,
    ).toBe("stale");
    expect(
      processPlannedCaseOpen({
        planned,
        at: effectiveAt,
        current_case_version: 2,
        case_is_scheduled: true,
      }).status,
    ).toBe("opened");
  });
});
