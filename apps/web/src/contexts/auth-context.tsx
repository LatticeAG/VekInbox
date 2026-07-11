import { createContext, useContext, useEffect, useState } from "react";
import type { UserResponse } from "@latticeag/vekinbox-shared";
import { api, ApiClientError, type WorkspaceSummary } from "@/lib/api";

interface AuthContextValue {
  user: UserResponse | null;
  workspaces: WorkspaceSummary[];
  workspace: WorkspaceSummary | null;
  loading: boolean;
  login: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserResponse | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const me = await api.auth.me();
      setUser(me);
      try {
        const ws = await api.workspaces.list();
        setWorkspaces(ws.data);
      } catch {
        setWorkspaces([]);
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setUser(null);
        setWorkspaces([]);
      } else {
        throw err;
      }
    }
  };

  useEffect(() => {
    refresh()
      .catch(() => {
        setUser(null);
        setWorkspaces([]);
      })
      .finally(() => setLoading(false));
  }, []);

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
  };

  const workspace = workspaces[0] ?? null;

  return (
    <AuthContext.Provider
      value={{ user, workspaces, workspace, loading, login, logout, refresh }}
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
