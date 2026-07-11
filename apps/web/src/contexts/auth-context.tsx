import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { UserResponse } from "@latticeag/vekinbox-shared";
import { api, ApiClientError, type WorkspaceSummary } from "@/lib/api";

const WORKSPACE_STORAGE_KEY = "vekinbox:active-workspace-id";

interface AuthContextValue {
  user: UserResponse | null;
  workspaces: WorkspaceSummary[];
  workspace: WorkspaceSummary | null;
  workspaceId: string | null;
  loading: boolean;
  login: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => void;
  createWorkspace: (name: string, slug?: string) => Promise<WorkspaceSummary>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredWorkspaceId(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeWorkspaceId(workspaceId: string) {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
  } catch {
    // ignore storage errors
  }
}

function clearStoredWorkspaceId() {
  try {
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserResponse | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    readStoredWorkspaceId,
  );
  const [loading, setLoading] = useState(true);

  const syncWorkspaceSelection = useCallback((list: WorkspaceSummary[]) => {
    const stored = readStoredWorkspaceId();
    const match = stored ? list.find((ws) => ws.id === stored) : undefined;
    const nextId = match?.id ?? list[0]?.id ?? null;

    setWorkspaceId(nextId);
    if (nextId) {
      storeWorkspaceId(nextId);
    } else {
      clearStoredWorkspaceId();
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api.auth.me();
      setUser(me);
      try {
        const ws = await api.workspaces.list();
        setWorkspaces(ws.data);
        syncWorkspaceSelection(ws.data);
      } catch {
        setWorkspaces([]);
        setWorkspaceId(null);
        clearStoredWorkspaceId();
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setUser(null);
        setWorkspaces([]);
        setWorkspaceId(null);
        clearStoredWorkspaceId();
      } else {
        throw err;
      }
    }
  }, [syncWorkspaceSelection]);

  useEffect(() => {
    refresh()
      .catch(() => {
        setUser(null);
        setWorkspaces([]);
        setWorkspaceId(null);
        clearStoredWorkspaceId();
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  const login = async (email: string) => {
    await api.auth.devLogin(email);
    await refresh();
  };

  const logout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // ignore logout errors
    }
    setUser(null);
    setWorkspaces([]);
    setWorkspaceId(null);
    clearStoredWorkspaceId();
  };

  const setActiveWorkspace = useCallback((id: string) => {
    setWorkspaceId(id);
    storeWorkspaceId(id);
  }, []);

  const createWorkspace = useCallback(
    async (name: string, slug?: string) => {
      const created = await api.workspaces.create({ name, slug });
      const summary: WorkspaceSummary = {
        ...created,
        role: "owner",
      };
      setWorkspaces((prev) => {
        const next = [...prev.filter((ws) => ws.id !== summary.id), summary];
        return next;
      });
      setWorkspaceId(summary.id);
      storeWorkspaceId(summary.id);
      return summary;
    },
    [],
  );

  const workspace = useMemo(
    () => workspaces.find((ws) => ws.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        workspaces,
        workspace,
        workspaceId,
        loading,
        login,
        logout,
        refresh,
        setActiveWorkspace,
        createWorkspace,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
