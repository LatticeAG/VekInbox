import { AlertTriangle } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApprovalReviewContext } from "@/lib/approval-context";

const actionLabels: Record<string, string> = {
  approve: "Approve",
  decline: "Decline",
  request_changes: "Request changes",
};

export interface DecisionSubmission {
  note?: string;
  acknowledgedContextItems: string[];
}

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: string;
  actionLabel?: string;
  actionSummary: string;
  actionDigest: string | null;
  review: ApprovalReviewContext;
  isCritical: boolean;
  rationaleRequired: boolean;
  loading: boolean;
  onConfirm: (submission: DecisionSubmission) => void;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  action,
  actionLabel,
  actionSummary,
  actionDigest,
  review,
  isCritical,
  rationaleRequired,
  loading,
  onConfirm,
}: ConfirmActionDialogProps) {
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const rationaleId = useId();
  const requiredEvidence = useMemo(
    () => review.evidence.filter((item) => item.acknowledgementRequired),
    [review.evidence],
  );
  const displayAction = actionLabel ?? actionLabels[action] ?? action.replace(/[_-]+/g, " ");

  useEffect(() => {
    if (!open) return;
    setNote("");
    setAcknowledged([]);
    setValidationMessage(null);
  }, [action, open]);

  const toggleAcknowledgement = (id: string) => {
    setAcknowledged((current) =>
      current.includes(id)
        ? current.filter((itemId) => itemId !== id)
        : [...current, id],
    );
    setValidationMessage(null);
  };

  const handleConfirm = () => {
    const trimmedNote = note.trim();
    if (rationaleRequired && !trimmedNote) {
      setValidationMessage("A rationale is required for this decision.");
      return;
    }
    if (acknowledged.length !== requiredEvidence.length) {
      setValidationMessage("Acknowledge each required evidence item before continuing.");
      return;
    }

    onConfirm({
      note: trimmedNote || undefined,
      acknowledgedContextItems: acknowledged,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCritical && (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
            Confirm {displayAction.toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            {isCritical ? (
              <>
                This is a <strong>critical priority</strong> request. Please
                verify carefully before proceeding.
              </>
            ) : (
              <>You are about to {displayAction.toLowerCase()} this request.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Action snapshot
            </p>
            <p className="mt-1 text-sm font-medium leading-relaxed">{actionSummary}</p>
          </div>
          {actionDigest ? (
            <div>
              <p className="text-xs text-muted-foreground">Action digest</p>
              <code className="mt-1 block break-all font-mono text-xs">{actionDigest}</code>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
              No immutable action digest was supplied for this legacy request.
            </p>
          )}
          {review.contextManifestDigest && (
            <div>
              <p className="text-xs text-muted-foreground">
                Context manifest digest
              </p>
              <code className="mt-1 block break-all font-mono text-xs">
                {review.contextManifestDigest}
              </code>
            </div>
          )}
        </div>

        <p
          role="note"
          className="rounded-md border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
        >
          This records a legacy v1 decision. It does not provide the v3
          version, policy, identity-assurance, or sealed-context guarantees.
        </p>

        {requiredEvidence.length > 0 && (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Required evidence acknowledgement</legend>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Confirm that you reviewed each item. These acknowledgements are recorded with the decision payload.
            </p>
            <div className="space-y-2 rounded-md border p-3">
              {requiredEvidence.map((item) => {
                const checkboxId = `evidence-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                return (
                  <label key={item.id} htmlFor={checkboxId} className="flex cursor-pointer items-start gap-2.5 text-sm">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      checked={acknowledged.includes(item.id)}
                      onChange={() => toggleAcknowledgement(item.id)}
                      disabled={loading}
                    />
                    <span>
                      <span className="font-medium">{item.title}</span>
                      <span className="ml-1 text-xs text-muted-foreground">({item.type})</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="space-y-2">
          <Label htmlFor={rationaleId}>
            Rationale {rationaleRequired ? <span className="text-destructive">(required)</span> : <span className="font-normal text-muted-foreground">(optional)</span>}
          </Label>
          <Textarea
            id={rationaleId}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setValidationMessage(null);
            }}
            placeholder={
              action === "request_changes"
                ? "Describe what needs to change before this can be approved."
                : "Record the reasoning behind this decision."
            }
            rows={3}
            disabled={loading}
            aria-describedby={validationMessage ? `${rationaleId}-error` : undefined}
          />
        </div>

        {validationMessage && (
          <p id={`${rationaleId}-error`} role="alert" className="text-sm text-destructive">
            {validationMessage}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={action === "decline" ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? "Recording…" : displayAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
