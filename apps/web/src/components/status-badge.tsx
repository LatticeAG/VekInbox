import type { RequestStatus } from "@latticeag/vekinbox-shared";
import { Badge } from "@/components/ui/badge";
import { statusLabels } from "@/lib/format";

const statusVariant: Record<
  RequestStatus,
  "secondary" | "success" | "destructive" | "warning" | "muted" | "outline"
> = {
  pending: "warning",
  approved: "success",
  declined: "destructive",
  timed_out: "muted",
  escalated: "warning",
  cancelled: "muted",
  changes_requested: "outline",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge variant={statusVariant[status]}>{statusLabels[status]}</Badge>
  );
}
