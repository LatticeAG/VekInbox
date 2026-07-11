import { z } from "zod";

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(120).optional().default("default"),
  environment: z.enum(["live", "test"]).optional().default("test"),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const apiKeyResponseSchema = z.object({
  id: z.string(),
  agent_id: z.string(),
  name: z.string(),
  prefix: z.string(),
  environment: z.enum(["live", "test"]),
  created_at: z.string(),
  revoked_at: z.string().nullable(),
});

export type ApiKeyResponse = z.infer<typeof apiKeyResponseSchema>;

export const createApiKeyWithSecretSchema = apiKeyResponseSchema.extend({
  key: z.string(),
});

export type CreateApiKeyWithSecretResponse = z.infer<typeof createApiKeyWithSecretSchema>;
