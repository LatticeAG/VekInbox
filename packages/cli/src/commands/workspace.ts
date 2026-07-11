import { defineCommand } from "citty";
import { apiRequest } from "../http.js";
import { saveConfig, loadConfig } from "../config.js";

export const workspaceCreate = defineCommand({
  meta: {
    name: "create",
    description: "Create a new workspace",
  },
  args: {
    name: { type: "string", required: true, description: "Workspace name" },
    slug: { type: "string", description: "URL slug (auto-generated if omitted)" },
  },
  async run({ args }) {
    const workspace = await apiRequest<{
      id: string;
      name: string;
      slug: string;
    }>("/workspaces", {
      method: "POST",
      auth: "session",
      body: { name: args.name, slug: args.slug },
    });

    const config = await loadConfig();
    await saveConfig({ ...config, workspaceId: workspace.id });

    console.log(JSON.stringify(workspace, null, 2));
    console.log(`Default workspace set to ${workspace.id}`);
  },
});

export const workspaceList = defineCommand({
  meta: {
    name: "list",
    description: "List workspaces you belong to",
  },
  async run() {
    const result = await apiRequest<{
      data: Array<{ id: string; name: string; slug: string; role: string }>;
    }>("/workspaces", { auth: "session" });

    if (result.data.length === 0) {
      console.log("No workspaces found.");
      return;
    }

    for (const ws of result.data) {
      console.log(`${ws.id}  [${ws.role}]  ${ws.name} (${ws.slug})`);
    }
  },
});

export const workspaceCommand = defineCommand({
  meta: {
    name: "workspace",
    description: "Manage workspaces",
  },
  subCommands: {
    create: workspaceCreate,
    list: workspaceList,
  },
});
