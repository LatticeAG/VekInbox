import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const POLL_INTERVAL_MS = 10_000;

interface UseInboxUpdatesOptions {
  workspaceId: string | null;
  enabled?: boolean;
  onRefresh: () => void | Promise<void>;
}

export function useInboxUpdates({
  workspaceId,
  enabled = true,
  onRefresh,
}: UseInboxUpdatesOptions) {
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [usingSse, setUsingSse] = useState(false);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const markUpdated = useCallback(() => {
    setUpdatedAt(new Date());
    void onRefreshRef.current();
  }, []);

  useEffect(() => {
    if (!workspaceId || !enabled) {
      setUsingSse(false);
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let eventSource: EventSource | null = null;
    let sseOpened = false;

    const startPolling = () => {
      if (pollTimer) return;
      setUsingSse(false);
      pollTimer = setInterval(() => {
        void onRefreshRef.current();
        setUpdatedAt(new Date());
      }, POLL_INTERVAL_MS);
    };

    const url = api.workspaces.eventsStreamUrl(workspaceId);
    eventSource = new EventSource(url, { withCredentials: true });

    const openTimeout = setTimeout(() => {
      if (!sseOpened && !cancelled) {
        eventSource?.close();
        eventSource = null;
        startPolling();
      }
    }, 4000);

    eventSource.onopen = () => {
      sseOpened = true;
      clearTimeout(openTimeout);
      if (!cancelled) {
        setUsingSse(true);
      }
    };

    eventSource.addEventListener("request.updated", () => {
      markUpdated();
    });

    eventSource.onmessage = () => {
      markUpdated();
    };

    eventSource.onerror = () => {
      clearTimeout(openTimeout);
      eventSource?.close();
      eventSource = null;
      if (!cancelled) {
        startPolling();
      }
    };

    return () => {
      cancelled = true;
      clearTimeout(openTimeout);
      eventSource?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [workspaceId, enabled, markUpdated]);

  return { updatedAt, usingSse };
}
