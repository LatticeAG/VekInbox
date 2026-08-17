import {
  canonicalJson,
  cloneCanonical,
  digestCanonical,
  normalizeSha256Digest,
  sha256Hex,
} from "./canonical.js";
import type { EvidenceClassification } from "./evidence.js";

export type AuditActorType = "human" | "agent" | "system" | "provider";

export interface AuditActor {
  type: AuditActorType;
  id?: string;
  assurance?: string;
}

export interface AuditLedgerEntry {
  id: string;
  tenant_id: string;
  partition: string;
  sequence: number;
  occurred_at: string;
  event_type: string;
  actor: AuditActor;
  /** Hash only; raw command/decision payloads never enter the ledger object. */
  payload_hash: string;
  classification: EvidenceClassification;
  evidence_digests: string[];
  action_digest?: string;
  context_manifest_digest?: string;
  policy_hash?: string;
  template_hash?: string;
  decision_id?: string;
  correlation_id?: string;
  causation_id?: string;
  key_id?: string;
  previous_entry_hash: string;
  entry_hash: string;
}

export interface AuditLedger {
  tenant_id: string;
  partition: string;
  genesis_hash: string;
  entries: readonly AuditLedgerEntry[];
}

export interface CreateAuditLedgerInput {
  tenant_id: string;
  partition: string;
  /** A tenant may anchor this outside the data plane; otherwise a deterministic genesis is used. */
  genesis_hash?: string;
}

export interface AppendAuditEntryInput {
  id: string;
  event_type: string;
  actor: AuditActor;
  occurred_at?: Date | string;
  /** The payload is hashed before insertion and deliberately not retained. */
  payload?: unknown;
  /** Use when a trusted caller already calculated a canonical payload hash. */
  payload_hash?: string;
  classification?: EvidenceClassification;
  evidence_digests?: readonly string[];
  action_digest?: string;
  context_manifest_digest?: string;
  policy_hash?: string;
  template_hash?: string;
  decision_id?: string;
  correlation_id?: string;
  causation_id?: string;
  key_id?: string;
  /** Compare-and-swap boundary for a database adapter. */
  expected_sequence?: number;
}

export interface AppendAuditEntryResult {
  ledger: AuditLedger;
  entry: AuditLedgerEntry;
}

export interface AppendDecisionAuditEntryInput
  extends Omit<AppendAuditEntryInput, "event_type" | "action_digest" | "context_manifest_digest" | "policy_hash" | "decision_id"> {
  event_type?: "decision.submitted" | "decision.accepted" | "decision.rejected";
  decision_id: string;
  action_digest: string;
  context_manifest_digest: string;
  policy_hash: string;
}

export interface AuditCheckpoint {
  tenant_id: string;
  partition: string;
  from_sequence: number;
  to_sequence: number;
  root_hash: string;
  created_at: string;
  key_id?: string;
}

export interface AuditVerificationResult {
  valid: boolean;
  last_sequence: number;
  last_hash: string;
  reason?: string;
}

export class AuditLedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditLedgerValidationError";
  }
}

export class AuditLedgerConflictError extends AuditLedgerValidationError {
  constructor(message: string) {
    super(message);
    this.name = "AuditLedgerConflictError";
  }
}

const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AuditLedgerValidationError(`${name} must be a non-empty string`);
  }
  return value;
}

function iso(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AuditLedgerValidationError("occurred_at must be a valid RFC 3339 instant");
  }
  return date.toISOString();
}

function normalizeOptionalDigest(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  try {
    return normalizeSha256Digest(value);
  } catch {
    throw new AuditLedgerValidationError(`${name} must be a SHA-256 digest`);
  }
}

function normalizeActor(actor: AuditActor): AuditActor {
  if (!actor || !["human", "agent", "system", "provider"].includes(actor.type)) {
    throw new AuditLedgerValidationError("actor.type is unsupported");
  }
  if (actor.id !== undefined) requireNonEmptyString(actor.id, "actor.id");
  if (actor.assurance !== undefined) requireNonEmptyString(actor.assurance, "actor.assurance");
  return {
    type: actor.type,
    ...(actor.id === undefined ? {} : { id: actor.id }),
    ...(actor.assurance === undefined ? {} : { assurance: actor.assurance }),
  };
}

function entryBody(entry: Omit<AuditLedgerEntry, "previous_entry_hash" | "entry_hash">): Record<string, unknown> {
  return {
    id: entry.id,
    tenant_id: entry.tenant_id,
    partition: entry.partition,
    sequence: entry.sequence,
    occurred_at: entry.occurred_at,
    event_type: entry.event_type,
    actor: entry.actor,
    payload_hash: entry.payload_hash,
    classification: entry.classification,
    evidence_digests: entry.evidence_digests,
    ...(entry.action_digest === undefined ? {} : { action_digest: entry.action_digest }),
    ...(entry.context_manifest_digest === undefined
      ? {}
      : { context_manifest_digest: entry.context_manifest_digest }),
    ...(entry.policy_hash === undefined ? {} : { policy_hash: entry.policy_hash }),
    ...(entry.template_hash === undefined ? {} : { template_hash: entry.template_hash }),
    ...(entry.decision_id === undefined ? {} : { decision_id: entry.decision_id }),
    ...(entry.correlation_id === undefined ? {} : { correlation_id: entry.correlation_id }),
    ...(entry.causation_id === undefined ? {} : { causation_id: entry.causation_id }),
    ...(entry.key_id === undefined ? {} : { key_id: entry.key_id }),
  };
}

function calculateEntryHash(previousEntryHash: string, entry: Omit<AuditLedgerEntry, "previous_entry_hash" | "entry_hash">): string {
  // A delimiter plus canonical serialization prevents ambiguous concatenation.
  return sha256Hex(`${previousEntryHash}\n${canonicalJson(entryBody(entry))}`);
}

function freezeEntry(entry: AuditLedgerEntry): AuditLedgerEntry {
  Object.freeze(entry.actor);
  Object.freeze(entry.evidence_digests);
  return Object.freeze(entry);
}

function freezeLedger(ledger: AuditLedger): AuditLedger {
  Object.freeze(ledger.entries);
  return Object.freeze(ledger);
}

/** Creates an empty, tenant-partitioned immutable ledger. */
export function createAuditLedger(input: CreateAuditLedgerInput): AuditLedger {
  const tenantId = requireNonEmptyString(input.tenant_id, "tenant_id");
  const partition = requireNonEmptyString(input.partition, "partition");
  const genesisHash =
    input.genesis_hash === undefined
      ? digestCanonical({ kind: "vekinbox/audit-genesis/v1", tenant_id: tenantId, partition })
      : normalizeOptionalDigest(input.genesis_hash, "genesis_hash")!;
  return freezeLedger({ tenant_id: tenantId, partition, genesis_hash: genesisHash, entries: [] });
}

/**
 * Appends one immutable fact. Persistence adapters should write the returned
 * entry and projection in the same transaction, using expected_sequence as CAS.
 */
export function appendAuditEntry(
  prior: AuditLedger,
  input: AppendAuditEntryInput,
): AppendAuditEntryResult {
  const verification = verifyAuditLedger(prior);
  if (!verification.valid) {
    throw new AuditLedgerValidationError(`cannot append to invalid ledger: ${verification.reason}`);
  }
  const expectedSequence = prior.entries.length;
  if (input.expected_sequence !== undefined && input.expected_sequence !== expectedSequence) {
    throw new AuditLedgerConflictError("audit ledger sequence conflict");
  }
  const id = requireNonEmptyString(input.id, "entry.id");
  if (prior.entries.some((entry) => entry.id === id)) {
    throw new AuditLedgerConflictError(`audit ledger already contains entry '${id}'`);
  }
  const eventType = requireNonEmptyString(input.event_type, "event_type");
  if (!/^[a-z][a-z0-9_.-]*$/.test(eventType)) {
    throw new AuditLedgerValidationError("event_type must be a stable dot-separated identifier");
  }
  if (input.payload !== undefined && input.payload_hash !== undefined) {
    throw new AuditLedgerValidationError("provide payload or payload_hash, not both");
  }
  const payloadHash =
    input.payload_hash === undefined
      ? digestCanonical(input.payload ?? {})
      : normalizeOptionalDigest(input.payload_hash, "payload_hash")!;
  const classification = input.classification ?? "internal";
  if (!CLASSIFICATIONS.includes(classification)) {
    throw new AuditLedgerValidationError("classification is unsupported");
  }
  const evidenceDigests = [...new Set((input.evidence_digests ?? []).map((digest) => normalizeOptionalDigest(digest, "evidence_digest")!))].sort();
  const entryWithoutHashes: Omit<AuditLedgerEntry, "previous_entry_hash" | "entry_hash"> = {
    id,
    tenant_id: prior.tenant_id,
    partition: prior.partition,
    sequence: expectedSequence + 1,
    occurred_at: iso(input.occurred_at),
    event_type: eventType,
    actor: normalizeActor(input.actor),
    payload_hash: payloadHash,
    classification,
    evidence_digests: evidenceDigests,
    ...(normalizeOptionalDigest(input.action_digest, "action_digest") === undefined
      ? {}
      : { action_digest: normalizeOptionalDigest(input.action_digest, "action_digest") }),
    ...(normalizeOptionalDigest(input.context_manifest_digest, "context_manifest_digest") === undefined
      ? {}
      : {
          context_manifest_digest: normalizeOptionalDigest(
            input.context_manifest_digest,
            "context_manifest_digest",
          ),
        }),
    ...(normalizeOptionalDigest(input.policy_hash, "policy_hash") === undefined
      ? {}
      : { policy_hash: normalizeOptionalDigest(input.policy_hash, "policy_hash") }),
    ...(normalizeOptionalDigest(input.template_hash, "template_hash") === undefined
      ? {}
      : { template_hash: normalizeOptionalDigest(input.template_hash, "template_hash") }),
    ...(input.decision_id === undefined ? {} : { decision_id: requireNonEmptyString(input.decision_id, "decision_id") }),
    ...(input.correlation_id === undefined
      ? {}
      : { correlation_id: requireNonEmptyString(input.correlation_id, "correlation_id") }),
    ...(input.causation_id === undefined
      ? {}
      : { causation_id: requireNonEmptyString(input.causation_id, "causation_id") }),
    ...(input.key_id === undefined ? {} : { key_id: requireNonEmptyString(input.key_id, "key_id") }),
  };
  const previousEntryHash = prior.entries.at(-1)?.entry_hash ?? prior.genesis_hash;
  const entry = freezeEntry({
    ...entryWithoutHashes,
    previous_entry_hash: previousEntryHash,
    entry_hash: calculateEntryHash(previousEntryHash, entryWithoutHashes),
  });
  const ledger = freezeLedger({
    tenant_id: prior.tenant_id,
    partition: prior.partition,
    genesis_hash: prior.genesis_hash,
    entries: [...prior.entries, entry],
  });
  return { ledger, entry };
}

/** Appends a decision fact with the action, policy, context, and evidence bindings required for audit. */
export function appendDecisionAuditEntry(
  prior: AuditLedger,
  input: AppendDecisionAuditEntryInput,
): AppendAuditEntryResult {
  return appendAuditEntry(prior, {
    ...input,
    event_type: input.event_type ?? "decision.accepted",
  });
}

/** Verifies contiguous sequence numbers, tenant partition, and every hash-chain link. */
export function verifyAuditLedger(ledger: AuditLedger): AuditVerificationResult {
  try {
    const tenantId = requireNonEmptyString(ledger.tenant_id, "tenant_id");
    const partition = requireNonEmptyString(ledger.partition, "partition");
    const genesisHash = normalizeOptionalDigest(ledger.genesis_hash, "genesis_hash")!;
    let previousHash = genesisHash;
    const seenIds = new Set<string>();
    for (let index = 0; index < ledger.entries.length; index += 1) {
      const entry = ledger.entries[index]!;
      if (entry.tenant_id !== tenantId || entry.partition !== partition) {
        return { valid: false, last_sequence: index, last_hash: previousHash, reason: "tenant_or_partition_mismatch" };
      }
      if (entry.sequence !== index + 1) {
        return { valid: false, last_sequence: index, last_hash: previousHash, reason: "non_contiguous_sequence" };
      }
      if (seenIds.has(entry.id)) {
        return { valid: false, last_sequence: index, last_hash: previousHash, reason: "duplicate_entry_id" };
      }
      seenIds.add(entry.id);
      if (entry.previous_entry_hash !== previousHash) {
        return { valid: false, last_sequence: index, last_hash: previousHash, reason: "previous_hash_mismatch" };
      }
      const { previous_entry_hash: _previous, entry_hash: entryHash, ...withoutHashes } = entry;
      const expectedHash = calculateEntryHash(previousHash, withoutHashes);
      if (entryHash !== expectedHash) {
        return { valid: false, last_sequence: index, last_hash: previousHash, reason: "entry_hash_mismatch" };
      }
      previousHash = entryHash;
    }
    return { valid: true, last_sequence: ledger.entries.length, last_hash: previousHash };
  } catch (error) {
    return {
      valid: false,
      last_sequence: 0,
      last_hash: "",
      reason: error instanceof Error ? error.message : "invalid_ledger",
    };
  }
}

/** Creates a compact range commitment suitable for signing/anchoring outside the database. */
export function createAuditCheckpoint(
  ledger: AuditLedger,
  input?: {
    from_sequence?: number;
    to_sequence?: number;
    created_at?: Date | string;
    key_id?: string;
  },
): AuditCheckpoint {
  const verification = verifyAuditLedger(ledger);
  if (!verification.valid) {
    throw new AuditLedgerValidationError(`cannot checkpoint invalid ledger: ${verification.reason}`);
  }
  if (ledger.entries.length === 0) {
    throw new AuditLedgerValidationError("cannot checkpoint an empty ledger");
  }
  const fromSequence = input?.from_sequence ?? 1;
  const toSequence = input?.to_sequence ?? ledger.entries.length;
  if (
    !Number.isInteger(fromSequence) ||
    !Number.isInteger(toSequence) ||
    fromSequence < 1 ||
    toSequence < fromSequence ||
    toSequence > ledger.entries.length
  ) {
    throw new AuditLedgerValidationError("checkpoint range is invalid");
  }
  const entries = ledger.entries.slice(fromSequence - 1, toSequence);
  return {
    tenant_id: ledger.tenant_id,
    partition: ledger.partition,
    from_sequence: fromSequence,
    to_sequence: toSequence,
    root_hash: digestCanonical({
      tenant_id: ledger.tenant_id,
      partition: ledger.partition,
      from_sequence: fromSequence,
      to_sequence: toSequence,
      entry_hashes: entries.map((entry) => entry.entry_hash),
    }),
    created_at: iso(input?.created_at),
    ...(input?.key_id === undefined ? {} : { key_id: requireNonEmptyString(input.key_id, "key_id") }),
  };
}

export function verifyAuditCheckpoint(ledger: AuditLedger, checkpoint: AuditCheckpoint): boolean {
  const verification = verifyAuditLedger(ledger);
  if (!verification.valid) return false;
  if (checkpoint.tenant_id !== ledger.tenant_id || checkpoint.partition !== ledger.partition) {
    return false;
  }
  try {
    const expected = createAuditCheckpoint(ledger, {
      from_sequence: checkpoint.from_sequence,
      to_sequence: checkpoint.to_sequence,
      created_at: checkpoint.created_at,
      key_id: checkpoint.key_id,
    });
    return expected.root_hash === normalizeSha256Digest(checkpoint.root_hash);
  } catch {
    return false;
  }
}

/** A safe detached copy for DB/API layers; it preserves hashes but never a raw payload. */
export function cloneAuditLedger(ledger: AuditLedger): AuditLedger {
  return cloneCanonical(ledger) as AuditLedger;
}
