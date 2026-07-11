import { Bot, Key, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiKeyModal } from "@/components/api-key-modal";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { api, ApiClientError, type AgentSummary } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export function SettingsAgentsPage() {
  const { workspace } = useAuth();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyAgentName, setKeyAgentName] = useState<string>();
  const [keyLoadingId, setKeyLoadingId] = useState<string | null>(null);

  const loadAgents = async () => {
    if (!workspace) {
      setAgents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await api.workspaces.agents(workspace.id);
      setAgents(res.data);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Failed to load agents",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAgents();
  }, [workspace?.id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !name.trim()) return;

    setCreating(true);
    try {
      const agent = await api.workspaces.createAgent(workspace.id, {
        name: name.trim(),
        description: description.trim(),
        permissions: {},
      });
      setAgents((prev) => [agent, ...prev]);
      setName("");
      setDescription("");
      setShowForm(false);
      toast.success(`Agent "${agent.name}" created`);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Failed to create agent",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleCreateKey = async (agent: AgentSummary) => {
    setKeyLoadingId(agent.id);
    try {
      const result = await api.agents.createKey(agent.id);
      setApiKey(result.key);
      setKeyAgentName(agent.name);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Failed to create API key",
      );
    } finally {
      setKeyLoadingId(null);
    }
  };

  if (!workspace) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a workspace first to register agents.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4" />
              Agents
            </CardTitle>
            <CardDescription>
              API-key authenticated principals that create approval requests.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" />
            New agent
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {showForm && (
            <form
              onSubmit={handleCreate}
              className="rounded-lg border bg-muted/20 p-4 space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="invoice-bot"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-description">Description</Label>
                <Textarea
                  id="agent-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Handles invoice approval requests"
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={creating}>
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create agent
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : agents.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No agents registered yet. Create one to get started.
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
                    <TableHead className="w-[120px]" />
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
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={keyLoadingId === agent.id}
                          onClick={() => handleCreateKey(agent)}
                        >
                          {keyLoadingId === agent.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Key className="h-3.5 w-3.5" />
                          )}
                          API key
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ApiKeyModal
        open={apiKey !== null}
        onOpenChange={(open) => !open && setApiKey(null)}
        apiKey={apiKey}
        agentName={keyAgentName}
      />
    </div>
  );
}
