import { defineCommand } from "citty";
import { apiRequest } from "../http.js";
import { getWorkspaceId } from "../client.js";

export const agentCreate = defineCommand({
  meta: {
    name: "create",
    description: "Create a new agent in a workspace",
  },
  args: {
    name: { type: "string", required: true, description: "Agent name" },
    workspace: { type: "string", description: "Workspace ID (ws_...)" },
    description: { type: "string", description: "Agent description" },
  },
  async run({ args }) {
    const workspaceId = args.workspace ?? (await getWorkspaceId());
    if (!workspaceId) {
      console.error("Workspace required. Pass --workspace or set in config.");
      process.exit(1);
    }

    const agent = await apiRequest<Record<string, unknown>>(
      `/workspaces/${encodeURIComponent(workspaceId)}/agents`,
      {
        method: "POST",
        auth: "session",
        body: {
          name: args.name,
          description: args.description ?? "",
        },
      },
    );

    console.log(JSON.stringify(agent, null, 2));
  },
});

export const agentKeyCreate = defineCommand({
  meta: {
    name: "create",
    description: "Create an API key for an agent",
  },
  args: {
    "agent-id": {
      type: "positional",
      description: "Agent ID (agent_...)",
      required: true,
    },
    name: { type: "string", description: "Key name", default: "default" },
    environment: {
      type: "string",
      description: "live | test",
      default: "test",
    },
  },
  async run({ args }) {
    const result = await apiRequest<Record<string, unknown>>(
      `/agents/${encodeURIComponent(args["agent-id"])}/keys`,
      {
        method: "POST",
        auth: "session",
        body: {
          name: args.name,
          environment: args.environment,
        },
      },
    );

    console.log(JSON.stringify(result, null, 2));
    console.log("\nSave the key — it will not be shown again.");
  },
});

export const agentKeyCommand = defineCommand({
  meta: {
    name: "key",
    description: "Manage agent API keys",
  },
  subCommands: {
    create: agentKeyCreate,
  },
});

export const agentCommand = defineCommand({
  meta: {
    name: "agent",
    description: "Manage agents",
  },
  subCommands: {
    create: agentCreate,
    key: agentKeyCommand,
  },
});
