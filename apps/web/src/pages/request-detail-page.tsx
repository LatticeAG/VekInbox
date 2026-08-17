import { ArrowLeft, Bot } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ApprovalReviewSummary } from "@/components/approval-review-summary";
import { AssigneesDisplay } from "@/components/assignees-display";
import { AuditTimeline } from "@/components/audit-timeline";
import {
  ConfirmActionDialog,
  type DecisionSubmission,
} from "@/components/confirm-action-dialog";
import { DecisionPanel } from "@/components/decision-panel";
import { PriorityBadge } from "@/components/priority-badge";
import { RequestDetailSkeleton } from "@/components/request-detail-skeleton";
import { ReviewContextPanel } from "@/components/review-context-panel";
import { StatusBadge } from "@/components/status-badge";
import { WebhookDeliveriesPanel } from "@/components/webhook-deliveries-panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api, ApiClientError, type RequestDetail } from "@/lib/api";
import { createApprovalReviewContext } from "@/lib/approval-context";
import {
  isSafeLegacyDecisionAction,
  partitionLegacyDecisionActions,
  redactLegacyAuditPayload,
} from "@/lib/approval-safety";
import { formatDateTime, formatTimeout, isPending } from "@/lib/format";

function humanizeAction(action: string): string {
  switch (action) {
    case "approve":
      return "Approve";
    case "decline":
      return "Decline";
    case "request_changes":
      return "Request changes";
    default:
      return action.replace(/[_-]+/g, " ");
  }
}

function resolutionNote(request: RequestDetail): string | null {
  const note = request.resolution_payload?.["note"];
  return typeof note === "string" && note.trim() ? note : null;
}

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

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
    void fetchRequest();
  }, [fetchRequest]);

  const executeAction = async (
    action: string,
    submission: DecisionSubmission,
  ) => {
    if (!request) return;

    if (!isSafeLegacyDecisionAction(action)) {
      const message =
        "This custom legacy action cannot be submitted because its outcome is not safely defined.";
      setConfirmAction(null);
      setError(message);
      toast.error(message);
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const payload = submission.acknowledgedContextItems.length
        ? { acknowledged_context_items: submission.acknowledgedContextItems }
        : undefined;
      await api.requests.action(request.id, action, submission.note, payload);
      setConfirmAction(null);
      toast.success(`Request ${humanizeAction(action).toLowerCase()}`);
      await fetchRequest();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Failed to record decision";
      setError(message);
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <RequestDetailSkeleton />;
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
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      </div>
    );
  }

  if (!request) return null;

  const pending = isPending(request.status);
  const review = createApprovalReviewContext({
    title: request.title,
    requestId: request.id,
    requestKey: request.key,
    priority: request.priority,
    status: request.status,
    timeoutAt: request.timeout_at,
    escalationPolicyId: request.escalation_policy_id,
    metadata: request.metadata,
  });
  const safeMetadata = redactLegacyAuditPayload(request.metadata);
  const { safeActions, blockedActionNames } = partitionLegacyDecisionActions(
    request.actions,
  );
  const availableActions = safeActions.map((action) => ({
    name: action.name,
    label: action.label,
  }));
  const selectedAction = confirmAction
    ? availableActions.find((action) => action.name === confirmAction)
    : undefined;
  const selectedActionLabel = selectedAction?.label ??
    (confirmAction ? humanizeAction(confirmAction) : undefined);
  const requiresRationale = Boolean(
    review.rationaleRequired ||
      request.priority === "critical" ||
      confirmAction === "request_changes",
  );

  return (
    <div className="space-y-6">
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

        <h1 className="max-w-4xl break-words text-2xl font-semibold tracking-tight sm:text-3xl">
          {request.title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Bot className="h-4 w-4 shrink-0" />
            <span className="break-all font-mono text-xs">{request.agent_id}</span>
          </span>
          <span>Created {formatDateTime(request.created_at)}</span>
          {request.timeout_at && <span>Deadline {formatTimeout(request.timeout_at)}</span>}
        </div>

        <p className="break-all font-mono text-xs text-muted-foreground">
          {request.id} · {request.key}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <ApprovalReviewSummary review={review} timeoutAt={request.timeout_at} />

          <ReviewContextPanel review={review} />

          {request.description && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Agent description</CardTitle>
                <CardDescription>
                  Original request description, retained as supporting context.
                </CardDescription>
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
                <CardTitle className="text-base">Technical metadata</CardTitle>
                <CardDescription>
                  Raw compatibility metadata is secondary to the structured
                  review context above. Sensitive fields are redacted in this
                  legacy browser view.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <details className="rounded-md border bg-muted/[0.18] p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Show raw JSON
                  </summary>
                  <pre className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed">
                    {JSON.stringify(safeMetadata, null, 2)}
                  </pre>
                </details>
              </CardContent>
            </Card>
          )}

          <WebhookDeliveriesPanel
            requestId={request.id}
            events={request.events}
          />
        </div>

        <aside className="min-w-0 space-y-6">
          <div className="xl:sticky xl:top-20">
            <DecisionPanel
              actions={availableActions}
              actionLoading={actionLoading}
              pending={pending}
              priority={request.priority}
              status={request.status}
              timeoutAt={request.timeout_at}
              review={review}
              resolutionNote={resolutionNote(request)}
              blockedActionNames={blockedActionNames}
              onAction={setConfirmAction}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Request facts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={request.status} />
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Priority</span>
                <PriorityBadge priority={request.priority} />
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Agent</span>
                <span className="truncate font-mono text-xs">{request.agent_id}</span>
              </div>
              {request.resolved_at && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Resolved</span>
                  <span className="text-right">{formatDateTime(request.resolved_at)}</span>
                </div>
              )}
              {request.resolved_by && (
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Resolved by</span>
                  <span className="break-all text-right font-mono text-xs">{request.resolved_by}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <AssigneesDisplay assignees={request.assignees} />

          <AuditTimeline events={request.events} />
        </aside>
      </div>

      <ConfirmActionDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        action={confirmAction ?? "approve"}
        actionLabel={selectedActionLabel}
        actionSummary={review.actionSummary}
        actionDigest={review.actionDigest}
        review={review}
        isCritical={request.priority === "critical"}
        rationaleRequired={requiresRationale}
        loading={actionLoading}
        onConfirm={(submission) =>
          confirmAction && executeAction(confirmAction, submission)
        }
      />
    </div>
  );
}
