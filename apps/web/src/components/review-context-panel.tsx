import {
  AlertTriangle,
  ExternalLink,
  FileCode,
  FileText,
  Link as LinkIcon,
  ListChecks,
  ScrollText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  ApprovalReviewContext,
  ReviewContextItem,
} from "@/lib/approval-context";

const PREVIEW_LIMIT = 8_000;

function contextIcon(type: ReviewContextItem["type"]) {
  switch (type) {
    case "diff":
      return FileCode;
    case "log":
      return ScrollText;
    case "link":
      return LinkIcon;
    default:
      return FileText;
  }
}

function typeLabel(type: ReviewContextItem["type"]): string {
  switch (type) {
    case "diff":
      return "Diff";
    case "log":
      return "Log";
    case "link":
      return "Link";
    case "artifact":
      return "Artifact";
    case "instruction":
      return "Instruction";
    case "field":
      return "Context";
  }
}

function contentPreview(content: string): { content: string; truncated: boolean } {
  if (content.length <= PREVIEW_LIMIT) return { content, truncated: false };
  return {
    content: `${content.slice(0, PREVIEW_LIMIT)}\n\n… Preview truncated in the browser`,
    truncated: true,
  };
}

function ContextItem({ item }: { item: ReviewContextItem }) {
  const Icon = contextIcon(item.type);
  const preview = item.content ? contentPreview(item.content) : null;

  return (
    <article className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 rounded-md bg-muted p-1.5 text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h3 className="break-words text-sm font-medium">{item.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{typeLabel(item.type)}</Badge>
              {item.classification && (
                <Badge variant="outline">{item.classification}</Badge>
              )}
              {item.acknowledgementRequired && (
                <Badge variant="warning">Acknowledgement required</Badge>
              )}
            </div>
          </div>
        </div>
        {item.href && (
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Open link
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {(preview || item.digest || item.provenance) && (
        <div className="space-y-3 p-4">
          {preview && (
            <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {preview.content}
            </pre>
          )}
          {preview?.truncated && (
            <p className="text-xs text-muted-foreground">
              The source is longer than the safe browser preview. Use the linked
              evidence source when one is available.
            </p>
          )}
          {(item.digest || item.provenance) && (
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              {item.digest && (
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Evidence digest</dt>
                  <dd className="mt-1 break-all font-mono">{item.digest}</dd>
                </div>
              )}
              {item.provenance && (
                <div className="min-w-0">
                  <dt className="text-muted-foreground">Provenance</dt>
                  <dd className="mt-1 break-words">{item.provenance}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}
    </article>
  );
}

export function ReviewContextPanel({ review }: { review: ApprovalReviewContext }) {
  const requiredEvidence = review.evidence.filter(
    (item) => item.acknowledgementRequired,
  );
  const hasContext = Boolean(
    review.evidence.length || review.riskExplanation || review.preconditions.length,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4" />
          Review context
        </CardTitle>
        <CardDescription>
          Compatibility previews of diffs, logs, artifacts, and links attached
          to this request. External links are never fetched by VekInbox from
          this screen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p
          role="note"
          className="rounded-md border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
        >
          These are legacy metadata previews. A v3 decision requires a
          server-sealed, classification-filtered context manifest.
        </p>

        {review.riskExplanation && (
          <section
            aria-labelledby="risk-explanation"
            className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
              <div>
                <h3 id="risk-explanation" className="text-sm font-medium">
                  Risk explanation
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-foreground/90">
                  {review.riskExplanation}
                </p>
              </div>
            </div>
          </section>
        )}

        {review.preconditions.length > 0 && (
          <section aria-labelledby="preconditions">
            <h3 id="preconditions" className="text-sm font-medium">
              Preconditions to verify
            </h3>
            <ul className="mt-2 space-y-2 rounded-md border bg-muted/[0.18] p-3 text-sm">
              {review.preconditions.map((precondition, index) => (
                <li key={`${precondition}-${index}`} className="flex gap-2">
                  <span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{precondition}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {requiredEvidence.length > 0 && (
          <p className="rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            You will be asked to acknowledge {requiredEvidence.length === 1 ? "this evidence item" : "these evidence items"} before a decision can be submitted.
          </p>
        )}

        {review.evidence.length > 0 ? (
          <div className="space-y-3">
            {review.evidence.map((item) => (
              <ContextItem key={item.id} item={item} />
            ))}
          </div>
        ) : !hasContext ? (
          <div className="rounded-md border border-dashed px-4 py-5 text-sm leading-relaxed text-muted-foreground">
            No structured review context was supplied. This legacy request may
            still include its original description or technical metadata below.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
