import { WebClient, type ActionsBlockElement } from "@slack/web-api";
import type { RequestAction } from "@latticeag/vekinbox-shared";

interface SlackChannelConfig {
  channel_id: string;
  bot_token?: string;
}

function getDefaultClient(): WebClient {
  const token = process.env["SLACK_BOT_TOKEN"];
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is not set");
  }
  return new WebClient(token);
}

function actionButtons(
  requestId: string,
  actions: RequestAction[] | { name: string; label?: string }[],
  webUrl: string,
) {
  const buttons: ActionsBlockElement[] = actions.slice(0, 4).map((action) => {
    const name = action.name;
    const label = action.label ?? name.replace(/_/g, " ");
    return {
      type: "button" as const,
      text: { type: "plain_text" as const, text: label },
      action_id: `resolve_${name}`,
      value: JSON.stringify({ request_id: requestId, action: name }),
    };
  });

  buttons.push({
    type: "button" as const,
    text: { type: "plain_text" as const, text: "Open in VekInbox" },
    url: `${webUrl}/requests/${requestId}`,
  });

  return buttons;
}

export async function sendRequestSlackNotification(params: {
  requestId: string;
  title: string;
  description: string;
  priority: string;
  agentName: string;
  actions: RequestAction[] | { name: string; label?: string }[];
  metadata?: Record<string, unknown>;
  timeoutAt?: string | null;
  channelConfig: SlackChannelConfig;
}) {
  const client = params.channelConfig.bot_token
    ? new WebClient(params.channelConfig.bot_token)
    : getDefaultClient();

  const webUrl = process.env["WEB_URL"] ?? "http://localhost:3001";
  const metadataLines = params.metadata
    ? Object.entries(params.metadata)
        .slice(0, 5)
        .map(([k, v]) => `*${k}:* ${String(v)}`)
        .join("\n")
    : "";

  const description = params.description ? params.description.slice(0, 300) : "";

  await client.chat.postMessage({
    channel: params.channelConfig.channel_id,
    text: `${params.title} — ${params.priority} priority`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🔔 *${params.title}*\nAgent: ${params.agentName} · Priority: ${params.priority}${params.timeoutAt ? ` · Expires: ${new Date(params.timeoutAt).toLocaleString()}` : ""}`,
        },
      },
      ...(description || metadataLines
        ? [
            {
              type: "section" as const,
              text: {
                type: "mrkdwn" as const,
                text: [description, metadataLines].filter(Boolean).join("\n"),
              },
            },
          ]
        : []),
      {
        type: "actions",
        elements: actionButtons(params.requestId, params.actions, webUrl),
      },
    ],
  });
}
