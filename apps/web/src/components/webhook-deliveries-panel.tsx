import { Loader2, RefreshCw, Webhook } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import {
  api,
  ApiClientError,
  type WebhookDelivery,
} from "@/lib/api";
import type { RequestEventResponse } from "@latticeag/vekinbox-shared";
import { formatDateTime } from "@/lib/format";

interface WebhookDeliveriesPanelProps {
  requestId: string;
  events: RequestEventResponse[];
}

const statusVariant: Record<
  WebhookDelivery["status"],
  "default" | "secondary" | "destructive"
> = {
  delivered: "default",
  pending: "secondary",
  failed: "destructive",
};

export function WebhookDeliveriesPanel({
  requestId,
  events,
}: WebhookDeliveriesPanelProps) {
  const { workspace } = useAuth();
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [fromApi, setFromApi] = useState(false);
  const [loading, setLoading] = useState(true);
  const [redelivering, setRedelivering] = useState(false);

  const isAdmin = workspace?.role === "owner" || workspace?.role === "admin";
  const hasFailed = deliveries.some((d) => d.status === "failed");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.requests.webhooks(requestId, events);
      setDeliveries(result.data);
      setFromApi(result.fromApi);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Failed to load webhook deliveries",
      );
    } finally {
      setLoading(false);
    }
  }, [requestId, events]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRedeliver = async () => {
    setRedelivering(true);
    try {
      await api.requests.redeliver(requestId);
      toast.success("Webhook redelivery queued");
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Failed to redeliver webhook",
      );
    } finally {
      setRedelivering(false);
    }
  };

  if (!loading && deliveries.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4" />
            Webhook deliveries
          </CardTitle>
          <CardDescription>
            Resume webhook delivery attempts for this request.
            {!fromApi && deliveries.length > 0 && (
              <span className="block mt-1 text-xs">
                Showing delivery history from audit events.
              </span>
            )}
          </CardDescription>
        </div>
        {isAdmin && fromApi && hasFailed && (
          <Button
            variant="outline"
            size="sm"
            disabled={redelivering}
            onClick={handleRedeliver}
          >
            {redelivering ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Redeliver
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">URL</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead className="hidden md:table-cell">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell>
                      <Badge variant={statusVariant[delivery.status]}>
                        {delivery.status}
                      </Badge>
                      {(delivery.last_error || delivery.response_body) && (
                        <p className="mt-1 text-xs text-destructive">
                          {delivery.last_error ?? delivery.response_body}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-[200px] truncate font-mono text-xs sm:table-cell">
                      {delivery.url}
                    </TableCell>
                    <TableCell>{delivery.attempts}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {formatDateTime(
                        delivery.last_attempt_at ?? delivery.created_at,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
