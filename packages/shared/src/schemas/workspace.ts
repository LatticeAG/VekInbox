import { z } from "zod";
import { MEMBERSHIP_ROLES } from "../constants.js";

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const workspaceResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;

export const createAgentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(""),
  permissions: z.record(z.unknown()).optional().default({}),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const agentResponseSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  description: z.string(),
  permissions: z.record(z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AgentResponse = z.infer<typeof agentResponseSchema>;

export const membershipResponseSchema = z.object({
  user_id: z.string(),
  workspace_id: z.string(),
  role: z.enum(MEMBERSHIP_ROLES),
  created_at: z.string(),
});

export type MembershipResponse = z.infer<typeof membershipResponseSchema>;
