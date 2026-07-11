import type {
  ApiErrorResponse,
  ChannelResponse,
  CreateAgentInput,
  CreateApiKeyWithSecretResponse,
  CreateChannelInput,
  CreatePolicyInput,
  CreateWorkspaceInput,
  ListRequestsQuery,
  PolicyResponse,
  RequestEventResponse,
  RequestResponse,
  UserResponse,
  WorkspaceResponse,
} from "@latticeag/vekinbox-shared";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function parseError(res: Response): Promise<ApiClientError> {
  try {
    const body = (await res.json()) as ApiErrorResponse;
    return new ApiClientError(
      body.error?.code ?? "unknown_error",
      body.error?.message ?? res.statusText,
      res.status,
    );
  } catch {
    return new ApiClientError("unknown_error", res.statusText, res.status);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

async function requestOptional<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (res.status === 404 || res.status === 405) {
    return null;
  }

  if (!res.ok) {
    throw await parseError(res);
  }

  return res.json() as Promise<T>;
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export interface WorkspaceSummary extends WorkspaceResponse {
  role: string;
}

export interface AgentSummary {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  permissions: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RequestDetail extends RequestResponse {
  events: RequestEventResponse[];
}

export interface WebhookDelivery {
  id: string;
  request_id: string;
  url: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  last_attempt_at?: string | null;
  next_attempt_at?: string | null;
  response_status?: number | null;
  response_body?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

function webhookDeliveriesFromEvents(
  requestId: string,
  events: RequestEventResponse[],
): WebhookDelivery[] {
  const deliveries: WebhookDelivery[] = [];

  for (const event of events) {
    const payload = event.payload ?? {};
    const deliveryId =
      (payload.delivery_id as string | undefined) ??
      `evt_${event.id}`;

    if (
      event.type === "request.webhook_delivered" ||
      event.type === "webhook.delivered"
    ) {
      deliveries.push({
        id: deliveryId,
        request_id: requestId,
        url: (payload.url as string) ?? "—",
        status: "delivered",
        attempts: (payload.attempt as number) ?? 1,
        response_status: (payload.status_code as number) ?? null,
        created_at: event.created_at,
        updated_at: event.created_at,
      });
      continue;
    }

    if (
      event.type === "request.webhook_failed" ||
      event.type === "webhook.failed"
    ) {
      deliveries.push({
        id: deliveryId,
        request_id: requestId,
        url: (payload.url as string) ?? "—",
        status: "failed",
        attempts: (payload.attempts as number) ?? 1,
        last_error: (payload.error as string) ?? "Delivery failed",
        created_at: event.created_at,
        updated_at: event.created_at,
      });
    }
  }

  return deliveries.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export const api = {
  auth: {
    devLogin(email: string) {
      return request<{ user: UserResponse }>("/v1/auth/dev-login", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    },

    me() {
      return request<UserResponse>("/v1/auth/me");
    },

    logout() {
      return request<{ ok: boolean }>("/v1/auth/logout", { method: "POST" });
    },
  },

  workspaces: {
    list() {
      return request<{ data: WorkspaceSummary[] }>("/v1/workspaces");
    },

    create(body: CreateWorkspaceInput) {
      return request<WorkspaceResponse>("/v1/workspaces", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    agents(workspaceId: string) {
      return request<{ data: AgentSummary[] }>(
        `/v1/workspaces/${workspaceId}/agents`,
      );
    },

    createAgent(workspaceId: string, body: CreateAgentInput) {
      return request<AgentSummary>(`/v1/workspaces/${workspaceId}/agents`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    policies(workspaceId: string) {
      return request<{ data: PolicyResponse[] }>(
        `/v1/workspaces/${workspaceId}/policies`,
      );
    },

    createPolicy(workspaceId: string, body: CreatePolicyInput) {
      return request<PolicyResponse>(
        `/v1/workspaces/${workspaceId}/policies`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
    },

    channels(workspaceId: string) {
      return request<{ data: ChannelResponse[] }>(
        `/v1/workspaces/${workspaceId}/channels`,
      );
    },

    createChannel(workspaceId: string, body: CreateChannelInput) {
      return request<ChannelResponse>(
        `/v1/workspaces/${workspaceId}/channels`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
    },

    eventsStreamUrl(workspaceId: string) {
      return `${API_BASE}/v1/workspaces/${workspaceId}/events/stream`;
    },
  },

  agents: {
    createKey(agentId: string, body?: { name?: string; environment?: "live" | "test" }) {
      return request<CreateApiKeyWithSecretResponse>(
        `/v1/agents/${agentId}/keys`,
        {
          method: "POST",
          body: JSON.stringify(body ?? {}),
        },
      );
    },

    revokeKey(agentId: string, keyId: string) {
      return request<void>(`/v1/agents/${agentId}/keys/${keyId}`, {
        method: "DELETE",
      });
    },
  },

  requests: {
    list(workspaceId: string, query: Partial<ListRequestsQuery> = {}) {
      const q = buildQuery({
        workspace_id: workspaceId,
        status: query.status,
        priority: query.priority,
        agent_id: query.agent_id,
        limit: query.limit,
        cursor: query.cursor,
      });
      return request<{ data: RequestResponse[]; next_cursor: string | null }>(
        `/v1/requests${q}`,
      );
    },

    async get(id: string): Promise<RequestDetail> {
      const [req, eventsRes] = await Promise.all([
        request<RequestResponse>(`/v1/requests/${id}`),
        request<{ data: RequestEventResponse[] }>(`/v1/requests/${id}/events`),
      ]);
      return { ...req, events: eventsRes.data };
    },

    action(id: string, action: string, note?: string) {
      return request<RequestResponse>(`/v1/requests/${id}/actions/${action}`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
    },

    async webhooks(
      requestId: string,
      events: RequestEventResponse[] = [],
    ): Promise<{ data: WebhookDelivery[]; fromApi: boolean }> {
      const apiResult = await requestOptional<{ data: WebhookDelivery[] }>(
        `/v1/requests/${requestId}/webhooks`,
      );

      if (apiResult) {
        return { data: apiResult.data, fromApi: true };
      }

      return {
        data: webhookDeliveriesFromEvents(requestId, events),
        fromApi: false,
      };
    },

    redeliver(requestId: string) {
      return request<{ ok: boolean; delivery_id?: string }>(
        `/v1/requests/${requestId}/webhooks/redeliver`,
        { method: "POST" },
      );
    },
  },
};
