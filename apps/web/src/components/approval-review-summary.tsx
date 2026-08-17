import { Check, Clock, Copy, Shield, Workflow } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ApprovalReviewContext } from "@/lib/approval-context";
import { formatDateTime, formatTimeout } from "@/lib/format";

interface ApprovalReviewSummaryProps {
  review: ApprovalReviewContext;
  timeoutAt: string | null;
}

function validDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function contextTime(value: string): { label: string; title?: string } {
  if (!validDate(value)) return { label: value };
  return { label: formatTimeout(value), title: formatDateTime(value) };
}

function DigestRow({
  label,
  digest,
  missingMessage,
}: {
  label: string;
  digest: string | null;
  missingMessage: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!digest || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(digest);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access is optional; the value remains selectable below.
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {digest ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed">
            {digest}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={() => void copy()}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      ) : (
        <p className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          {missingMessage}
        </p>
      )}
    </div>
  );
}

function WorkflowRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium">{children}</dd>
    </div>
  );
}

export function ApprovalReviewSummary({
  review,
  timeoutAt,
}: ApprovalReviewSummaryProps) {
  const hasWorkflowDetails = Boolean(
    review.policy.name ||
      review.policy.stage ||
      review.policy.requirement ||
      review.escalation.state ||
      review.escalation.nextAt ||
      review.revision.current ||
      timeoutAt,
  );

  return (
    <div className="space-y-4">
      <div
        role="note"
        className="rounded-md border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
      >
        <span className="font-semibold">Legacy compatibility review.</span>{" "}
        Action and context details below are v1 request metadata, not a sealed
        v3 authorization snapshot. Do not rely on them as proof that the
        action, policy, or evidence remains unchanged.
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.85fr)]">
        <Card className="overflow-hidden border-primary/20">
        <CardHeader className="border-b bg-primary/[0.035]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Shield className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">What will happen</CardTitle>
              <CardDescription className="mt-1">
                Review the action snapshot before recording a decision.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <p className="text-base font-medium leading-relaxed text-foreground">
            {review.actionSummary}
          </p>

          {review.actionFields.length > 0 && (
            <dl className="grid gap-x-6 gap-y-3 rounded-md border bg-muted/[0.18] p-4 sm:grid-cols-2">
              {review.actionFields.map((field) => (
                <div key={field.label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{field.label}</dt>
                  <dd className="mt-1 break-words text-sm font-medium">{field.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="grid gap-4">
            <DigestRow
              label="Action digest"
              digest={review.actionDigest}
              missingMessage="Legacy request: no immutable action digest was supplied. This review cannot be shown as a v3-bound action snapshot."
            />
            <DigestRow
              label="Context manifest digest"
              digest={review.contextManifestDigest}
              missingMessage="No sealed context manifest digest was supplied with this legacy request."
            />
          </div>
        </CardContent>
        </Card>

        <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Workflow className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Decision status</CardTitle>
              <CardDescription className="mt-1">
                Policy and deadline information supplied for this review.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {hasWorkflowDetails ? (
            <dl className="space-y-3.5">
              {(review.policy.name || review.policy.template) && (
                <WorkflowRow label="Policy">
                  <span className="break-words">
                    {review.policy.name ?? "Template-defined policy"}
                    {review.policy.version && (
                      <span className="ml-1 font-mono text-xs text-muted-foreground">
                        v{review.policy.version}
                      </span>
                    )}
                    {review.policy.template && (
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        Template: {review.policy.template}
                      </span>
                    )}
                  </span>
                </WorkflowRow>
              )}
              {review.policy.stage && (
                <WorkflowRow label="Current stage">{review.policy.stage}</WorkflowRow>
              )}
              {review.policy.requirement && (
                <WorkflowRow label="Requirement">{review.policy.requirement}</WorkflowRow>
              )}
              {timeoutAt && (
                <WorkflowRow label="Deadline">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span title={formatDateTime(timeoutAt)}>{formatTimeout(timeoutAt)}</span>
                  </span>
                </WorkflowRow>
              )}
              {review.escalation.state && (
                <WorkflowRow label="Escalation">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="warning">{review.escalation.state}</Badge>
                    {review.escalation.step && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {review.escalation.step}
                      </span>
                    )}
                  </span>
                </WorkflowRow>
              )}
              {review.escalation.nextAt && (
                <WorkflowRow label="Next escalation">
                  <span title={contextTime(review.escalation.nextAt).title}>
                    {contextTime(review.escalation.nextAt).label}
                  </span>
                </WorkflowRow>
              )}
              {review.escalation.target && (
                <WorkflowRow label="Escalation target">
                  <span className="break-all font-mono text-xs">{review.escalation.target}</span>
                </WorkflowRow>
              )}
              {review.revision.current && (
                <WorkflowRow label="Revision">{review.revision.current}</WorkflowRow>
              )}
              {review.revision.freshness && (
                <WorkflowRow label="Context freshness">
                  <span title={contextTime(review.revision.freshness).title}>
                    {contextTime(review.revision.freshness).label}
                  </span>
                </WorkflowRow>
              )}
            </dl>
          ) : (
            <p className="rounded-md border border-dashed px-3 py-3 text-sm leading-relaxed text-muted-foreground">
              This legacy request has no policy-stage metadata. The v1 server
              can record its request-state transition, but it does not provide
              v3 eligibility or authorization guarantees.
            </p>
          )}

          {review.policy.trace && (
            <details className="mt-5 rounded-md border bg-muted/[0.18] p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Policy trace
              </summary>
              <pre className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed text-foreground">
                {review.policy.trace}
              </pre>
            </details>
          )}
        </CardContent>
        </Card>
      </div>
    </div>
  );
}
