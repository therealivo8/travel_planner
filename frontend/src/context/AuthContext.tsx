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
import { clearOfflineData } from "@/lib/offline";

const CACHED_USER_KEY = "rtp-user";

function readCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: AuthUser | null) {
  try {
    if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHED_USER_KEY);
  } catch {
    /* private mode: offline sign-in just isn't remembered */
  }
}

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  units: "imperial" | "metric";
  home_address: string | null;
  home_lat: number | null;
  home_lng: number | null;
  default_stop_minutes: number;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  setToken: (token: string) => void;
  /** Replace the cached profile after a settings change. */
  setUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_URL = "/api";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });

  const tokenRef = useRef<string | null>(null);
  // When login/register completes, we set this to prevent the concurrent
  // refresh effect from overwriting the freshly-set auth state.
  const loggedInRef = useRef(false);

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
      const user = (await res.json()) as AuthUser;
      writeCachedUser(user);
      return user;
    } catch {
      return null;
    }
  }, []);

  // On mount, try to restore the session via httpOnly refresh-token cookie.
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
          if (!cancelled && !loggedInRef.current) {
            tokenRef.current = data.access_token;
            setApiToken(data.access_token);
            setState({ user, accessToken: data.access_token, isLoading: false });
          }
          return;
        }
      } catch {
        // Network failure while offline: keep the user signed in with their last-known
        // profile so saved trips open. (A 401 above falls through to signed-out instead.)
        const cached = typeof navigator !== "undefined" && !navigator.onLine ? readCachedUser() : null;
        if (cached && !cancelled && !loggedInRef.current) {
          setState({ user: cached, accessToken: null, isLoading: false });
          return;
        }
      }
      if (!cancelled && !loggedInRef.current) {
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
      if (!user) throw new Error("Failed to fetch user profile after login");
      loggedInRef.current = true;
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
      if (!user) throw new Error("Failed to fetch user profile after registration");
      loggedInRef.current = true;
      tokenRef.current = data.access_token;
      setApiToken(data.access_token);
      setState({ user, accessToken: data.access_token, isLoading: false });
    },
    [fetchMe]
  );

  const setUser = useCallback((user: AuthUser) => {
    writeCachedUser(user);
    setState((prev) => ({ ...prev, user }));
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    } catch {
      /* clear client state regardless of network failure */
    }
    loggedInRef.current = false;
    tokenRef.current = null;
    setApiToken(null);
    writeCachedUser(null);
    void clearOfflineData(); // saved trips are private data in Cache Storage
    setState({ user: null, accessToken: null, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, setToken, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
