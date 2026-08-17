import { z } from "zod";
import {
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  STANDARD_ACTIONS,
  type RequestStatus,
} from "../constants.js";

const actionSchema = z.union([
  z.enum(STANDARD_ACTIONS),
  z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
]);

export const requestActionSchema = z.object({
  name: z.string().min(1).max(64),
  label: z.string().max(120).optional(),
  schema: z.record(z.unknown()).optional(),
});

export const createRequestSchema = z.object({
  workspace_id: z.string().min(1),
  key: z.string().min(1).max(256),
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).optional().default(""),
  priority: z.enum(REQUEST_PRIORITIES).optional().default("normal"),
  timeout_at: z.string().datetime().optional(),
  escalation_policy_id: z.string().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
  actions: z.array(actionSchema).min(1).max(8).optional().default(["approve", "decline", "request_changes"]),
  default_action: z.string().optional(),
  resume_webhook_url: z.string().url().optional(),
  assignees: z.array(z.string()).optional(),
  labels: z.array(z.string().max(64)).max(20).optional().default([]),
  return_existing: z.boolean().optional().default(true),
});

export type CreateRequestApiInput = z.infer<typeof createRequestSchema>;

export const listRequestsQuerySchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  priority: z.enum(REQUEST_PRIORITIES).optional(),
  agent_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
});

export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

export const resolveRequestSchema = z.object({
  note: z.string().max(5000).optional(),
  payload: z.record(z.unknown()).optional(),
});

export type ResolveRequestApiInput = z.infer<typeof resolveRequestSchema>;

export const cancelRequestSchema = z.object({
  reason: z.string().max(1000).optional(),
});

export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;

export const requestResponseSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  agent_id: z.string(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(REQUEST_STATUSES),
  priority: z.enum(REQUEST_PRIORITIES),
  actions: z.array(requestActionSchema),
  default_action: z.string().nullable(),
  timeout_at: z.string().nullable(),
  escalation_policy_id: z.string().nullable(),
  resume_webhook_url: z.string().nullable(),
  metadata: z.record(z.unknown()),
  labels: z.array(z.string()),
  resolved_by: z.string().nullable(),
  resolved_at: z.string().nullable(),
  resolution_payload: z.record(z.unknown()).nullable(),
  assignees: z.array(z.string()).optional().default([]),
  created_at: z.string(),
  updated_at: z.string(),
});

export type RequestResponse = z.infer<typeof requestResponseSchema>;

export const requestEventResponseSchema = z.object({
  id: z.string(),
  request_id: z.string(),
  type: z.string(),
  actor_type: z.enum(["user", "agent", "system"]),
  actor_id: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: z.string(),
});

export type RequestEventResponse = z.infer<typeof requestEventResponseSchema>;

/**
 * Legacy request actions only have an outcome mapping for the three explicit
 * standard decisions. A custom action may be displayed by the v1 UI, but it
 * must not silently become an approval merely because it lacks a mapping.
 */
export function actionToStatus(
  action: string,
): Extract<RequestStatus, "approved" | "declined" | "changes_requested"> | null {
  switch (action) {
    case "approve":
      return "approved";
    case "decline":
      return "declined";
    case "request_changes":
      return "changes_requested";
    default:
      return null;
  }
}

export function normalizeActions(actions: (string | { name: string; label?: string })[]): { name: string; label?: string }[] {
  return actions.map((a) => (typeof a === "string" ? { name: a, label: a.replace(/_/g, " ") } : a));
}
