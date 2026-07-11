import type { RequestResponse, RequestStatus } from "@latticeag/vekinbox-shared";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyInboxState } from "@/components/empty-inbox-state";
import { PriorityBadge } from "@/components/priority-badge";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/auth-context";
import { api, ApiClientError } from "@/lib/api";
import {
  formatDateTime,
  formatTimeout,
  pendingStatuses,
  resolvedStatuses,
} from "@/lib/format";

type TabFilter = "pending" | "resolved" | "all";

const tabStatusFilter: Record<TabFilter, RequestStatus[] | null> = {
  pending: pendingStatuses,
  resolved: resolvedStatuses,
  all: null,
};

export function InboxPage() {
  const { workspace } = useAuth();
  const [tab, setTab] = useState<TabFilter>("pending");
  const [search, setSearch] = useState("");
  const [requests, setRequests] = useState<RequestResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    if (!workspace) {
      setRequests([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await api.requests.list(workspace.id, { limit: 100 });
      setRequests(res.data);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "Failed to load requests",
      );
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const filtered = useMemo(() => {
    let list = requests;
    const statuses = tabStatusFilter[tab];
    if (statuses) {
      list = list.filter((r) => statuses.includes(r.status));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.key.toLowerCase().includes(q) ||
          r.agent_id.toLowerCase().includes(q),
      );
    }
    return list;
  }, [requests, tab, search]);

  if (!workspace) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          No workspace found. Create one via the API or CLI, then refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review and resolve agent approval requests.
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search title or key…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabFilter)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyInboxState />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Priority</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="hidden md:table-cell">Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Created</TableHead>
                <TableHead className="hidden lg:table-cell">Timeout</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((request) => (
                <TableRow key={request.id} className="cursor-pointer">
                  <TableCell>
                    <PriorityBadge priority={request.priority} />
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/inbox/${request.id}`}
                      className="block font-medium hover:underline"
                    >
                      {request.title}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {request.key}
                    </p>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {request.agent_id}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={request.status} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {formatDateTime(request.created_at)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {formatTimeout(request.timeout_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
