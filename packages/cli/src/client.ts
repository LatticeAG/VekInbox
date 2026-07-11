import { VekInbox } from "@latticeag/vekinbox";
import { loadConfig } from "./config.js";

export async function createClient() {
  const config = await loadConfig();
  if (!config.apiKey) {
    throw new Error(
      "API key required for agent operations. Run `vekinbox auth login --api-key vk_...`",
    );
  }
  return new VekInbox({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}

export async function getWorkspaceId(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.workspaceId;
}
