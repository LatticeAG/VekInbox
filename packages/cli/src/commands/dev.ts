import { createServer } from "node:http";
import { defineCommand } from "citty";
import {
  verifyWebhookSignature,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "@latticeag/vekinbox-shared";

function formatWebhookBox(lines: string[]): void {
  const width = Math.max(...lines.map((l) => l.length), 40);
  const border = "─".repeat(width + 2);
  console.log(`┌${border}┐`);
  for (const line of lines) {
    console.log(`│ ${line.padEnd(width)} │`);
  }
  console.log(`└${border}┘`);
}

export const devCommand = defineCommand({
  meta: {
    name: "dev",
    description: "Local webhook receiver for development",
  },
  args: {
    "forward-to": {
      type: "string",
      description: "URL to forward verified webhooks to",
      required: true,
    },
    port: {
      type: "string",
      description: "Local listen port",
      default: "4040",
    },
    secret: {
      type: "string",
      description: "Webhook signing secret (optional; skips verify if omitted)",
    },
  },
  async run({ args }) {
    const port = Number(args.port);
    const forwardTo = args["forward-to"];
    const secret = args.secret;

    const server = createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method not allowed");
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const rawBody = Buffer.concat(chunks);
      const bodyText = rawBody.toString("utf8");

      const headers: Record<string, string | string[] | undefined> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key] = value;
      }

      const deliveryId = headers[WEBHOOK_DELIVERY_ID_HEADER] as string | undefined;
      const timestamp = headers[WEBHOOK_TIMESTAMP_HEADER] as string | undefined;
      const signaturePresent = Boolean(headers[WEBHOOK_SIGNATURE_HEADER]);

      let signatureStatus: string;
      if (!secret) {
        signatureStatus = "skipped (no --secret)";
      } else if (!signaturePresent) {
        signatureStatus = "missing signature header";
        formatWebhookBox([
          "Webhook received",
          `Time:      ${new Date().toISOString()}`,
          `Delivery:  ${deliveryId ?? "(none)"}`,
          `Signature: ${signatureStatus}`,
        ]);
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Missing signature");
        return;
      } else {
        const valid = verifyWebhookSignature(headers, rawBody, secret);
        signatureStatus = valid ? "verified" : "INVALID";
        if (!valid) {
          formatWebhookBox([
            "Webhook received",
            `Time:      ${new Date().toISOString()}`,
            `Delivery:  ${deliveryId ?? "(none)"}`,
            `Timestamp: ${timestamp ?? "(none)"}`,
            `Signature: ${signatureStatus}`,
          ]);
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("Invalid signature");
          return;
        }
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(bodyText) as Record<string, unknown>;
      } catch {
        payload = { raw: bodyText };
      }

      const lines = [
        "Webhook received",
        `Time:      ${new Date().toISOString()}`,
        `Delivery:  ${deliveryId ?? "(none)"}`,
        `Timestamp: ${timestamp ?? "(none)"}`,
        `Signature: ${signatureStatus}`,
        `Request:   ${String(payload["request_id"] ?? "(unknown)")}`,
        `Status:    ${String(payload["status"] ?? "(unknown)")}`,
        `Action:    ${String(payload["action"] ?? "(unknown)")}`,
        `Key:       ${String(payload["key"] ?? "(unknown)")}`,
      ];
      formatWebhookBox(lines);
      console.log("Payload:", JSON.stringify(payload, null, 2));

      try {
        const forwardRes = await fetch(forwardTo, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-VekInbox-Forwarded": "true",
          },
          body: bodyText,
        });
        const forwardText = await forwardRes.text();
        console.log(`→ Forwarded to ${forwardTo} (${forwardRes.status})`);
        res.writeHead(forwardRes.status, { "Content-Type": "application/json" });
        res.end(forwardText || "{}");
      } catch (err) {
        console.error("Forward failed:", err);
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Forward failed");
      }
    });

    server.listen(port, () => {
      console.log(`VekInbox dev webhook receiver on http://localhost:${port}`);
      console.log(`Forwarding to ${forwardTo}`);
      if (secret) {
        console.log("Signature verification: enabled");
      } else {
        console.log("Signature verification: disabled (pass --secret to enable)");
      }
      console.log("Set resume_webhook_url to this server when testing locally.");
    });
  },
});
