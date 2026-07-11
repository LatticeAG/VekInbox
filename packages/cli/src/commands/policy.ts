import { defineCommand } from "citty";
import { apiRequest } from "../http.js";
import { getWorkspaceId } from "../client.js";

export const policyList = defineCommand({
  meta: {
    name: "list",
    description: "List escalation policies for a workspace",
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
      data: Array<{ id: string; name: string; default_action_on_timeout: string }>;
    }>(`/workspaces/${encodeURIComponent(workspaceId)}/policies`, {
      auth: "session",
    });

    if (result.data.length === 0) {
      console.log("No policies found.");
      return;
    }

    for (const policy of result.data) {
      console.log(
        `${policy.id}  ${policy.name}  (timeout → ${policy.default_action_on_timeout})`,
      );
    }
  },
});

export const policyCreate = defineCommand({
  meta: {
    name: "create",
    description: "Create an escalation policy",
  },
  args: {
    name: { type: "string", required: true, description: "Policy name" },
    workspace: { type: "string", description: "Workspace ID (ws_...)" },
    steps: {
      type: "string",
      description: "JSON array of escalation steps",
      default: '[{"delay_ms":3600000,"notify":{}}]',
    },
    "timeout-action": {
      type: "string",
      description: "Default action on timeout",
      default: "decline",
    },
  },
  async run({ args }) {
    const workspaceId = args.workspace ?? (await getWorkspaceId());
    if (!workspaceId) {
      console.error("Workspace required. Pass --workspace or set in config.");
      process.exit(1);
    }

    let steps: unknown;
    try {
      steps = JSON.parse(args.steps);
    } catch {
      console.error("Invalid --steps JSON");
      process.exit(1);
    }

    const policy = await apiRequest<Record<string, unknown>>(
      `/workspaces/${encodeURIComponent(workspaceId)}/policies`,
      {
        method: "POST",
        auth: "session",
        body: {
          name: args.name,
          steps,
          default_action_on_timeout: args["timeout-action"],
        },
      },
    );

    console.log(JSON.stringify(policy, null, 2));
  },
});

export const policyCommand = defineCommand({
  meta: {
    name: "policy",
    description: "Manage escalation policies",
  },
  subCommands: {
    list: policyList,
    create: policyCreate,
  },
});
