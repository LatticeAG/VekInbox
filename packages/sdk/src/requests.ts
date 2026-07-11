import type {
  CreateRequestInput,
  ListFilters,
  ListRequestsResponse,
  Request,
  RequestResponse,
} from "@latticeag/vekinbox-shared";
import type { HttpClient } from "./client.js";

function toApiBody(input: CreateRequestInput): Record<string, unknown> {
  return {
    workspace_id: input.workspaceId,
    agent_id: input.agentId,
    key: input.key,
    title: input.title,
    description: input.description,
    priority: input.priority,
    actions: input.actions,
    default_action: input.defaultAction,
    timeout: input.timeout,
    escalation_policy_id: input.escalationPolicyId,
    resume_webhook_url: input.resumeWebhook,
    metadata: input.metadata,
    labels: input.labels,
    assignees: input.assignees,
  };
}

function fromApiRequest(raw: RequestResponse): Request {
  return {
    id: raw.id,
    key: raw.key,
    title: raw.title,
    description: raw.description,
    workspaceId: raw.workspace_id,
    agentId: raw.agent_id,
    status: raw.status,
    priority: raw.priority,
    actions: raw.actions,
    defaultAction: raw.default_action ?? undefined,
    timeoutAt: raw.timeout_at ?? undefined,
    escalationPolicyId: raw.escalation_policy_id ?? undefined,
    resumeWebhookUrl: raw.resume_webhook_url ?? undefined,
    metadata: raw.metadata,
    labels: raw.labels,
    resolvedBy: raw.resolved_by ?? undefined,
    resolvedAt: raw.resolved_at ?? undefined,
    resolutionPayload: raw.resolution_payload
      ? (raw.resolution_payload as Request["resolutionPayload"])
      : undefined,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function parseDurationMs(duration: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${duration}`);
  }
  const value = Number(match[1]);
  const unit = match[2] ?? "s";
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * (multipliers[unit] ?? 1);
}

export class RequestsClient {
  constructor(private readonly http: HttpClient) {}

  async create(input: CreateRequestInput): Promise<Request> {
    const raw = await this.http.request<RequestResponse>(
      "POST",
      "/requests",
      toApiBody(input),
    );
    return fromApiRequest(raw);
  }

  async get(id: string): Promise<Request> {
    const raw = await this.http.request<RequestResponse>(
      "GET",
      `/requests/${encodeURIComponent(id)}`,
    );
    return fromApiRequest(raw);
  }

  async list(filters?: ListFilters): Promise<ListRequestsResponse> {
    const raw = await this.http.request<{
      data: RequestResponse[];
      cursor?: string;
    }>("GET", "/requests", undefined, {
      status: filters?.status,
      priority: filters?.priority,
      agent_id: filters?.agentId,
      cursor: filters?.cursor,
      limit: filters?.limit,
    });

    return {
      data: raw.data.map(fromApiRequest),
      cursor: raw.cursor,
    };
  }

  async cancel(id: string): Promise<Request> {
    const raw = await this.http.request<RequestResponse>(
      "POST",
      `/requests/${encodeURIComponent(id)}/cancel`,
    );
    return fromApiRequest(raw);
  }

  async waitForResolution(
    id: string,
    opts?: { timeout?: string; pollInterval?: number },
  ): Promise<Request> {
    const timeoutMs = opts?.timeout ? parseDurationMs(opts.timeout) : 3_600_000;
    const pollInterval = opts?.pollInterval ?? 2000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const request = await this.get(id);
      if (request.status !== "pending" && request.status !== "escalated") {
        return request;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timed out waiting for request ${id} to resolve`);
  }
}
