import type { RequestEventResponse } from "@latticeag/vekinbox-shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

const eventLabels: Record<string, string> = {
  "request.created": "Request created",
  "request.resolved": "Request resolved",
  "request.cancelled": "Request cancelled",
  "request.timed_out": "Timed out",
  "request.escalated": "Escalated",
  "webhook.delivered": "Webhook delivered",
  "webhook.failed": "Webhook delivery failed",
  "notification.sent": "Notification sent",
};

function eventLabel(type: string): string {
  return eventLabels[type] ?? type.replace(/\./g, " ").replace(/_/g, " ");
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audit timeline</CardTitle>
        <CardDescription>
          Immutable history of actions on this request.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-0 border-l border-border pl-6">
          {sorted.map((event, i) => (
            <li key={event.id} className="relative pb-6 last:pb-0">
              <span
                className={`absolute -left-[25px] flex h-3 w-3 items-center justify-center rounded-full border-2 border-background ${
                  i === 0 ? "bg-primary" : "bg-muted-foreground/40"
                }`}
              />
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">{eventLabel(event.type)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(event.created_at)}
                  {event.actor_id && ` · ${event.actor_type}:${event.actor_id}`}
                </p>
                {event.payload && Object.keys(event.payload).length > 0 && (
                  <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-xs">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
