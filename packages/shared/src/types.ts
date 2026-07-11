import type { RequestPriority, RequestStatus } from "./constants.js";

export type RequestActionName =
  | "approve"
  | "decline"
  | "request_changes"
  | string;

export interface RequestAction {
  name: RequestActionName;
  label?: string;
  schema?: Record<string, unknown>;
}

export interface Request {
  id: string;
  key: string;
  title: string;
  description?: string;
  workspaceId: string;
  agentId: string;
  status: RequestStatus;
  priority: RequestPriority;
  actions: RequestAction[] | RequestActionName[];
  defaultAction?: string;
  timeoutAt?: string;
  escalationPolicyId?: string;
  resumeWebhookUrl?: string;
  metadata?: Record<string, unknown>;
  labels?: string[];
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionPayload?: {
    action: string;
    note?: string;
    payload?: Record<string, unknown>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateRequestInput {
  workspaceId: string;
  agentId: string;
  key: string;
  title: string;
  description?: string;
  priority?: RequestPriority;
  actions?: RequestActionName[] | RequestAction[];
  defaultAction?: string;
  timeout?: string;
  escalationPolicyId?: string;
  resumeWebhook?: string;
  metadata?: Record<string, unknown>;
  labels?: string[];
  assignees?: string[];
}

export interface ListFilters {
  status?: RequestStatus;
  priority?: RequestPriority;
  agentId?: string;
  labels?: string[];
  cursor?: string;
  limit?: number;
}

export interface ListRequestsResponse {
  data: Request[];
  cursor?: string;
}

export interface ResolveRequestInput {
  action: RequestActionName;
  note?: string;
  payload?: Record<string, unknown>;
}

export interface ResumeWebhookPayload {
  request_id: string;
  workspace_id: string;
  agent_id: string;
  key: string;
  status: RequestStatus;
  action: string;
  resolved_by?: string;
  resolved_at: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    request_id?: string;
    docs_url?: string;
  };
}

export const DEFAULT_BASE_URL = "https://api.vekinbox.latticeag.com/v1";

export const WEBHOOK_SIGNATURE_HEADER = "x-vekinbox-signature";
export const WEBHOOK_TIMESTAMP_HEADER = "x-vekinbox-timestamp";
export const WEBHOOK_DELIVERY_ID_HEADER = "x-vekinbox-delivery-id";

/** Maximum allowed clock skew for webhook timestamps (5 minutes). */
export const WEBHOOK_MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export function isTerminalStatus(status: RequestStatus): boolean {
  return status !== "pending" && status !== "escalated";
}

export type { RequestPriority, RequestStatus } from "./constants.js";
