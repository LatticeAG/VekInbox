import { Check, Clock, MessageSquare, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ApprovalReviewContext } from "@/lib/approval-context";
import { formatTimeout } from "@/lib/format";

export interface ReviewAction {
  name: string;
  label?: string;
}

interface DecisionPanelProps {
  actions: ReviewAction[];
  blockedActionNames?: string[];
  actionLoading: boolean;
  pending: boolean;
  priority: string;
  status: string;
  timeoutAt: string | null;
  review: ApprovalReviewContext;
  resolutionNote?: string | null;
  onAction: (action: string) => void;
}

function actionLabel(action: ReviewAction): string {
  if (action.label) return action.label;

  switch (action.name) {
    case "approve":
      return "Approve";
    case "decline":
      return "Decline";
    case "request_changes":
      return "Request changes";
    default:
      return action.name.replace(/[_-]+/g, " ");
  }
}

function actionIcon(action: string) {
  switch (action) {
    case "approve":
      return Check;
    case "decline":
      return X;
    case "request_changes":
      return MessageSquare;
    default:
      return ShieldCheck;
  }
}

function actionVariant(action: string): "default" | "destructive" | "outline" | "secondary" {
  switch (action) {
    case "approve":
      return "default";
    case "decline":
      return "destructive";
    case "request_changes":
      return "outline";
    default:
      return "secondary";
  }
}

function statusLabel(status: string): string {
  return status.replace(/[_-]+/g, " ");
}

export function DecisionPanel({
  actions,
  blockedActionNames = [],
  actionLoading,
  pending,
  priority,
  status,
  timeoutAt,
  review,
  resolutionNote,
  onAction,
}: DecisionPanelProps) {
  const acknowledgedCount = review.evidence.filter(
    (item) => item.acknowledgementRequired,
  ).length;

  return (
    <Card className="border-primary/20 shadow-md shadow-primary/[0.04]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          {pending ? "Review decision" : "Decision recorded"}
        </CardTitle>
        <CardDescription>
          {pending
            ? "Choose a response after reviewing the action and evidence."
            : `This request is ${statusLabel(status)}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pending ? (
          <>
            <dl className="space-y-2.5 rounded-md border bg-muted/[0.18] p-3 text-xs">
              {timeoutAt && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Deadline
                  </dt>
                  <dd className="font-medium">{formatTimeout(timeoutAt)}</dd>
                </div>
              )}
              {review.policy.stage && (
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">Stage</dt>
                  <dd className="text-right font-medium">{review.policy.stage}</dd>
                </div>
              )}
              {review.policy.requirement && (
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">Requirement</dt>
                  <dd className="text-right font-medium">{review.policy.requirement}</dd>
                </div>
              )}
              {review.escalation.state && (
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-muted-foreground">Escalation</dt>
                  <dd className="text-right font-medium">{review.escalation.state}</dd>
                </div>
              )}
            </dl>

            {priority === "critical" && (
              <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                Critical request: confirm the action snapshot and evidence before submitting.
              </p>
            )}

            {acknowledgedCount > 0 && (
              <p className="rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {acknowledgedCount} evidence {acknowledgedCount === 1 ? "item requires" : "items require"} acknowledgement in the decision form.
              </p>
            )}

            {blockedActionNames.length > 0 && (
              <p
                role="status"
                className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300"
              >
                {blockedActionNames.length === 1
                  ? `The custom action “${blockedActionNames[0]}” is unavailable in the legacy reviewer.`
                  : `${blockedActionNames.length} custom actions are unavailable in the legacy reviewer.`} {" "}
                Their outcomes are not safely defined by the v1 API.
              </p>
            )}

            {actions.length > 0 ? (
              <div className="grid gap-2">
                {actions.map((action) => {
                  const Icon = actionIcon(action.name);
                  return (
                    <Button
                      key={action.name}
                      type="button"
                      variant={actionVariant(action.name)}
                      className="w-full justify-center"
                      disabled={actionLoading}
                      onClick={() => onAction(action.name)}
                    >
                      <Icon className="h-4 w-4" />
                      {actionLabel(action)}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-md border border-dashed px-3 py-3 text-sm leading-relaxed text-muted-foreground">
                No safely defined decision action is available for this legacy
                request.
              </p>
            )}

            <p className="text-xs leading-relaxed text-muted-foreground">
              The server records this legacy decision. V3 eligibility, version,
              and policy-satisfaction checks require a v2 approval case.
            </p>
          </>
        ) : (
          <>
            {resolutionNote && (
              <div className="rounded-md border bg-muted/[0.18] p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Reviewer rationale
                </p>
                <p className="mt-1.5 text-sm leading-relaxed">{resolutionNote}</p>
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              See the audit timeline for the recorded event and decision evidence.
            </p>
          </>
        )}

        {actionLoading && (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            Recording your decision…
          </p>
        )}
      </CardContent>
    </Card>
  );
}
