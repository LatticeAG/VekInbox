import type {
  ApprovalNotification,
  ContentClassification,
  NotificationProviderKey,
} from "./types.js";

export interface RenderedNotification {
  provider: NotificationProviderKey;
  subject: string;
  text: string;
  /** A message may only navigate to an authenticated decision surface. */
  action: "open_securely";
  deepLink: string;
}

const KEY_VALUE_PATTERN = /(\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)([^\s,;]+)/gi;
const BEARER_PATTERN = /(\bBearer\s+)([^\s,;]+)/gi;
const API_KEY_PATTERN = /\b(?:sk|pk|vk|dse)_[A-Za-z0-9_-]{6,}\b/g;
const SENSITIVE_QUERY_PATTERN = /([?&](?:api[_-]?key|token|secret|password|signature|sig)=)([^&#\s]+)/gi;

const MAX_TITLE_LENGTH = 180;
const MAX_SUMMARY_LENGTH = 700;

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

/**
 * This is defence in depth for text that was already selected by a disclosure
 * policy. It is intentionally conservative rather than trying to turn raw
 * evidence into a safe notification body.
 */
export function redactText(value: string): string {
  return value
    .replace(KEY_VALUE_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(BEARER_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`)
    .replace(API_KEY_PATTERN, "[REDACTED]")
    .replace(SENSITIVE_QUERY_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED]`);
}

function titleForClassification(
  title: string,
  classification: ContentClassification,
): string {
  if (classification === "confidential" || classification === "restricted") {
    return "Approval requires your attention";
  }
  return truncate(redactText(title), MAX_TITLE_LENGTH) || "Approval requires your attention";
}

function summaryForClassification(notification: ApprovalNotification): string | undefined {
  if (notification.classification === "confidential" || notification.classification === "restricted") {
    return undefined;
  }

  const summary = notification.summary ? redactText(notification.summary) : undefined;
  if (notification.classification === "internal") {
    return summary ? truncate(summary, MAX_SUMMARY_LENGTH) : "Open VekInbox to review this approval.";
  }

  const excerpt = notification.contextExcerpt ? redactText(notification.contextExcerpt) : undefined;
  return truncate([summary, excerpt].filter((value): value is string => Boolean(value)).join("\n"), MAX_SUMMARY_LENGTH) || undefined;
}

function urgencyPrefix(urgency: ApprovalNotification["urgency"]): string {
  if (urgency === "critical") return "Critical approval notice";
  if (urgency === "high") return "High-priority approval notice";
  return "Approval notice";
}

/** Renders only disclosure-filtered fields for email and Slack. */
export function renderNotification(
  provider: "email" | "slack",
  notification: ApprovalNotification,
): RenderedNotification {
  const title = titleForClassification(notification.title, notification.classification);
  const summary = summaryForClassification(notification);
  const lines = [urgencyPrefix(notification.urgency), title];

  if (summary) {
    lines.push(summary);
  }
  lines.push(`Open securely in VekInbox: ${notification.deepLink}`);

  return {
    provider,
    subject: `[VekInbox] ${title}`,
    text: lines.join("\n\n"),
    action: "open_securely",
    deepLink: notification.deepLink,
  };
}

/**
 * SMS never receives case titles, summaries, context, or actionable controls.
 * It is deliberately a neutral prompt to open the authenticated inbox.
 */
export function renderNeutralSms(notification: ApprovalNotification): RenderedNotification {
  const urgency = notification.urgency === "critical" ? "Urgent " : "";
  return {
    provider: "sms",
    subject: "VekInbox approval notice",
    text: `${urgency}VekInbox approval requires your attention. Open securely: ${notification.deepLink}`,
    action: "open_securely",
    deepLink: notification.deepLink,
  };
}

export function redactedEndpointHint(destination: string): string {
  const trimmed = destination.trim();
  if (!trimmed) return "[empty]";
  if (trimmed.includes("@")) {
    const [local, domain] = trimmed.split("@", 2);
    return `${local?.slice(0, 1) ?? "*"}***@${domain ?? "***"}`;
  }
  return `***${trimmed.slice(-4)}`;
}

export function redactedDeliveryLog(
  provider: NotificationProviderKey,
  notification: ApprovalNotification,
  destination: string,
): Record<string, unknown> {
  return {
    provider,
    delivery_id: notification.deliveryId,
    intent_id: notification.intentId,
    case_id: notification.caseId,
    stage_id: notification.stageId,
    risk_class: notification.riskClass,
    classification: notification.classification,
    urgency: notification.urgency,
    endpoint: redactedEndpointHint(destination),
    action: "open_securely",
  };
}
