import type {
  ApiErrorResponse,
  ListRequestsQuery,
  RequestEventResponse,
  RequestResponse,
  UserResponse,
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

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
  created_at: string;
  updated_at: string;
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

    agents(workspaceId: string) {
      return request<{ data: AgentSummary[] }>(
        `/v1/workspaces/${workspaceId}/agents`,
      );
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
  },
};
