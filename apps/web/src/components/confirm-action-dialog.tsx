import type { RequestActionName } from "@latticeag/vekinbox-shared";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const actionLabels: Record<RequestActionName, string> = {
  approve: "Approve",
  decline: "Decline",
  request_changes: "Request changes",
};

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: RequestActionName;
  title: string;
  isCritical: boolean;
  loading: boolean;
  onConfirm: () => void;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  action,
  title,
  isCritical,
  loading,
  onConfirm,
}: ConfirmActionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isCritical && (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
            Confirm {actionLabels[action].toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            {isCritical ? (
              <>
                This is a <strong>critical priority</strong> request. Please
                verify carefully before proceeding.
              </>
            ) : (
              <>You are about to {actionLabels[action].toLowerCase()} this request.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-sm font-medium">{title}</p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant={action === "decline" ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Processing…" : actionLabels[action]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
