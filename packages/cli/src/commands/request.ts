import { defineCommand } from "citty";
import { createClient, getWorkspaceId } from "../client.js";

export const requestCreate = defineCommand({
  meta: {
    name: "create",
    description: "Create a new approval request",
  },
  args: {
    title: { type: "string", required: true, description: "Request title" },
    key: { type: "string", required: true, description: "Idempotency key" },
    workspace: { type: "string", description: "Workspace ID (ws_...)" },
    agent: { type: "string", required: true, description: "Agent ID (agent_...)" },
    description: { type: "string", description: "Longer description" },
    priority: {
      type: "string",
      description: "Priority: low | normal | high | critical",
      default: "normal",
    },
    "resume-webhook": { type: "string", description: "Resume webhook URL" },
  },
  async run({ args }) {
    const client = await createClient();
    const workspaceId = args.workspace ?? (await getWorkspaceId());
    if (!workspaceId) {
      console.error("Workspace required. Pass --workspace or set in config.");
      process.exit(1);
    }

    const request = await client.requests.create({
      workspaceId,
      agentId: args.agent,
      key: args.key,
      title: args.title,
      description: args.description,
      priority: args.priority as "low" | "normal" | "high" | "critical",
      resumeWebhook: args["resume-webhook"],
    });

    console.log(JSON.stringify(request, null, 2));
  },
});

export const requestList = defineCommand({
  meta: {
    name: "list",
    description: "List approval requests",
  },
  args: {
    status: { type: "string", description: "Filter by status" },
    limit: { type: "string", description: "Page size", default: "20" },
  },
  async run({ args }) {
    const client = await createClient();
    const result = await client.requests.list({
      status: args.status as
        | "pending"
        | "approved"
        | "declined"
        | "timed_out"
        | "escalated"
        | "cancelled"
        | "changes_requested"
        | undefined,
      limit: Number(args.limit),
    });

    if (result.data.length === 0) {
      console.log("No requests found.");
      return;
    }

    for (const req of result.data) {
      console.log(`${req.id}  [${req.status}]  ${req.title}`);
    }
    if (result.cursor) {
      console.log(`\nMore results available (cursor: ${result.cursor})`);
    }
  },
});

export const requestShow = defineCommand({
  meta: {
    name: "show",
    description: "Show request details",
  },
  args: {
    id: { type: "positional", description: "Request ID", required: true },
  },
  async run({ args }) {
    const client = await createClient();
    const request = await client.requests.get(args.id);
    console.log(JSON.stringify(request, null, 2));
  },
});

export const requestResolve = defineCommand({
  meta: {
    name: "resolve",
    description: "Resolve a pending request",
  },
  args: {
    id: { type: "positional", description: "Request ID", required: true },
    action: {
      type: "string",
      description: "Action: approve | decline | request_changes",
      default: "approve",
    },
    note: { type: "string", description: "Reviewer note" },
  },
  async run({ args }) {
    const config = await import("../config.js").then((m) => m.requireConfig());
    const baseUrl = config.baseUrl.replace(/\/$/, "");
    const response = await fetch(
      `${baseUrl}/requests/${encodeURIComponent(args.id)}/actions/${encodeURIComponent(args.action)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ note: args.note }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      console.error(`Error ${response.status}: ${text}`);
      process.exit(1);
    }

    console.log(JSON.stringify(JSON.parse(text), null, 2));
  },
});

export const requestCancel = defineCommand({
  meta: {
    name: "cancel",
    description: "Cancel a pending request",
  },
  args: {
    id: { type: "positional", description: "Request ID", required: true },
  },
  async run({ args }) {
    const client = await createClient();
    const request = await client.requests.cancel(args.id);
    console.log(JSON.stringify(request, null, 2));
  },
});

export const requestCommand = defineCommand({
  meta: {
    name: "request",
    description: "Manage approval requests",
  },
  subCommands: {
    create: requestCreate,
    list: requestList,
    show: requestShow,
    resolve: requestResolve,
    cancel: requestCancel,
  },
});
