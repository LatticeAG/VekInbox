/**
 * Safety rails for the legacy /v1 reviewer surface.
 *
 * These guards intentionally do not try to turn v1 records into v3 cases. They
 * only prevent the browser from submitting outcomes that the v1 compatibility
 * model cannot map safely, and keep obviously sensitive fields out of the
 * diagnostic UI.
 */

export const SAFE_LEGACY_TIMEOUT_OUTCOMES = ["decline", "escalate"] as const;

export type SafeLegacyTimeoutOutcome =
  (typeof SAFE_LEGACY_TIMEOUT_OUTCOMES)[number];

export function isSafeLegacyTimeoutOutcome(
  value: string | null | undefined,
): value is SafeLegacyTimeoutOutcome {
  return value === "decline" || value === "escalate";
}

/**
 * A legacy policy with an unsafe historic value must fail closed when it is
 * viewed or re-saved. v3 does not allow silence to authorize an action.
 */
export function normalizeLegacyTimeoutOutcome(
  value: string | null | undefined,
): SafeLegacyTimeoutOutcome {
  return value === "escalate" ? "escalate" : "decline";
}

export const SAFE_LEGACY_DECISION_ACTIONS = [
  "approve",
  "decline",
  "request_changes",
] as const;

export type SafeLegacyDecisionAction =
  (typeof SAFE_LEGACY_DECISION_ACTIONS)[number];

export function isSafeLegacyDecisionAction(
  action: string,
): action is SafeLegacyDecisionAction {
  return (
    action === "approve" ||
    action === "decline" ||
    action === "request_changes"
  );
}

interface NamedAction {
  name: string;
}

export function partitionLegacyDecisionActions<T extends NamedAction>(
  actions: readonly T[],
): { safeActions: T[]; blockedActionNames: string[] } {
  const safeActions: T[] = [];
  const blockedActionNames: string[] = [];

  for (const action of actions) {
    if (isSafeLegacyDecisionAction(action.name)) {
      safeActions.push(action);
    } else {
      blockedActionNames.push(action.name);
    }
  }

  return { safeActions, blockedActionNames };
}

const SENSITIVE_FIELD_NAME =
  /(api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|token)/i;

const MAX_AUDIT_VALUE_LENGTH = 2_000;
const MAX_AUDIT_ITEMS = 50;
const MAX_AUDIT_DEPTH = 6;

export function isSensitiveFieldName(name: string): boolean {
  return SENSITIVE_FIELD_NAME.test(name);
}

function truncateAuditString(value: string): string {
  if (value.length <= MAX_AUDIT_VALUE_LENGTH) return value;
  return `${value.slice(0, MAX_AUDIT_VALUE_LENGTH)}… [truncated]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactAuditValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_AUDIT_DEPTH) return "[nested value omitted]";

  if (typeof value === "string") return truncateAuditString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    const entries = value
      .slice(0, MAX_AUDIT_ITEMS)
      .map((item) => redactAuditValue(item, depth + 1));
    if (value.length > MAX_AUDIT_ITEMS) {
      entries.push(`[${value.length - MAX_AUDIT_ITEMS} items omitted]`);
    }
    return entries;
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        isSensitiveFieldName(key)
          ? "[redacted]"
          : redactAuditValue(nestedValue, depth + 1),
      ]),
    );
  }

  return "[unsupported value]";
}

/**
 * Legacy event payloads were not designed as disclosure-filtered audit facts.
 * Keep the technical diagnostic useful while redacting common credential fields
 * and bounding pathological payloads before rendering them in the browser.
 */
export function redactLegacyAuditPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return redactAuditValue(payload, 0) as Record<string, unknown>;
}
