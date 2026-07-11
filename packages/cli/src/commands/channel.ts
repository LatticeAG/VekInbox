import { defineCommand } from "citty";
import { apiRequest } from "../http.js";
import { getWorkspaceId } from "../client.js";

export const channelList = defineCommand({
  meta: {
    name: "list",
    description: "List notification channels for a workspace",
  },
  args: {
    workspace: { type: "string", description: "Workspace ID (ws_...)" },
  },
  async run({ args }) {
    const workspaceId = args.workspace ?? (await getWorkspaceId());
    if (!workspaceId) {
      console.error("Workspace required. Pass --workspace or set in config.");
      process.exit(1);
    }

    const result = await apiRequest<{
      data: Array<{ id: string; type: string; name: string; enabled: boolean }>;
    }>(`/workspaces/${encodeURIComponent(workspaceId)}/channels`, {
      auth: "session",
    });

    if (result.data.length === 0) {
      console.log("No channels found.");
      return;
    }

    for (const channel of result.data) {
      const status = channel.enabled ? "enabled" : "disabled";
      console.log(`${channel.id}  [${channel.type}]  ${channel.name} (${status})`);
    }
  },
});

export const channelAdd = defineCommand({
  meta: {
    name: "add",
    description: "Add a notification channel",
  },
  args: {
    name: { type: "string", required: true, description: "Channel display name" },
    type: {
      type: "string",
      required: true,
      description: "Channel type: email | slack | web",
    },
    workspace: { type: "string", description: "Workspace ID (ws_...)" },
    config: {
      type: "string",
      description: "JSON config object",
      default: "{}",
    },
  },
  async run({ args }) {
    const workspaceId = args.workspace ?? (await getWorkspaceId());
    if (!workspaceId) {
      console.error("Workspace required. Pass --workspace or set in config.");
      process.exit(1);
    }

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(args.config) as Record<string, unknown>;
    } catch {
      console.error("Invalid --config JSON");
      process.exit(1);
    }

    const channel = await apiRequest<Record<string, unknown>>(
      `/workspaces/${encodeURIComponent(workspaceId)}/channels`,
      {
        method: "POST",
        auth: "session",
        body: {
          name: args.name,
          type: args.type,
          config,
        },
      },
    );

    console.log(JSON.stringify(channel, null, 2));
  },
});

export const channelCommand = defineCommand({
  meta: {
    name: "channel",
    description: "Manage notification channels",
  },
  subCommands: {
    list: channelList,
    add: channelAdd,
  },
});
