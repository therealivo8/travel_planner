const API_URL = "/api";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

// Module-level token store — set by AuthContext after login/refresh.
let _accessToken: string | null = null;

export function setApiToken(token: string | null): void {
  _accessToken = token;
}

export function getApiToken(): string | null {
  return _accessToken;
}

// Deduplicates concurrent 401s into a single /auth/refresh call.
let _refreshPromise: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (!_refreshPromise) {
    _refreshPromise = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { access_token: string };
        return data.access_token;
      })
      .catch(() => null)
      .finally(() => {
        _refreshPromise = null;
      });
  }
  return _refreshPromise;
}

async function doFetch(path: string, options: RequestOptions): Promise<Response> {
  const { body, headers, ...rest } = options;

  const authHeader: Record<string, string> = _accessToken
    ? { Authorization: `Bearer ${_accessToken}` }
    : {};

  return fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...rest,
  });
}

async function request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const res = await doFetch(path, options);

  // Skip /auth/* so a failing login/refresh call can't trigger another refresh attempt.
  if (res.status === 401 && !isRetry && !path.startsWith("/auth/")) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      setApiToken(newToken);
      return request<T>(path, options, true);
    }
    setApiToken(null);
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new SessionExpiredError();
  }

  // Phase 14 cost guardrails: the backend sends a machine-readable code and reset time.
  if (res.status === 429 || res.status === 503) {
    const body = (await res.clone().json().catch(() => null)) as {
      detail?: string;
      code?: string;
      resets_at?: string;
    } | null;
    if (body?.code === "budget_exhausted" || body?.code === "user_quota") {
      throw new ApiError(
        body.detail ?? "This action is temporarily unavailable.",
        res.status,
        body.code,
        body.resets_at ?? null
      );
    }
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    const seconds = retryAfter ? parseInt(retryAfter, 10) : null;
    const message = seconds
      ? `Too many requests. Please wait ${seconds} second${seconds !== 1 ? "s" : ""} before trying again.`
      : "Too many requests. Please wait a moment before trying again.";
    throw new Error(message);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

/** A guardrail refusal: `budget_exhausted` (shared API budget, 503) or `user_quota` (429). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "budget_exhausted" | "user_quota",
    readonly resetsAt: string | null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown when a request 401s and the subsequent refresh attempt also fails. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired. Please log in again.");
    this.name = "SessionExpiredError";
  }
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body }),

  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PUT", body }),

  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PATCH", body }),

  delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "DELETE" }),
};

/** Geocode an address via the backend proxy (keeps Maps key server-side). */
export function geocodeAddress(q: string) {
  return api.get<{ address: string; lat: number; lng: number; place_id: string | null } | null>(
    `/geocode?q=${encodeURIComponent(q)}`
  );
}

import type {
  AdminUsage,
  CorridorDiscoverResponse,
  CorridorSelectRequest,
  ItineraryBuildOut,
  ItineraryBuildRequest,
  MyQuota,
  RadiusDiscoverResponse,
  RadiusSelectRequest,
  Trip,
} from "@/types";

export function discoverRadius(tripId: string, categories?: string[], refresh = false) {
  const params = new URLSearchParams();
  categories?.forEach((c) => params.append("categories", c));
  if (refresh) params.set("refresh", "true");
  const qs = params.toString();
  return api.post<RadiusDiscoverResponse>(`/trips/${tripId}/radius/discover${qs ? `?${qs}` : ""}`);
}

export function getRadiusSuggestions(tripId: string) {
  return api.get<RadiusDiscoverResponse>(`/trips/${tripId}/radius/suggestions`);
}

export function selectSuggestions(tripId: string, body: RadiusSelectRequest) {
  return api.post<Trip>(`/trips/${tripId}/radius/select`, body);
}

export function deselectSuggestion(tripId: string, suggestionId: string) {
  return api.delete(`/trips/${tripId}/radius/suggestions/${suggestionId}/select`);
}

export function buildRadiusItinerary(tripId: string, body: ItineraryBuildRequest) {
  return api.post<ItineraryBuildOut>(`/trips/${tripId}/radius/build-itinerary`, body);
}

export function discoverCorridor(
  tripId: string,
  opts?: { categories?: string[]; maxDetourMinutes?: number; refresh?: boolean }
) {
  const params = new URLSearchParams();
  if (opts?.refresh) params.set("refresh", "true");
  opts?.categories?.forEach((c) => params.append("categories", c));
  if (opts?.maxDetourMinutes != null) {
    params.set("max_detour_minutes", String(opts.maxDetourMinutes));
  }
  const qs = params.toString();
  return api.post<CorridorDiscoverResponse>(
    `/trips/${tripId}/corridor/discover${qs ? `?${qs}` : ""}`
  );
}

export function getCorridorSuggestions(tripId: string) {
  return api.get<CorridorDiscoverResponse>(`/trips/${tripId}/corridor/suggestions`);
}

export function selectCorridorSuggestions(tripId: string, body: CorridorSelectRequest) {
  return api.post<Trip>(`/trips/${tripId}/corridor/select`, body);
}

export function deselectCorridorSuggestion(tripId: string, suggestionId: string) {
  return api.delete(`/trips/${tripId}/corridor/suggestions/${suggestionId}/select`);
}

export function getMyQuota() {
  return api.get<MyQuota>("/usage/me");
}

export function getAdminUsage() {
  return api.get<AdminUsage>("/admin/usage");
}
