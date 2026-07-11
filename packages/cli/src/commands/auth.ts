import { defineCommand } from "citty";
import { loadConfig, requireConfig, saveConfig } from "../config.js";
import { loadCookies, saveCookies, SESSION_COOKIE } from "../cookies.js";
import { devLogin } from "../http.js";

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
    const config = await loadConfig();
    const baseUrl = args["base-url"];

    await saveConfig({
      ...config,
      email: args.email,
      baseUrl,
      workspaceId: args.workspace ?? config.workspaceId,
      ...(args["api-key"] ? { apiKey: args["api-key"] } : {}),
    });

    const cookies = await devLogin(args.email);
    await saveCookies(cookies);

    console.log(`Logged in as ${args.email}`);
    console.log(`Session cookie saved to ~/.vekinbox/cookies.json`);
    if (args["api-key"]) {
      console.log(`API key saved to ~/.vekinbox/config.json`);
    } else {
      console.log(
        "No API key provided. Use --api-key for agent operations, or session auth for resolve.",
      );
    }
  },
});

export const authStatus = defineCommand({
  meta: {
    name: "status",
    description: "Show authentication status",
  },
  async run() {
    const config = await loadConfig();
    const cookies = await loadCookies();
    const hasSession = Boolean(cookies[SESSION_COOKIE]);
    const hasApiKey = Boolean(config.apiKey);

    console.log(`Session:     ${hasSession ? "yes" : "no"}`);
    console.log(`API key:     ${hasApiKey ? "yes" : "no"}`);

    if (!hasSession && !hasApiKey) {
      console.log("Run `vekinbox auth login` to configure credentials.");
      return;
    }

    console.log(`Email:       ${config.email ?? "(not set)"}`);
    console.log(`Base URL:    ${config.baseUrl ?? "http://localhost:3001/v1"}`);
    if (hasApiKey && config.apiKey) {
      console.log(
        `API key:     ${config.apiKey.slice(0, 12)}...${config.apiKey.slice(-4)}`,
      );
    }
    console.log(`Workspace:   ${config.workspaceId ?? "(not set)"}`);
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
