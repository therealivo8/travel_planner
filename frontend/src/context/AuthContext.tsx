"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { setApiToken } from "@/lib/api";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  setToken: (token: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });

  const tokenRef = useRef<string | null>(null);

  const setToken = useCallback((token: string) => {
    tokenRef.current = token;
    setApiToken(token);
    setState((prev) => ({ ...prev, accessToken: token }));
  }, []);

  const fetchMe = useCallback(async (token: string): Promise<AuthUser | null> => {
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json() as Promise<AuthUser>;
    } catch {
      return null;
    }
  }, []);

  // On mount, try to refresh the session via httpOnly cookie
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (res.ok) {
          const data = (await res.json()) as { access_token: string };
          const user = await fetchMe(data.access_token);
          if (!cancelled) {
            tokenRef.current = data.access_token;
            setApiToken(data.access_token);
            setState({ user, accessToken: data.access_token, isLoading: false });
          }
          return;
        }
      } catch {
        /* no-op */
      }
      if (!cancelled) {
        setState({ user: null, accessToken: null, isLoading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? "Login failed");
      }
      const data = (await res.json()) as { access_token: string };
      const user = await fetchMe(data.access_token);
      tokenRef.current = data.access_token;
      setApiToken(data.access_token);
      setState({ user, accessToken: data.access_token, isLoading: false });
    },
    [fetchMe]
  );

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const res = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, display_name: displayName ?? null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? "Registration failed");
      }
      const data = (await res.json()) as { access_token: string };
      const user = await fetchMe(data.access_token);
      tokenRef.current = data.access_token;
      setApiToken(data.access_token);
      setState({ user, accessToken: data.access_token, isLoading: false });
    },
    [fetchMe]
  );

  const logout = useCallback(() => {
    tokenRef.current = null;
    setApiToken(null);
    setState({ user: null, accessToken: null, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, setToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
