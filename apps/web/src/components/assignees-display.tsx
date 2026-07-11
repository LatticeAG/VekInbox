import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AssigneesDisplayProps {
  assignees?: string[];
}

export function AssigneesDisplay({ assignees }: AssigneesDisplayProps) {
  if (!assignees?.length) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Assigned reviewers
        </CardTitle>
        <CardDescription>
          Reviewers assigned to this approval request.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {assignees.map((assignee) => (
            <Badge key={assignee} variant="secondary" className="font-mono text-xs">
              {assignee}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
