"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Role = "super_admin" | "admin" | "marketer";
type ThemeValue = "light" | "dark";

export type Permissions = Record<string, boolean>;

export type SessionUser = {
  id: number;
  full_name: string;
  email: string;
  role: Role;
  theme: ThemeValue;
  permissions: Permissions;
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "session_expired";

export type LoginResult = SessionUser | { two_fa_required: true; pending_token: string };

type AuthContextValue = {
  status: AuthStatus;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  verify2FA: (pendingToken: string, code: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ authenticated: boolean; reason?: string } & Partial<SessionUser>>("/v1/auth/me");
      if (me.authenticated) {
        setUser(me as SessionUser);
        setStatus("authenticated");
      } else {
        setUser(null);
        setStatus(me.reason === "session_expired" ? "session_expired" : "unauthenticated");
      }
    } catch {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    // Session status can only be known after an async call to the API on mount;
    // this is a genuine data fetch, not state that could be computed during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  useEffect(() => {
    // Idle sessions (server-side 2h TTL) would otherwise only surface as a failed
    // request on the user's next click — poll while authenticated so it's caught and
    // shown as the session-expired modal instead.
    if (status !== "authenticated") return;
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [status, refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<LoginResult>("/v1/auth/login", { email, password });
    if ("two_fa_required" in result) {
      return result;
    }
    setUser(result);
    setStatus("authenticated");
    return result;
  }, []);

  const verify2FA = useCallback(async (pendingToken: string, code: string) => {
    const me = await api.post<SessionUser>("/v1/auth/verify-2fa", { pending_token: pendingToken, code });
    setUser(me);
    setStatus("authenticated");
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/v1/auth/logout");
    } finally {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  return <AuthContext.Provider value={{ status, user, login, verify2FA, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
