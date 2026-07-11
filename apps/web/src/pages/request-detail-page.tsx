import { ArrowLeft, Bot, Check, MessageSquare, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useParams } from "react-router-dom";
import { AuditTimeline } from "@/components/audit-timeline";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { PriorityBadge } from "@/components/priority-badge";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api, ApiClientError, type RequestDetail } from "@/lib/api";
import { formatDateTime, formatTimeout, isPending } from "@/lib/format";

type ActionName = "approve" | "decline" | "request_changes";

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ActionName | null>(null);

  const fetchRequest = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.requests.get(id);
      setRequest(data);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Failed to load request",
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchRequest();
  }, [fetchRequest]);

  const handleAction = async (action: ActionName) => {
    if (!request) return;

    if (request.priority === "critical") {
      setConfirmAction(action);
      return;
    }

    await executeAction(action);
  };

  const executeAction = async (action: ActionName) => {
    if (!request) return;
    setActionLoading(true);
    setError(null);
    try {
      await api.requests.action(request.id, action);
      setConfirmAction(null);
      await fetchRequest();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Failed to perform action",
      );
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (error && !request) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/inbox">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to inbox
          </Link>
        </Button>
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      </div>
    );
  }

  if (!request) return null;

  const pending = isPending(request.status);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/inbox">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to inbox
            </Link>
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={request.priority} />
            <StatusBadge status={request.status} />
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">
            {request.title}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Bot className="h-4 w-4" />
              <span className="font-mono text-xs">{request.agent_id}</span>
            </span>
            <span>Created {formatDateTime(request.created_at)}</span>
            {request.timeout_at && (
              <span>Timeout {formatTimeout(request.timeout_at)}</span>
            )}
          </div>

          <p className="font-mono text-xs text-muted-foreground">
            {request.id} · {request.key}
          </p>
        </div>

        {pending && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={actionLoading}
              onClick={() => handleAction("request_changes")}
            >
              <MessageSquare className="mr-1.5 h-4 w-4" />
              Request changes
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={actionLoading}
              onClick={() => handleAction("decline")}
            >
              <X className="mr-1.5 h-4 w-4" />
              Decline
            </Button>
            <Button
              size="sm"
              disabled={actionLoading}
              onClick={() => handleAction("approve")}
            >
              <Check className="mr-1.5 h-4 w-4" />
              Approve
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {request.description && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose-inbox">
                  <ReactMarkdown>{request.description}</ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}

          {request.metadata && Object.keys(request.metadata).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Metadata</CardTitle>
                <CardDescription>
                  Agent-provided context for this request.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-md bg-muted/50 p-4 font-mono text-xs leading-relaxed">
                  {JSON.stringify(request.metadata, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={request.status} />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Priority</span>
                <PriorityBadge priority={request.priority} />
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Agent</span>
                <span className="truncate font-mono text-xs">
                  {request.agent_id}
                </span>
              </div>
              {request.resolved_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Resolved</span>
                  <span>{formatDateTime(request.resolved_at)}</span>
                </div>
              )}
              {request.resolved_by && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Resolved by</span>
                  <span className="font-mono text-xs">{request.resolved_by}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <AuditTimeline events={request.events} />
        </div>
      </div>

      <ConfirmActionDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        action={confirmAction ?? "approve"}
        title={request.title}
        isCritical={request.priority === "critical"}
        loading={actionLoading}
        onConfirm={() => confirmAction && executeAction(confirmAction)}
      />
    </div>
  );
}
