import { loadConfig } from "./config.js";
import {
  cookieHeader,
  loadCookies,
  SESSION_COOKIE,
  type CookieStore,
} from "./cookies.js";

export type AuthMode = "apiKey" | "session" | "auto";

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  auth?: AuthMode;
}

async function getBaseUrl(): Promise<string> {
  const config = await loadConfig();
  return (config.baseUrl ?? "http://localhost:3001/v1").replace(/\/$/, "");
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, query, auth = "auto" } = options;
  const baseUrl = await getBaseUrl();
  const url = new URL(`${baseUrl}${path}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const config = await loadConfig();
  const cookies = await loadCookies();
  const hasSession = Boolean(cookies[SESSION_COOKIE]);
  const hasApiKey = Boolean(config.apiKey);

  const useSession =
    auth === "session" || (auth === "auto" && hasSession && !hasApiKey);
  const useApiKey =
    auth === "apiKey" || (auth === "auto" && hasApiKey && !useSession);

  if (useSession) {
    if (!hasSession) {
      throw new Error(
        "No session cookie. Run `vekinbox auth login --email you@example.com` first.",
      );
    }
    headers["Cookie"] = cookieHeader(cookies);
  } else if (useApiKey) {
    if (!config.apiKey) {
      throw new Error(
        "No API key configured. Run `vekinbox auth login` with --api-key.",
      );
    }
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  } else {
    throw new Error("Not authenticated. Run `vekinbox auth login` first.");
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const err = parsed as { error?: { message?: string } } | undefined;
    throw new Error(
      `API error ${response.status}: ${err?.error?.message ?? text}`,
    );
  }

  return parsed as T;
}

export async function devLogin(email: string): Promise<CookieStore> {
  const baseUrl = await getBaseUrl();
  const response = await fetch(`${baseUrl}/auth/dev-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email }),
  });

  const text = await response.text();
  if (!response.ok) {
    const err = text ? (JSON.parse(text) as { error?: { message?: string } }) : undefined;
    throw new Error(
      `Dev login failed (${response.status}): ${err?.error?.message ?? text}`,
    );
  }

  const setCookie = response.headers.getSetCookie?.() ?? [];
  const legacyCookie = response.headers.get("set-cookie");
  const cookieStrings = setCookie.length > 0 ? setCookie : legacyCookie ? [legacyCookie] : [];

  const cookies: CookieStore = {};
  for (const header of cookieStrings) {
    const { parseSetCookieHeader } = await import("./cookies.js");
    Object.assign(cookies, parseSetCookieHeader(header));
  }

  if (!cookies[SESSION_COOKIE]) {
    throw new Error("Dev login succeeded but no session cookie was returned.");
  }

  return cookies;
}
