import { z } from "zod";

export const devLoginSchema = z.object({
  email: z.string().email(),
});

export type DevLoginInput = z.infer<typeof devLoginSchema>;

export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  created_at: z.string(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;

export const sessionPayloadSchema = z.object({
  userId: z.string(),
  email: z.string(),
});

export type SessionPayload = z.infer<typeof sessionPayloadSchema>;
