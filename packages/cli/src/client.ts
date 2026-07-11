import { VekInbox } from "@latticeag/vekinbox";
import { requireConfig } from "./config.js";

export async function createClient() {
  const config = await requireConfig();
  return new VekInbox({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}

export async function getWorkspaceId(): Promise<string | undefined> {
  const config = await requireConfig();
  return config.workspaceId;
}
