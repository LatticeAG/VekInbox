import { z } from "zod";

export const createPolicySchema = z.object({
  name: z.string().min(1).max(120),
  steps: z
    .array(
      z.object({
        delay_ms: z.number().int().min(0),
        notify: z.object({
          user_id: z.string().optional(),
          channel_id: z.string().optional(),
        }),
        message: z.string().max(500).optional(),
      }),
    )
    .min(1),
  // Timeout is a liveness event, never an authorization decision. Keep the
  // legacy compatibility surface constrained to safe outcomes at the API
  // boundary so a stale client cannot reintroduce auto-approve behavior.
  default_action_on_timeout: z
    .enum(["decline", "escalate"])
    .optional()
    .default("decline"),
});

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;

export const policyResponseSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  steps: z.array(z.record(z.unknown())),
  // Historic v1 rows can contain unsafe values. Keep them readable so clients
  // can label and remediate them, while writes remain constrained above.
  default_action_on_timeout: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type PolicyResponse = z.infer<typeof policyResponseSchema>;
