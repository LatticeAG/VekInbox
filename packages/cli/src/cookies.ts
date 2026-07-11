import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const SESSION_COOKIE = "vekinbox_session";

const CONFIG_DIR = join(homedir(), ".vekinbox");
const COOKIES_PATH = join(CONFIG_DIR, "cookies.json");

export type CookieStore = Record<string, string>;

export async function loadCookies(): Promise<CookieStore> {
  try {
    const raw = await readFile(COOKIES_PATH, "utf8");
    return JSON.parse(raw) as CookieStore;
  } catch {
    return {};
  }
}

export async function saveCookies(cookies: CookieStore): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(COOKIES_PATH, JSON.stringify(cookies, null, 2) + "\n", "utf8");
}

export function parseSetCookieHeader(header: string): CookieStore {
  const cookies: CookieStore = {};
  const parts = header.split(/,(?=\s*[^;]+=)/);
  for (const part of parts) {
    const pair = part.split(";")[0]?.trim();
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    cookies[name] = value;
  }
  return cookies;
}

export function cookieHeader(cookies: CookieStore): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function getCookiesPath(): string {
  return COOKIES_PATH;
}
