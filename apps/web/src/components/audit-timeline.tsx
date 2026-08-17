import type { RequestEventResponse } from "@latticeag/vekinbox-shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { redactLegacyAuditPayload } from "@/lib/approval-safety";
import { formatDateTime } from "@/lib/format";

const eventLabels: Record<string, string> = {
  "request.created": "Request created",
  "request.viewed": "Opened for review",
  "request.resolved": "Request resolved",
  "request.cancelled": "Request cancelled",
  "request.timed_out": "Timed out",
  "request.escalated": "Escalated",
  "request.superseded": "Revision superseded",
  "request.revised": "Revision created",
  "request.revision_created": "Revision created",
  "case.superseded": "Revision superseded",
  "case.revision_created": "Revision created",
  "decision.submitted": "Decision submitted",
  "decision.accepted": "Decision accepted",
  "decision.rejected": "Decision rejected",
  "decision.evidence_attested": "Evidence acknowledged",
  "policy.evaluated": "Policy evaluated",
  "stage.opened": "Approval stage opened",
  "stage.satisfied": "Approval stage satisfied",
  "context.manifest.sealed": "Context manifest sealed",
  "schedule.due": "Scheduled decision due",
  "schedule.confirmed": "Scheduled decision confirmed",
  "escalation.started": "Escalation started",
  "escalation.target.resolved": "Escalation target resolved",
  "request.webhook_delivered": "Webhook delivered",
  "request.webhook_failed": "Webhook delivery failed",
  "webhook.delivered": "Webhook delivered",
  "webhook.failed": "Webhook delivery failed",
  "notification.sent": "Notification sent",
};

function eventLabel(type: string): string {
  return eventLabels[type] ?? type.replace(/\./g, " ").replace(/_/g, " ");
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function actionLabel(action: string): string {
  switch (action) {
    case "approve":
      return "Approved";
    case "decline":
      return "Declined";
    case "request_changes":
      return "Changes requested";
    default:
      return action.replace(/[_-]+/g, " ");
  }
}

function eventNarrative(event: RequestEventResponse): {
  title: string;
  detail: string | null;
  acknowledgements: string[];
} {
  const payload = event.payload ?? {};
  const action = payloadString(payload, "action");
  const note = payloadString(payload, "note") ?? payloadString(payload, "reason");
  const acknowledgements = Array.isArray(payload["payload"])
    ? []
    : (() => {
        const decisionPayload = payload["payload"];
        if (
          typeof decisionPayload !== "object" ||
          decisionPayload === null ||
          Array.isArray(decisionPayload)
        ) {
          return [];
        }
        const items = (decisionPayload as Record<string, unknown>)[
          "acknowledged_context_items"
        ];
        return Array.isArray(items)
          ? items.filter((item): item is string => typeof item === "string")
          : [];
      })();

  if (event.type === "request.resolved" && action) {
    return {
      title: actionLabel(action),
      detail: note,
      acknowledgements,
    };
  }

  if (event.type === "decision.accepted" && action) {
    return {
      title: `${actionLabel(action)} decision accepted`,
      detail: note,
      acknowledgements,
    };
  }

  return {
    title: eventLabel(event.type),
    detail: note,
    acknowledgements,
  };
}

function isRevisionEvent(event: RequestEventResponse): boolean {
  return /supersed|revision|changes_requested/.test(event.type) ||
    (event.type === "request.resolved" && event.payload["action"] === "request_changes");
}

export function AuditTimeline({ events }: { events: RequestEventResponse[] }) {
  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit timeline</CardTitle>
          <CardDescription>No events recorded yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const sorted = [...events].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const revisionEvents = sorted.filter(isRevisionEvent);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audit timeline</CardTitle>
        <CardDescription>
          Recorded case, policy, escalation, and decision history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {revisionEvents.length > 0 && (
          <div className="mb-5 rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            Revision history detected: {revisionEvents.length} {revisionEvents.length === 1 ? "event" : "events"} affecting the action or requested changes. Review these before relying on an earlier decision.
          </div>
        )}
        <ol className="relative space-y-0 border-l border-border pl-6">
          {sorted.map((event, i) => {
            const narrative = eventNarrative(event);
            const safePayload = redactLegacyAuditPayload(event.payload);
            return (
              <li key={event.id} className="relative pb-6 last:pb-0">
                <span
                  className={`absolute -left-[25px] flex h-3 w-3 items-center justify-center rounded-full border-2 border-background ${
                    i === 0 ? "bg-primary" : "bg-muted-foreground/40"
                  }`}
                />
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">{narrative.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(event.created_at)}
                    {event.actor_id && ` · ${event.actor_type}:${event.actor_id}`}
                  </p>
                  {narrative.detail && (
                    <p className="mt-1 text-sm leading-relaxed">{narrative.detail}</p>
                  )}
                  {narrative.acknowledgements.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Evidence acknowledged: {narrative.acknowledgements.join(", ")}
                    </p>
                  )}
                  {Object.keys(safePayload).length > 0 && (
                    <details className="mt-1.5 rounded-md border bg-muted/[0.18] px-2.5 py-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Technical event data (sensitive fields redacted)
                      </summary>
                      <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed">
                        {JSON.stringify(safePayload, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
