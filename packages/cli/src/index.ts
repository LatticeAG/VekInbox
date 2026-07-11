#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { authCommand } from "./commands/auth.js";
import { agentCommand } from "./commands/agent.js";
import { channelCommand } from "./commands/channel.js";
import { devCommand } from "./commands/dev.js";
import { policyCommand } from "./commands/policy.js";
import { requestCommand } from "./commands/request.js";
import { workspaceCommand } from "./commands/workspace.js";

const main = defineCommand({
  meta: {
    name: "vekinbox",
    version: "0.1.0",
    description: "VekInbox CLI — durable human approval queue for AI agents",
  },
  subCommands: {
    auth: authCommand,
    workspace: workspaceCommand,
    agent: agentCommand,
    policy: policyCommand,
    channel: channelCommand,
    request: requestCommand,
    dev: devCommand,
  },
});

runMain(main);
