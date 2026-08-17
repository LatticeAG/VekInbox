/**
 * V0 requests intentionally accept arbitrary metadata.  This module gives the
 * reviewer UI one small, defensive compatibility layer for richer v3-shaped
 * metadata without making the browser depend on a v2 endpoint or pretending a
 * legacy request has stronger guarantees than it does.
 */

import { isSensitiveFieldName } from "./approval-safety";

export type ReviewContextItemType =
  | "diff"
  | "log"
  | "link"
  | "artifact"
  | "instruction"
  | "field";

export interface ReviewContextItem {
  id: string;
  type: ReviewContextItemType;
  title: string;
  digest: string | null;
  classification: string | null;
  content: string | null;
  href: string | null;
  provenance: string | null;
  acknowledgementRequired: boolean;
}

export interface ReviewPolicyContext {
  name: string | null;
  version: string | null;
  stage: string | null;
  requirement: string | null;
  trace: string | null;
  template: string | null;
}

export interface ReviewEscalationContext {
  state: string | null;
  step: string | null;
  nextAt: string | null;
  target: string | null;
}

export interface ReviewRevisionContext {
  current: string | null;
  supersedes: string | null;
  supersededBy: string | null;
  freshness: string | null;
}

export interface ApprovalReviewContext {
  actionSummary: string;
  actionDigest: string | null;
  contextManifestDigest: string | null;
  actionFields: Array<{ label: string; value: string }>;
  policy: ReviewPolicyContext;
  escalation: ReviewEscalationContext;
  revision: ReviewRevisionContext;
  riskExplanation: string | null;
  preconditions: string[];
  evidence: ReviewContextItem[];
  rationaleRequired: boolean;
}

export interface ApprovalReviewSource {
  title: string;
  requestId: string;
  requestKey: string;
  priority: string;
  status: string;
  timeoutAt?: string | null;
  escalationPolicyId?: string | null;
  metadata?: Record<string, unknown> | null;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true";
}

function recordValue(value: unknown): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(records: UnknownRecord[], keys: string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = stringValue(record[key]);
      if (value) return value;
    }
  }

  return null;
}

function firstRecord(records: UnknownRecord[], keys: string[]): UnknownRecord | null {
  for (const record of records) {
    for (const key of keys) {
      const value = recordValue(record[key]);
      if (value) return value;
    }
  }

  return null;
}

function firstBoolean(records: UnknownRecord[], keys: string[]): boolean {
  return records.some((record) => keys.some((key) => booleanValue(record[key])));
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^./, (first) => first.toUpperCase());
}

function valueToDisplay(value: unknown): string | null {
  const primitive = stringValue(value);
  if (primitive) return primitive;

  if (Array.isArray(value)) {
    const values = value
      .map((entry) => stringValue(entry))
      .filter((entry): entry is string => Boolean(entry));
    return values.length ? values.join(", ") : null;
  }

  return null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => stringValue(entry) ?? recordValue(entry)?.["id"])
      .map((entry) => stringValue(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  const single = stringValue(value);
  return single ? [single] : [];
}

function validExternalHref(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    // The browser should not turn legacy metadata into an insecure or
    // credential-bearing navigation. V3 evidence links are secure deep links
    // or externally managed HTTPS destinations.
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function contextType(value: unknown, fallback: ReviewContextItemType): ReviewContextItemType {
  const type = stringValue(value)?.toLowerCase().replace(/[-_ ]/g, "");
  switch (type) {
    case "diff":
    case "patch":
      return "diff";
    case "log":
    case "logs":
    case "logbundle":
      return "log";
    case "link":
    case "externallink":
    case "url":
      return "link";
    case "artifact":
    case "attestation":
    case "provenance":
      return "artifact";
    case "instruction":
    case "reviewerinstruction":
      return "instruction";
    case "field":
    case "structuredfield":
      return "field";
    default:
      return fallback;
  }
}

function itemTitle(type: ReviewContextItemType, index: number): string {
  switch (type) {
    case "diff":
      return `Proposed diff ${index + 1}`;
    case "log":
      return `Log bundle ${index + 1}`;
    case "link":
      return `Reference link ${index + 1}`;
    case "artifact":
      return `Artifact ${index + 1}`;
    case "instruction":
      return `Reviewer instruction ${index + 1}`;
    case "field":
      return `Structured context ${index + 1}`;
  }
}

function contextItem(
  value: unknown,
  fallbackType: ReviewContextItemType,
  index: number,
): ReviewContextItem | null {
  const record = recordValue(value);
  const primitive = stringValue(value);
  const type = contextType(record?.["type"] ?? record?.["kind"], fallbackType);

  const href = validExternalHref(
    stringValue(record?.["href"] ?? record?.["url"] ?? record?.["link"]),
  );
  const content =
    stringValue(
      record?.["content"] ??
        record?.["body"] ??
        record?.["diff"] ??
        record?.["patch"] ??
        record?.["preview"] ??
        record?.["log"] ??
        record?.["text"] ??
        record?.["message"] ??
        record?.["value"],
    ) ?? (type === "link" ? null : primitive);

  if (!record && !primitive) return null;
  if (type === "link" && !href && !content) return null;

  const title =
    stringValue(record?.["title"] ?? record?.["name"] ?? record?.["label"]) ??
    itemTitle(type, index);
  const id =
    stringValue(record?.["id"] ?? record?.["key"] ?? record?.["digest"]) ??
    `${type}-${index + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return {
    id,
    type,
    title,
    digest: stringValue(record?.["digest"] ?? record?.["sha256"]),
    classification: stringValue(record?.["classification"] ?? record?.["class"]),
    content,
    href,
    provenance: stringValue(record?.["provenance"] ?? record?.["source"]),
    acknowledgementRequired: firstBoolean(
      record ? [record] : [],
      ["acknowledgement_required", "acknowledgment_required", "requires_acknowledgement"],
    ),
  };
}

function collectContextItems(records: UnknownRecord[]): ReviewContextItem[] {
  const collected: ReviewContextItem[] = [];
  const seen = new Set<string>();

  const add = (value: unknown, type: ReviewContextItemType) => {
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      const item = contextItem(entry, type, collected.length);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      collected.push(item);
    }
  };

  for (const record of records) {
    for (const key of ["context_items", "evidence", "attachments"]) {
      for (const entry of arrayValue(record[key])) {
        add(entry, "field");
      }
    }

    add(record["diff"], "diff");
    add(record["diffs"], "diff");
    add(record["patch"], "diff");
    add(record["logs"], "log");
    add(record["log_bundle"], "log");
    add(record["log"], "log");
    add(record["links"], "link");
    add(record["external_links"], "link");
    add(record["artifacts"], "artifact");
    add(record["instructions"], "instruction");
  }

  return collected;
}

function actionFields(records: UnknownRecord[]): Array<{ label: string; value: string }> {
  const fields = firstRecord(records, [
    "structured_fields",
    "fields",
    "parameters",
    "arguments",
  ]);

  if (!fields) return [];

  return Object.entries(fields)
    .map(([label, value]) => {
      const displayValue = valueToDisplay(value);
      if (!displayValue) return null;

      return {
        label: humanize(label),
        value: isSensitiveFieldName(label)
          ? "[Redacted in legacy preview]"
          : displayValue,
      };
    })
    .filter(
      (field): field is { label: string; value: string } => field !== null,
    )
    .slice(0, 8);
}

function policyRequirement(
  records: UnknownRecord[],
  policy: UnknownRecord | null,
): string | null {
  const policyRecords = policy ? [policy, ...records] : records;
  const direct = firstString(policyRecords, [
    "requirement",
    "strategy",
    "mode",
    "approval_mode",
    "rule",
  ]);
  if (direct) return humanize(direct);

  const quorum = firstString(policyRecords, ["quorum", "required_approvals"]);
  const participants = stringList(
    policy?.["required_participants"] ?? policy?.["participants"],
  );
  if (quorum && participants.length) return `${quorum} of ${participants.length} reviewers`;
  if (quorum) return `${quorum} required approvals`;
  if (participants.length === 1) return "Single reviewer";
  if (participants.length > 1) return `All ${participants.length} reviewers`;

  return null;
}

export function createApprovalReviewContext(
  source: ApprovalReviewSource,
): ApprovalReviewContext {
  const metadata = source.metadata ?? {};
  const approval = firstRecord([metadata], ["approval", "approval_context", "v3", "review"]);
  const action = firstRecord(
    approval ? [approval, metadata] : [metadata],
    ["action", "action_intent", "action_snapshot"],
  );
  const policy = firstRecord(
    approval ? [approval, metadata] : [metadata],
    ["policy", "approval_policy"],
  );
  const stage = firstRecord(
    policy ? [policy, approval ?? {}, metadata] : [approval ?? {}, metadata],
    ["stage", "current_stage"],
  );
  const escalation = firstRecord(
    approval ? [approval, metadata] : [metadata],
    ["escalation", "escalation_state"],
  );
  const revision = firstRecord(
    approval ? [approval, metadata] : [metadata],
    ["revision", "case_revision"],
  );

  const records = [metadata, approval, action, policy, stage].filter(
    (record): record is UnknownRecord => Boolean(record),
  );
  const actionRecords = [action, approval, metadata].filter(
    (record): record is UnknownRecord => Boolean(record),
  );
  const escalationRecords = [escalation, approval, metadata].filter(
    (record): record is UnknownRecord => Boolean(record),
  );
  const revisionRecords = [revision, approval, metadata].filter(
    (record): record is UnknownRecord => Boolean(record),
  );

  const actionSummary =
    firstString(actionRecords, [
      "action_summary",
      "summary",
      "what_will_happen",
      "human_summary",
      "description",
      "operation",
      "label",
      "action",
    ]) ?? source.title;

  const requiredAcknowledgements = new Set(
    records.flatMap((record) => [
      ...stringList(record["required_evidence"]),
      ...stringList(record["required_acknowledgements"]),
      ...stringList(record["required_context_items"]),
    ]),
  );
  const requireAllEvidenceAcknowledgement = firstBoolean(records, [
    "require_evidence_acknowledgement",
    "require_evidence_acknowledgment",
    "evidence_acknowledgement_required",
  ]);

  const evidence = collectContextItems(records).map((item) => ({
    ...item,
    acknowledgementRequired:
      item.acknowledgementRequired ||
      requireAllEvidenceAcknowledgement ||
      requiredAcknowledgements.has(item.id) ||
      requiredAcknowledgements.has(item.title),
  }));

  const policyRecords = [policy, approval, metadata].filter(
    (record): record is UnknownRecord => Boolean(record),
  );
  const stageLabel =
    firstString(
      [stage, policy, approval, metadata].filter(
        (record): record is UnknownRecord => Boolean(record),
      ),
      ["stage_name", "name", "current_stage", "stage"],
    ) ?? null;

  return {
    actionSummary,
    actionDigest: firstString(actionRecords, ["action_digest", "digest", "actionDigest"]),
    contextManifestDigest: firstString(records, [
      "context_manifest_digest",
      "contextManifestDigest",
      "manifest_digest",
    ]),
    actionFields: actionFields(actionRecords),
    policy: {
      name:
        firstString(policyRecords, ["policy_name", "name", "id", "policy", "approval_policy"]) ??
        source.escalationPolicyId ??
        null,
      version: firstString(policyRecords, ["policy_version", "version"]),
      stage: stageLabel,
      requirement: policyRequirement(records, policy),
      trace: firstString(policyRecords, ["policy_trace", "trace", "evaluation_trace"]),
      template: firstString(records, ["template", "template_name", "template_version"]),
    },
    escalation: {
      state:
        firstString(escalationRecords, ["escalation_status", "state", "escalation_state"]) ??
        (source.status === "escalated" ? "Escalated" : null),
      step: firstString(escalationRecords, ["current_step", "step", "escalation_step"]),
      nextAt: firstString(escalationRecords, ["next_at", "next_escalation_at", "due_at"]),
      target: firstString(escalationRecords, ["target", "assignee", "manager", "notify"]),
    },
    revision: {
      current: firstString(revisionRecords, ["revision_number", "number", "version", "revision"]),
      supersedes: firstString(revisionRecords, ["supersedes", "supersedes_id"]),
      supersededBy: firstString(revisionRecords, ["superseded_by", "superseded_by_id"]),
      freshness: firstString(revisionRecords, [
        "context_freshness",
        "manifest_sealed_at",
        "context_updated_at",
      ]),
    },
    riskExplanation: firstString(actionRecords, [
      "risk_explanation",
      "risk",
      "risk_summary",
    ]),
    preconditions: records.flatMap((record) => stringList(record["preconditions"])),
    evidence,
    rationaleRequired: firstBoolean(records, [
      "rationale_required",
      "require_rationale",
      "mandatory_rationale",
    ]),
  };
}
