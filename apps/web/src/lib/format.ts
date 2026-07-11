import type { RequestPriority, RequestStatus } from "@latticeag/vekinbox-shared";

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const absDiff = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const minutes = Math.round(absDiff / 60_000);
  if (minutes < 60) {
    return rtf.format(Math.sign(diffMs) * minutes, "minute");
  }

  const hours = Math.round(absDiff / 3_600_000);
  if (hours < 48) {
    return rtf.format(Math.sign(diffMs) * hours, "hour");
  }

  const days = Math.round(absDiff / 86_400_000);
  return rtf.format(Math.sign(diffMs) * days, "day");
}

export function formatDateTime(dateStr: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dateStr));
}

export function formatTimeout(timeoutAt?: string | null): string {
  if (!timeoutAt) return "—";
  const date = new Date(timeoutAt);
  const now = new Date();
  if (date < now) return "Expired";
  return formatRelativeTime(timeoutAt);
}

export const priorityLabels: Record<RequestPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  critical: "Critical",
};

export const statusLabels: Record<RequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  timed_out: "Timed out",
  escalated: "Escalated",
  cancelled: "Cancelled",
  changes_requested: "Changes requested",
};

export const pendingStatuses: RequestStatus[] = ["pending", "escalated"];

export const resolvedStatuses: RequestStatus[] = [
  "approved",
  "declined",
  "timed_out",
  "cancelled",
  "changes_requested",
];

export function isPending(status: RequestStatus): boolean {
  return pendingStatuses.includes(status);
}

export const SDK_QUICKSTART = `import { VekInbox } from "@latticeag/vekinbox";

const inbox = new VekInbox({
  apiKey: process.env.VEKINBOX_API_KEY!,
});

const request = await inbox.requests.create({
  workspaceId: "ws_...",
  key: "invoice.pay.001",
  title: "Approve $450 invoice payment?",
  description: "Vendor: Acme Corp. Invoice #1024.",
  priority: "high",
  timeout: "1h",
  actions: ["approve", "decline", "request_changes"],
  resumeWebhook: "https://my-agent.example.com/resume",
  metadata: { invoice_id: 1024 },
});

const result = await request.waitForResolution({ timeout: "1h" });`;
