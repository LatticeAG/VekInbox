import { Bot, Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { api, ApiClientError, type AgentSummary } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export function SettingsPage() {
  const { user, workspace, workspaces } = useAuth();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) {
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.workspaces.agents(workspace.id);
        setAgents(res.data);
      } catch (err) {
        setError(
          err instanceof ApiClientError
            ? err.message
            : "Failed to load agents",
        );
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [workspace]);

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Workspace configuration and registered agents.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" />
              Workspace
            </CardTitle>
            <CardDescription>Current workspace details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {workspace ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{workspace.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Slug</span>
                  <span className="font-mono text-xs">{workspace.slug}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Role</span>
                  <span className="capitalize">{workspace.role}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono text-xs">{workspace.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{formatDateTime(workspace.created_at)}</span>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">
                No workspace yet. Create one via POST /v1/workspaces.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>Signed-in reviewer.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email</span>
              <span>{user.email}</span>
            </div>
            {user.name && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span>{user.name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">User ID</span>
              <span className="font-mono text-xs">{user.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Workspaces</span>
              <span>{workspaces.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" />
            Agents
          </CardTitle>
          <CardDescription>
            API-key authenticated principals that can create approval requests.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {!workspace ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Create a workspace first to register agents.
            </p>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
            </div>
          ) : agents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No agents registered yet. Create one via the API or CLI.
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Description
                    </TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((agent) => (
                    <TableRow key={agent.id}>
                      <TableCell>
                        <p className="font-medium">{agent.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {agent.id}
                        </p>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {agent.description || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(agent.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
