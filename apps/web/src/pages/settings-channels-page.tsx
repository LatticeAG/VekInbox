import type { ChannelResponse, CreateChannelInput } from "@latticeag/vekinbox-shared";
import { Hash, Loader2, Mail, Plus, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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

const channelIcons = {
  email: Mail,
  slack: Hash,
  web: Radio,
} as const;

export function SettingsChannelsPage() {
  const { workspace, user } = useAuth();
  const [channels, setChannels] = useState<ChannelResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<CreateChannelInput["type"]>("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");

  const loadChannels = async () => {
    if (!workspace) {
      setChannels([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await api.workspaces.channels(workspace.id);
      setChannels(res.data);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Failed to load channels",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadChannels();
  }, [workspace?.id]);

  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
  }, [user?.email]);

  const resetForm = () => {
    setType("email");
    setName("");
    setEmail(user?.email ?? "");
    setSlackWebhookUrl("");
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace || !name.trim()) return;

    const config: Record<string, unknown> = {};

    if (type === "email") {
      if (!email.trim()) {
        toast.error("Email address is required");
        return;
      }
      config.email = email.trim();
    }

    if (type === "slack") {
      if (!slackWebhookUrl.trim()) {
        toast.error("Slack incoming webhook URL is required");
        return;
      }
      try {
        const parsed = new URL(slackWebhookUrl.trim());
        if (
          parsed.protocol !== "https:" ||
          !["hooks.slack.com", "hooks.slack-gov.com"].includes(
            parsed.hostname.toLowerCase(),
          )
        ) {
          throw new Error("invalid Slack webhook host");
        }
      } catch {
        toast.error("Use an HTTPS Slack incoming webhook URL");
        return;
      }
      config.webhook_url = slackWebhookUrl.trim();
    }

    setSaving(true);
    try {
      const created = await api.workspaces.createChannel(workspace.id, {
        type,
        name: name.trim(),
        config,
      });
      setChannels((prev) => [created, ...prev]);
      toast.success(`Channel "${created.name}" created`);
      resetForm();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Failed to create channel",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!workspace) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a workspace first to configure notification channels.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Notification channels</CardTitle>
            <CardDescription>
              Email, Slack incoming webhooks, and web channels for escalation notifications.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" />
            Add channel
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {showForm && (
            <form
              onSubmit={handleSubmit}
              className="rounded-lg border bg-muted/20 p-4 space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Channel type</Label>
                  <Select
                    value={type}
                    onValueChange={(v) =>
                      setType(v as CreateChannelInput["type"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="slack">Slack</SelectItem>
                      <SelectItem value="web">Web</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="channel-name">Display name</Label>
                  <Input
                    id="channel-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Team alerts"
                    required
                  />
                </div>
              </div>

              {type === "email" && (
                <div className="space-y-2">
                  <Label htmlFor="channel-email">Email address</Label>
                  <Input
                    id="channel-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              )}

              {type === "slack" && (
                <div className="space-y-2">
                  <Label htmlFor="slack-webhook-url">
                    Slack incoming webhook URL
                  </Label>
                  <Input
                    id="slack-webhook-url"
                    type="url"
                    value={slackWebhookUrl}
                    onChange={(e) => setSlackWebhookUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/..."
                    autoComplete="off"
                    required
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Slack receives a redacted, open-only notification. Final
                    approval still happens in VekInbox.
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create channel
                </Button>
                <Button type="button" variant="ghost" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : channels.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No notification channels configured yet.
            </p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden sm:table-cell">Config</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channels.map((channel) => {
                    const Icon = channelIcons[channel.type];
                    return (
                      <TableRow key={channel.id}>
                        <TableCell className="font-medium">
                          {channel.name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="gap-1">
                            <Icon className="h-3 w-3" />
                            {channel.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden max-w-xs truncate font-mono text-xs text-muted-foreground sm:table-cell">
                          {JSON.stringify(channel.config)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(channel.created_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
