import {
  canonicalJson,
  digestCanonical,
  isSha256Digest,
  normalizeSha256Digest,
  sha256Hex,
} from "./canonical.js";

export const CONTEXT_ITEM_TYPES = [
  "structured_fields",
  "diff",
  "log_bundle",
  "screenshot",
  "artifact",
  "external_link",
  "reviewer_instruction",
  "decision_evidence",
] as const;
export type ContextItemType = (typeof CONTEXT_ITEM_TYPES)[number];

export const EVIDENCE_CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
export type EvidenceClassification = (typeof EVIDENCE_CLASSIFICATIONS)[number];
export type RedactionState = "none" | "partial" | "full";

export interface EvidenceProvenance {
  source: string;
  observed_at?: string;
  verifier?: string;
}

export interface ContextItem {
  id: string;
  type: ContextItemType;
  content_digest: string;
  classification: EvidenceClassification;
  redaction: RedactionState;
  provenance: EvidenceProvenance;
  media_type?: string;
  size_bytes?: number;
  line_count?: number;
  external_url?: string;
  summary?: string;
}

export interface CreateContextItemInput {
  id: string;
  type: ContextItemType;
  /** Content is used only to calculate/verify the digest and is never retained in the item. */
  content?: string | Uint8Array | Record<string, unknown>;
  content_digest?: string;
  classification?: EvidenceClassification;
  redaction?: RedactionState;
  provenance?: EvidenceProvenance;
  media_type?: string;
  size_bytes?: number;
  line_count?: number;
  external_url?: string;
  summary?: string;
}

export interface ContextManifest {
  version: 1;
  items: ContextItem[];
  effective_classification: EvidenceClassification;
  context_manifest_digest: string;
}

const CLASSIFICATION_ORDER: Record<EvidenceClassification, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

function assertItemType(value: string): asserts value is ContextItemType {
  if (!(CONTEXT_ITEM_TYPES as readonly string[]).includes(value)) {
    throw new TypeError(`Unsupported context item type '${value}'`);
  }
}

function assertClassification(value: string): asserts value is EvidenceClassification {
  if (!(EVIDENCE_CLASSIFICATIONS as readonly string[]).includes(value)) {
    throw new TypeError(`Unsupported evidence classification '${value}'`);
  }
}

function digestContent(content: CreateContextItemInput["content"]): string {
  if (typeof content === "string" || content instanceof Uint8Array) {
    return sha256Hex(content);
  }
  return digestCanonical(content);
}

function normalizeOptionalNumber(value: number | undefined, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative integer`);
  }
  return value;
}

function optionalNonEmptyString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string when provided`);
  }
  return value;
}

function normalizeProvenance(value: unknown): EvidenceProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("provenance must be an object with a source");
  }
  const record = value as Record<string, unknown>;
  const source = optionalNonEmptyString(record["source"], "provenance.source");
  if (!source) {
    throw new TypeError("provenance.source is required");
  }
  const observedAt = optionalNonEmptyString(record["observed_at"], "provenance.observed_at");
  if (observedAt !== undefined && Number.isNaN(Date.parse(observedAt))) {
    throw new TypeError("provenance.observed_at must be an RFC 3339 instant");
  }
  const verifier = optionalNonEmptyString(record["verifier"], "provenance.verifier");
  return {
    source,
    ...(observedAt === undefined ? {} : { observed_at: observedAt }),
    ...(verifier === undefined ? {} : { verifier }),
  };
}

/** Registers metadata for content-addressed evidence without retaining raw contents. */
export function createContextItem(input: CreateContextItemInput): ContextItem {
  if (typeof input.id !== "string" || input.id.trim().length === 0) {
    throw new TypeError("Context item id is required");
  }
  assertItemType(input.type);
  const classification = input.classification ?? "internal";
  assertClassification(classification);
  const redaction = input.redaction ?? "none";
  if (!["none", "partial", "full"].includes(redaction)) {
    throw new TypeError("redaction must be none, partial, or full");
  }
  const observedDigest = input.content === undefined ? undefined : digestContent(input.content);
  const claimedDigest =
    input.content_digest === undefined ? undefined : normalizeSha256Digest(input.content_digest);
  const digest = claimedDigest ?? observedDigest;
  if (!digest || !isSha256Digest(digest)) {
    throw new TypeError("content_digest or content is required and must produce a SHA-256 digest");
  }
  if (observedDigest && observedDigest !== digest) {
    throw new TypeError("trusted content digest does not match claimed content_digest");
  }
  let externalUrl: string | undefined;
  if (input.type === "external_link") {
    if (typeof input.external_url !== "string" || input.external_url.trim().length === 0) {
      throw new TypeError("external_link requires external_url");
    }
    const parsed = new URL(input.external_url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new TypeError("external_link must use credential-free HTTPS");
    }
    externalUrl = parsed.toString();
  } else if (input.external_url !== undefined) {
    throw new TypeError("external_url is only valid for external_link");
  }
  if (input.line_count !== undefined && input.type !== "diff" && input.type !== "log_bundle") {
    throw new TypeError("line_count is only valid for diff and log_bundle items");
  }
  const provenance = normalizeProvenance(input.provenance ?? { source: "unknown" });
  const mediaType = optionalNonEmptyString(input.media_type, "media_type");
  const summary = optionalNonEmptyString(input.summary, "summary");
  return {
    id: input.id,
    type: input.type,
    content_digest: normalizeSha256Digest(digest),
    classification,
    redaction,
    provenance: { ...provenance },
    ...(mediaType === undefined ? {} : { media_type: mediaType }),
    ...(normalizeOptionalNumber(input.size_bytes, "size_bytes") === undefined
      ? {}
      : { size_bytes: input.size_bytes! }),
    ...(normalizeOptionalNumber(input.line_count, "line_count") === undefined
      ? {}
      : { line_count: input.line_count! }),
    ...(externalUrl === undefined ? {} : { external_url: externalUrl }),
    ...(summary === undefined ? {} : { summary }),
  };
}

/** Re-validates a stored item so hand-built objects cannot bypass item rules. */
function normalizeStoredContextItem(item: ContextItem): ContextItem {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new TypeError("Context item must be an object");
  }
  return createContextItem({
    id: item.id,
    type: item.type,
    content_digest: item.content_digest,
    classification: item.classification,
    redaction: item.redaction,
    provenance: item.provenance,
    ...(item.media_type === undefined ? {} : { media_type: item.media_type }),
    ...(item.size_bytes === undefined ? {} : { size_bytes: item.size_bytes }),
    ...(item.line_count === undefined ? {} : { line_count: item.line_count }),
    ...(item.external_url === undefined ? {} : { external_url: item.external_url }),
    ...(item.summary === undefined ? {} : { summary: item.summary }),
  });
}

function manifestPayload(items: readonly ContextItem[], effectiveClassification: EvidenceClassification) {
  return {
    version: 1 as const,
    effective_classification: effectiveClassification,
    items: items.map((item) => ({
      id: item.id,
      type: item.type,
      content_digest: item.content_digest,
      classification: item.classification,
      redaction: item.redaction,
      provenance: item.provenance,
      ...(item.media_type === undefined ? {} : { media_type: item.media_type }),
      ...(item.size_bytes === undefined ? {} : { size_bytes: item.size_bytes }),
      ...(item.line_count === undefined ? {} : { line_count: item.line_count }),
      ...(item.external_url === undefined ? {} : { external_url: item.external_url }),
      ...(item.summary === undefined ? {} : { summary: item.summary }),
    })),
  };
}

/** Seals a deterministic manifest. Any material evidence change yields a new digest. */
export function sealContextManifest(items: readonly ContextItem[]): ContextManifest {
  if (items.length === 0) {
    throw new TypeError("A context manifest must contain at least one item");
  }
  const sorted = [...items]
    .map(normalizeStoredContextItem)
    .sort((left, right) => left.id.localeCompare(right.id));
  const seen = new Set<string>();
  for (const item of sorted) {
    if (seen.has(item.id)) {
      throw new TypeError(`Context manifest contains duplicate item '${item.id}'`);
    }
    seen.add(item.id);
    assertItemType(item.type);
    assertClassification(item.classification);
    if (!isSha256Digest(item.content_digest)) {
      throw new TypeError(`Context item '${item.id}' has an invalid content digest`);
    }
  }
  const effectiveClassification = sorted.reduce<EvidenceClassification>(
    (current, item) =>
      CLASSIFICATION_ORDER[item.classification] > CLASSIFICATION_ORDER[current]
        ? item.classification
        : current,
    "public",
  );
  const payload = manifestPayload(sorted, effectiveClassification);
  return {
    ...payload,
    context_manifest_digest: digestCanonical(payload),
  };
}

export function verifyContextManifest(manifest: ContextManifest): boolean {
  try {
    if (manifest.version !== 1) return false;
    const normalizedItems = manifest.items.map(normalizeStoredContextItem);
    const sealed = sealContextManifest(normalizedItems);
    return (
      sealed.context_manifest_digest === normalizeSha256Digest(manifest.context_manifest_digest) &&
      sealed.effective_classification === manifest.effective_classification &&
      canonicalJson(sealed.items) === canonicalJson(normalizedItems)
    );
  } catch {
    return false;
  }
}

export type NotificationSurface = "web" | "email" | "chat" | "sms" | "push";

/** Returns policy-safe context summaries; it never returns raw content. */
export function disclosureForSurface(
  manifest: ContextManifest,
  surface: NotificationSurface,
): Array<Pick<ContextItem, "id" | "type" | "summary" | "content_digest">> {
  if (!verifyContextManifest(manifest)) {
    throw new TypeError("Cannot disclose an invalid context manifest");
  }
  const allowSummary = (item: ContextItem): boolean => {
    if (surface === "web") {
      return true;
    }
    if (item.classification === "restricted" || item.classification === "confidential") {
      return false;
    }
    return surface !== "sms" && surface !== "push" ? item.classification !== "internal" || item.redaction !== "full" : false;
  };
  return manifest.items.filter(allowSummary).map((item) => ({
    id: item.id,
    type: item.type,
    content_digest: item.content_digest,
    ...(item.summary === undefined ? {} : { summary: item.summary }),
  }));
}
