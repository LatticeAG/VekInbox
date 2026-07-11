import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface VekInboxConfig {
  apiKey?: string;
  baseUrl?: string;
  workspaceId?: string;
  email?: string;
}

const CONFIG_DIR = join(homedir(), ".vekinbox");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export async function loadConfig(): Promise<VekInboxConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as VekInboxConfig;
  } catch {
    return {};
  }
}

export async function saveConfig(config: VekInboxConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export async function requireConfig(): Promise<Required<Pick<VekInboxConfig, "apiKey" | "baseUrl">> & VekInboxConfig> {
  const config = await loadConfig();
  if (!config.apiKey) {
    throw new Error(
      `Not authenticated. Run \`vekinbox auth login\` first. Config: ${CONFIG_PATH}`,
    );
  }
  return {
    ...config,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? "http://localhost:3001/v1",
  };
}
