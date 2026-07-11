import type { RequestResponse, RequestStatus } from "@latticeag/vekinbox-shared";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyInboxState } from "@/components/empty-inbox-state";
import { InboxListSkeleton } from "@/components/inbox-list-skeleton";
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
import { useInboxUpdates } from "@/hooks/use-inbox-updates";
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
  const [showUpdated, setShowUpdated] = useState(false);
  const previousPendingCount = useRef(0);

  const fetchRequests = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!workspace) {
        setRequests([]);
        if (!options?.silent) {
          setLoading(false);
        }
        return;
      }

      if (!options?.silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await api.requests.list(workspace.id, { limit: 100 });
        setRequests(res.data);

        const pendingCount = res.data.filter((r) =>
          pendingStatuses.includes(r.status),
        ).length;

        if (
          previousPendingCount.current > 0 &&
          pendingCount > previousPendingCount.current
        ) {
          setShowUpdated(true);
          setTimeout(() => setShowUpdated(false), 3000);
        }

        previousPendingCount.current = pendingCount;
      } catch (err) {
        if (!options?.silent) {
          setError(
            err instanceof ApiClientError
              ? err.message
              : "Failed to load requests",
          );
        }
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [workspace],
  );

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const { updatedAt, usingSse } = useInboxUpdates({
    workspaceId: workspace?.id ?? null,
    enabled: Boolean(workspace),
    onRefresh: () => fetchRequests({ silent: true }),
  });

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
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
            {(showUpdated || updatedAt) && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium transition-opacity ${
                  showUpdated
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground opacity-70"
                }`}
              >
                {showUpdated ? "New requests" : usingSse ? "Live" : "Updated"}
              </span>
            )}
          </div>
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
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="pending" className="flex-1 sm:flex-none">
            Pending
          </TabsTrigger>
          <TabsTrigger value="resolved" className="flex-1 sm:flex-none">
            Resolved
          </TabsTrigger>
          <TabsTrigger value="all" className="flex-1 sm:flex-none">
            All
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <InboxListSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyInboxState />
      ) : (
        <>
          <div className="hidden rounded-lg border md:block">
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

          <div className="space-y-3 md:hidden">
            {filtered.map((request) => (
              <Link
                key={request.id}
                to={`/inbox/${request.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-accent/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PriorityBadge priority={request.priority} />
                    <StatusBadge status={request.status} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(request.created_at)}
                  </span>
                </div>
                <p className="mt-2 font-medium">{request.title}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {request.key}
                </p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {request.agent_id}
                </p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
