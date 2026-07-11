import type { RequestPriority } from "@latticeag/vekinbox-shared";
import { Badge } from "@/components/ui/badge";
import { priorityLabels } from "@/lib/format";

const priorityVariant: Record<
  RequestPriority,
  "muted" | "secondary" | "warning" | "critical"
> = {
  low: "muted",
  normal: "secondary",
  high: "warning",
  critical: "critical",
};

export function PriorityBadge({ priority }: { priority: RequestPriority }) {
  return (
    <Badge variant={priorityVariant[priority]}>{priorityLabels[priority]}</Badge>
  );
}
