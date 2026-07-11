import type { RequestAction } from "@latticeag/vekinbox-shared";
import { buildEmailActionUrl, createEmailActionToken } from "@latticeag/vekinbox-shared";
import nodemailer from "nodemailer";

function getSmtpConfig() {
  const host = process.env["SMTP_HOST"];
  const port = Number(process.env["SMTP_PORT"] ?? 587);
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  const from = process.env["SMTP_FROM"] ?? "noreply@vekinbox.local";

  if (!host) {
    throw new Error("SMTP_HOST is not set");
  }

  return {
    from,
    transport: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    }),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function buildActionLinks(
  requestId: string,
  userId: string,
  actions: RequestAction[] | { name: string; label?: string }[],
): Promise<string> {
  const links: string[] = [];
  for (const action of actions) {
    const name = action.name;
    const label = action.label ?? name.replace(/_/g, " ");
    const token = await createEmailActionToken({ request_id: requestId, action: name, user_id: userId });
    const url = buildEmailActionUrl(token);
    links.push(
      `<a href="${escapeHtml(url)}" style="display:inline-block;margin:4px 8px 4px 0;padding:8px 16px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>`,
    );
  }
  return links.join("");
}

export async function sendRequestNotificationEmail(params: {
  to: string;
  userId: string;
  requestId: string;
  title: string;
  description: string;
  priority: string;
  agentName: string;
  actions: RequestAction[] | { name: string; label?: string }[];
  metadata?: Record<string, unknown>;
  timeoutAt?: string | null;
}) {
  const { from, transport } = getSmtpConfig();
  const subject = `[VekInbox] ${params.priority} — ${params.title}`;
  const description = params.description.slice(0, 500);
  const metadataSummary = params.metadata
    ? Object.entries(params.metadata)
        .slice(0, 8)
        .map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</li>`)
        .join("")
    : "";

  const actionLinks = await buildActionLinks(params.requestId, params.userId, params.actions);

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: 'IBM Plex Sans', system-ui, sans-serif; color: #18181b; line-height: 1.5;">
  <h1 style="font-size: 20px; margin-bottom: 8px;">${escapeHtml(params.title)}</h1>
  <p style="color: #52525b; margin-top: 0;">
    Agent: ${escapeHtml(params.agentName)} · Priority: ${escapeHtml(params.priority)}
    ${params.timeoutAt ? ` · Expires: ${escapeHtml(new Date(params.timeoutAt).toLocaleString())}` : ""}
  </p>
  ${description ? `<p>${escapeHtml(description)}</p>` : ""}
  ${metadataSummary ? `<ul>${metadataSummary}</ul>` : ""}
  <div style="margin: 24px 0;">
    ${actionLinks}
  </div>
  <p style="color: #71717a; font-size: 12px;">Action links expire in 30 minutes and are single-use.</p>
</body>
</html>`;

  await transport.sendMail({
    from,
    to: params.to,
    subject,
    html,
  });
}
