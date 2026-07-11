import type { CreatePolicyInput } from "@latticeag/vekinbox-shared";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/auth-context";
import { api, ApiClientError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { PolicyResponse } from "@latticeag/vekinbox-shared";

type PolicyStep = CreatePolicyInput["steps"][number];

const emptyStep = (): PolicyStep => ({
  delay_ms: 300_000,
  notify: {},
  message: "",
});

export function SettingsPoliciesPage() {
  const { workspace, user } = useAuth();
  const [policies, setPolicies] = useState<PolicyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [defaultAction, setDefaultAction] = useState("decline");
  const [steps, setSteps] = useState<PolicyStep[]>([emptyStep()]);

  const preview = useMemo(
    () =>
      JSON.stringify(
        {
          name,
          steps,
          default_action_on_timeout: defaultAction,
        },
        null,
        2,
      ),
    [name, steps, defaultAction],
  );

  const loadPolicies = async () => {
    if (!workspace) {
      setPolicies([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await api.workspaces.policies(workspace.id);
      setPolicies(res.data);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Failed to load policies",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPolicies();
  }, [workspace?.id]);

  const resetForm = () => {
    setName("");
    setDefaultAction("decline");
    setSteps([emptyStep()]);
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (policy: PolicyResponse) => {
    setEditingId(policy.id);
    setName(policy.name);
    setDefaultAction(policy.default_action_on_timeout);
    setSteps(
      (policy.steps as PolicyStep[]).length > 0
        ? (policy.steps as PolicyStep[])
        : [emptyStep()],
    );
    setShowForm(true);
  };

  const updateStep = (index: number, patch: Partial<PolicyStep>) => {
    setSteps((prev) =>
      prev.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );
  };

  const updateNotify = (
    index: number,
    field: "user_id" | "channel_id",
    value: string,
  ) => {
    setSteps((prev) =>
      prev.map((step, i) =>
        i === index
          ? {
              ...step,
              notify: {
                ...step.notify,
                [field]: value || undefined,
              },
            }
          : step,
      ),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !name.trim()) return;

    setSaving(true);
    try {
      const body: CreatePolicyInput = {
        name: name.trim(),
        steps: steps.map((step) => ({
          delay_ms: step.delay_ms,
          notify: step.notify,
          message: step.message || undefined,
        })),
        default_action_on_timeout: defaultAction,
      };

      const created = await api.workspaces.createPolicy(workspace.id, body);
      setPolicies((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
      toast.success(
        editingId ? "Policy saved as new version" : "Policy created",
      );
      resetForm();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Failed to save policy",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!workspace) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a workspace first to configure escalation policies.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Escalation policies</CardTitle>
            <CardDescription>
              Define timed escalation steps and timeout actions.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New policy
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : policies.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No escalation policies yet.
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Steps</TableHead>
                    <TableHead>Timeout action</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policies.map((policy) => (
                    <TableRow key={policy.id}>
                      <TableCell className="font-medium">{policy.name}</TableCell>
                      <TableCell>{policy.steps.length}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {policy.default_action_on_timeout}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(policy.created_at)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(policy)}
                        >
                          Edit
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

      {showForm && (
        <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {editingId ? "Edit policy" : "Create policy"}
              </CardTitle>
              <CardDescription>
                {editingId
                  ? "Edits create a new policy record (update API not available yet)."
                  : "Build escalation steps with delays and notifications."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="policy-name">Policy name</Label>
                <Input
                  id="policy-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Default action on timeout</Label>
                <Select value={defaultAction} onValueChange={setDefaultAction}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="decline">Decline</SelectItem>
                    <SelectItem value="approve">Approve</SelectItem>
                    <SelectItem value="escalate">Escalate</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Steps</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSteps((prev) => [...prev, emptyStep()])}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add step
                  </Button>
                </div>

                {steps.map((step, index) => (
                  <div
                    key={index}
                    className="rounded-lg border bg-muted/20 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Step {index + 1}</p>
                      {steps.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setSteps((prev) =>
                              prev.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Delay (minutes)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={Math.round(step.delay_ms / 60_000)}
                        onChange={(e) =>
                          updateStep(index, {
                            delay_ms: Number(e.target.value) * 60_000,
                          })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Notify user email</Label>
                      <Input
                        type="email"
                        placeholder={user?.email ?? "reviewer@example.com"}
                        value={step.notify.user_id ?? ""}
                        onChange={(e) =>
                          updateNotify(index, "user_id", e.target.value)
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Notify channel ID</Label>
                      <Input
                        placeholder="ch_..."
                        value={step.notify.channel_id ?? ""}
                        onChange={(e) =>
                          updateNotify(index, "channel_id", e.target.value)
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Message</Label>
                      <Input
                        value={step.message ?? ""}
                        onChange={(e) =>
                          updateStep(index, { message: e.target.value })
                        }
                        placeholder="Optional escalation message"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editingId ? "Save as new" : "Create policy"}
                </Button>
                <Button type="button" variant="ghost" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">JSON preview</CardTitle>
              <CardDescription>
                Payload sent to POST /v1/workspaces/:id/policies
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-md bg-muted/50 p-4 font-mono text-xs leading-relaxed">
                {preview}
              </pre>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  );
}
