import type { ApiErrorResponse } from "@latticeag/vekinbox-shared";

export class VekInboxApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly docsUrl?: string;

  constructor(status: number, body: ApiErrorResponse) {
    super(body.error.message);
    this.name = "VekInboxApiError";
    this.code = body.error.code;
    this.status = status;
    this.requestId = body.error.request_id;
    this.docsUrl = body.error.docs_url;
  }
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.vekinbox.latticeag.com/v1").replace(
      /\/$/,
      "",
    );
    this.fetchFn = opts.fetch ?? globalThis.fetch;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchFn(url.toString(), init);
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : undefined;

    if (!response.ok) {
      const err = parsed as ApiErrorResponse | undefined;
      if (err?.error) {
        throw new VekInboxApiError(response.status, err);
      }
      throw new Error(`VekInbox API error: ${response.status} ${text}`);
    }

    return parsed as T;
  }
}
