import { defineCommand } from "citty";
import { loadConfig, requireConfig, saveConfig } from "../config.js";

export const authLogin = defineCommand({
  meta: {
    name: "login",
    description: "Authenticate with VekInbox API",
  },
  args: {
    email: {
      type: "string",
      description: "Account email",
      required: true,
    },
    "api-key": {
      type: "string",
      description: "API key (vk_live_... or vk_test_...)",
    },
    "base-url": {
      type: "string",
      description: "API base URL",
      default: "http://localhost:3001/v1",
    },
    workspace: {
      type: "string",
      description: "Default workspace ID (ws_...)",
    },
  },
  async run({ args }) {
    const apiKey = args["api-key"];
    if (!apiKey) {
      console.error(
        "API key required. Pass --api-key vk_test_... (dev login endpoint coming soon).",
      );
      process.exit(1);
    }

    const config = await loadConfig();
    await saveConfig({
      ...config,
      email: args.email,
      apiKey,
      baseUrl: args["base-url"],
      workspaceId: args.workspace ?? config.workspaceId,
    });

    console.log(`Logged in as ${args.email}`);
    console.log(`Config saved to ~/.vekinbox/config.json`);
  },
});

export const authStatus = defineCommand({
  meta: {
    name: "status",
    description: "Show authentication status",
  },
  async run() {
    try {
      const config = await requireConfig();
      console.log("Authenticated: yes");
      console.log(`Email:       ${config.email ?? "(not set)"}`);
      console.log(`Base URL:    ${config.baseUrl}`);
      console.log(
        `API key:     ${config.apiKey.slice(0, 12)}...${config.apiKey.slice(-4)}`,
      );
      console.log(`Workspace:   ${config.workspaceId ?? "(not set)"}`);
    } catch {
      console.log("Authenticated: no");
      console.log("Run `vekinbox auth login` to configure credentials.");
    }
  },
});

export const authCommand = defineCommand({
  meta: {
    name: "auth",
    description: "Manage authentication",
  },
  subCommands: {
    login: authLogin,
    status: authStatus,
  },
});
