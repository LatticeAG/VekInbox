import { createServer } from "node:http";
import { defineCommand } from "citty";
import { verifyWebhookSignature } from "@latticeag/vekinbox-shared";

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
      default: "4242",
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

      if (secret) {
        const valid = verifyWebhookSignature(headers, rawBody, secret);
        if (!valid) {
          console.error("[vekinbox dev] Invalid webhook signature");
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("Invalid signature");
          return;
        }
        console.log("[vekinbox dev] Signature verified");
      }

      let payload: unknown;
      try {
        payload = JSON.parse(bodyText);
      } catch {
        payload = bodyText;
      }

      console.log("[vekinbox dev] Received webhook:", JSON.stringify(payload, null, 2));

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
        console.log(
          `[vekinbox dev] Forwarded to ${forwardTo} → ${forwardRes.status}`,
        );
        res.writeHead(forwardRes.status, { "Content-Type": "application/json" });
        res.end(forwardText || "{}");
      } catch (err) {
        console.error("[vekinbox dev] Forward failed:", err);
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Forward failed");
      }
    });

    server.listen(port, () => {
      console.log(`VekInbox dev webhook receiver listening on http://localhost:${port}`);
      console.log(`Forwarding verified payloads to ${forwardTo}`);
      console.log("Set resume_webhook_url to this server when testing locally.");
    });
  },
});
