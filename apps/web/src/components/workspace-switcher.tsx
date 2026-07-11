import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

export function WorkspaceSwitcher() {
  const { workspaces, workspace, setActiveWorkspace } = useAuth();

  if (workspaces.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-[200px] justify-between gap-2 font-normal"
        >
          <span className="truncate">
            {workspace?.name ?? "Select workspace"}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((ws) => (
          <DropdownMenuItem
            key={ws.id}
            onClick={() => setActiveWorkspace(ws.id)}
            className="flex items-center justify-between"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{ws.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {ws.slug}
              </p>
            </div>
            <Check
              className={cn(
                "h-4 w-4 shrink-0",
                workspace?.id === ws.id ? "opacity-100" : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
