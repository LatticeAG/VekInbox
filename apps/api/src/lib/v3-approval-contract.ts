import { z } from "zod";

const digestSchema = z
  .string()
  .regex(/^(?:sha256:)?[a-fA-F0-9]{64}$/, "must be a SHA-256 digest");

const contextItemSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.enum([
      "structured_fields",
      "diff",
      "log_bundle",
      "screenshot",
      "artifact",
      "external_link",
      "reviewer_instruction",
      "decision_evidence",
    ]),
    content_digest: digestSchema,
    classification: z.enum(["public", "internal", "confidential", "restricted"]),
    redaction: z.enum(["none", "partial", "full"]),
    provenance: z
      .object({
        source: z.string().min(1).max(300),
        observed_at: z.string().datetime({ offset: true }).optional(),
        verifier: z.string().min(1).max(300).optional(),
      })
      .strict(),
    media_type: z.string().min(1).max(200).optional(),
    size_bytes: z.number().int().nonnegative().optional(),
    line_count: z.number().int().nonnegative().optional(),
    external_url: z.string().url().max(2_000).optional(),
    summary: z.string().min(1).max(4_000).optional(),
  })
  .strict();

export const v3CreateApprovalCaseSchema = z
  .object({
    template: z
      .object({
        id: z.string().regex(/^tmpl_[A-Za-z0-9_-]+$/),
        version: z.number().int().positive(),
      })
      .strict(),
    external_key: z.string().min(1).max(500),
    title: z.string().min(1).max(500).optional(),
    action: z
      .object({
        operation: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
        resource: z.record(z.unknown()),
        arguments: z.record(z.unknown()),
        preconditions: z.array(z.unknown()).max(100).optional(),
        downstream_idempotency_key: z.string().min(1).max(500).optional(),
        canonicalization: z.literal("vekinbox-action/v1").optional(),
      })
      .strict(),
    context_manifest: z
      .object({
        version: z.literal(1),
        items: z.array(contextItemSchema).min(1).max(100),
        effective_classification: z.enum(["public", "internal", "confidential", "restricted"]),
        context_manifest_digest: digestSchema,
      })
      .strict(),
    schedule: z
      .object({
        open_at: z.string().datetime({ offset: true }).optional(),
        effective_at: z.string().datetime({ offset: true }).optional(),
        timezone: z.string().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const v3DecisionSchema = z
  .object({
    stage_id: z.string().min(1).max(200),
    response: z.enum(["approve", "decline", "request_changes", "acknowledge"]),
    reason: z.string().min(1).max(8_000).optional(),
    payload: z.record(z.unknown()).default({}),
  })
  .strict();

export const v3ScheduledDecisionSchema = z
  .object({
    stage_id: z.string().min(1).max(200),
    response: z.enum(["approve", "decline", "request_changes", "acknowledge"]),
    payload: z.record(z.unknown()).default({}),
    effective_at: z.string().datetime({ offset: true }),
    timezone: z.string().min(1).max(100),
  })
  .strict();

export type V3CreateApprovalCaseInput = z.infer<typeof v3CreateApprovalCaseSchema>;
export type V3DecisionInput = z.infer<typeof v3DecisionSchema>;
export type V3ScheduledDecisionInput = z.infer<typeof v3ScheduledDecisionSchema>;

/** V3 requires a non-empty transport idempotency key on every mutation. */
export function requireV3IdempotencyKey(value: string | undefined): string {
  if (!value || value.trim().length === 0 || value.length > 512) {
    throw new Error("Idempotency-Key header is required and must be at most 512 characters");
  }
  return value;
}

/** Parses the only accepted wire form: `"case-version:17"`. */
export function parseCaseVersion(value: string | undefined): number {
  const match = /^"case-version:([1-9][0-9]*)"$/.exec(value ?? "");
  if (!match) {
    throw new Error('If-Match must be formatted as "case-version:<positive integer>"');
  }
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) {
    throw new Error("If-Match case version is out of range");
  }
  return version;
}
