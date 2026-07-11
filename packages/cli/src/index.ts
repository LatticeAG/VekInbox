#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { authCommand } from "./commands/auth.js";
import { devCommand } from "./commands/dev.js";
import { requestCommand } from "./commands/request.js";

const main = defineCommand({
  meta: {
    name: "vekinbox",
    version: "0.1.0",
    description: "VekInbox CLI — durable human approval queue for AI agents",
  },
  subCommands: {
    auth: authCommand,
    request: requestCommand,
    dev: devCommand,
  },
});

runMain(main);
