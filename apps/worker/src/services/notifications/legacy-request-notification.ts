import type {
  ApprovalNotification,
  ApprovalRiskClass,
  NotificationUrgency,
} from "./types.js";

export interface LegacyApprovalRequestSnapshot {
  id: string;
  title: string;
  description: string;
  priority: "low" | "normal" | "high" | "critical";
  timeoutAt: Date | null;
}

function webBaseUrl(): string {
  return (process.env["WEB_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
}

function riskForPriority(priority: LegacyApprovalRequestSnapshot["priority"]): ApprovalRiskClass {
  switch (priority) {
    case "critical":
      return "R3";
    case "high":
      return "R2";
    case "low":
    case "normal":
      return "R1";
  }
}

function urgencyForPriority(
  priority: LegacyApprovalRequestSnapshot["priority"],
): NotificationUrgency {
  switch (priority) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "low":
    case "normal":
      return "normal";
  }
}

/**
 * Legacy requests have no trusted context classification. Treat them as
 * confidential on every external channel: only a neutral title and an
 * authenticated web-inbox deep link can leave the worker.
 */
export function buildLegacyApprovalNotification(
  request: LegacyApprovalRequestSnapshot,
  deliveryId: string,
): ApprovalNotification {
  return {
    deliveryId,
    intentId: deliveryId,
    caseId: request.id,
    riskClass: riskForPriority(request.priority),
    classification: "confidential",
    urgency: urgencyForPriority(request.priority),
    expiresAt: request.timeoutAt?.toISOString() ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    title: request.title,
    // The renderer will withhold this because the legacy classification is
    // confidential. Keeping it here preserves a future audited payload shape
    // without sending it to a provider today.
    summary: request.description || undefined,
    deepLink: `${webBaseUrl()}/inbox/${encodeURIComponent(request.id)}`,
  };
}
