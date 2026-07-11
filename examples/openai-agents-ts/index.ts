/**
 * OpenAI Agents SDK tool with human approval gate.
 *
 * Requires: npm install @latticeag/vekinbox @openai/agents
 * Env: VEKINBOX_API_KEY, VEKINBOX_WORKSPACE_ID, AGENT_RESUME_URL (optional)
 */

import { VekInbox } from "@latticeag/vekinbox";

const inbox = new VekInbox({
  apiKey: process.env.VEKINBOX_API_KEY!,
  baseUrl: process.env.VEKINBOX_BASE_URL ?? "http://localhost:3001/v1",
});

interface PayInvoiceArgs {
  invoiceId: string;
  amount: number;
  vendor: string;
}

/**
 * Example tool execute handler — wrap with VekInbox approval before side effects.
 */
export async function payInvoiceWithApproval(args: PayInvoiceArgs): Promise<string> {
  const workspaceId = process.env.VEKINBOX_WORKSPACE_ID;
  if (!workspaceId) {
    throw new Error("VEKINBOX_WORKSPACE_ID is required");
  }

  const req = await inbox.requests.create({
    workspaceId,
    key: `pay.${args.invoiceId}`,
    title: `Pay invoice ${args.invoiceId} ($${args.amount})?`,
    description: `Vendor: ${args.vendor}`,
    metadata: args,
    resumeWebhook: process.env.AGENT_RESUME_URL,
    priority: "high",
  });

  const result = await inbox.requests.waitForResolution(req.id, { timeout: "1h" });
  if (result.status !== "approved") {
    throw new Error(`Payment not approved (status: ${result.status})`);
  }

  return `Paid invoice ${args.invoiceId} for $${args.amount}`;
}

// Demo when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  payInvoiceWithApproval({
    invoiceId: "INV-1024",
    amount: 450,
    vendor: "Acme Corp",
  })
    .then(console.log)
    .catch(console.error);
}
