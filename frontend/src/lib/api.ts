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

// ── Optimistic concurrency (Phase 19, Part D) ───────────────────────────────
// The last version of each trip this tab has seen. Edits to a trip, its stops or its itinerary
// send it as If-Match, so a stale tab gets a 409 instead of silently overwriting a collaborator.
const tripVersions = new Map<string, number>();
const TRIP_PATH = /^\/trips\/([0-9a-f-]{36})(\/[^?]*)?/;
const VERSIONED = /^\/(waypoints|itinerary|radius|corridor|calculate-route)(\/|$)/;

export function getTripVersion(tripId: string): number | undefined {
  return tripVersions.get(tripId);
}

export function rememberTripVersion(tripId: string, version: number) {
  tripVersions.set(tripId, version);
}

function versionHeader(path: string, method: string | undefined): Record<string, string> {
  const m = TRIP_PATH.exec(path);
  if (!m || !method || method === "GET" || method === "HEAD") return {};
  const sub = m[2] ?? "";
  const versioned = (sub === "" && method === "PATCH") || VERSIONED.test(sub);
  const version = tripVersions.get(m[1]);
  return versioned && version !== undefined ? { "If-Match": String(version) } : {};
}

function noteVersions(path: string, res: Response, data?: unknown) {
  const m = TRIP_PATH.exec(path);
  if (!m) return;
  const header = res.headers.get("X-Trip-Version");
  if (header) tripVersions.set(m[1], Number(header));
  else if (!m[2] && data && typeof data === "object" && "version" in data) {
    tripVersions.set(m[1], Number((data as { version: number }).version));
  }
}

/** Fired when a save is refused because someone else changed the trip first. */
export const TRIP_CONFLICT_EVENT = "trip-conflict";

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
      ...versionHeader(path, rest.method),
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

  if (res.status === 409) {
    const body = (await res.clone().json().catch(() => null)) as { code?: string; version?: number; detail?: string } | null;
    if (body?.code === "version_conflict") {
      const tripId = TRIP_PATH.exec(path)?.[1];
      if (tripId) window.dispatchEvent(new CustomEvent(TRIP_CONFLICT_EVENT, { detail: { tripId } }));
      throw new Error(`API 409: ${JSON.stringify(body)}`);
    }
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
  if (res.status === 204) {
    noteVersions(path, res);
    return undefined as T;
  }

  const data = (await res.json()) as T;
  noteVersions(path, res, data);
  return data;
}

/** The human-readable part of a thrown API error: pulls `detail` out of "API 400: {...}". */
export function apiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (!(err instanceof Error)) return fallback;
  const match = /^API \d+: ([\s\S]*)$/.exec(err.message);
  if (!match) return err.message || fallback;
  try {
    const body = JSON.parse(match[1]) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      // FastAPI validation errors: [{msg: "Value error, Password must be ..."}]
      return body.detail
        .map((d) => String((d as { msg?: string }).msg ?? "").replace(/^Value error, /, ""))
        .filter(Boolean)
        .join(" ") || fallback;
    }
  } catch {
    // not JSON: fall through
  }
  return match[1] || fallback;
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

  // A body is allowed because DELETE /auth/me needs the password to confirm.
  delete: <T>(path: string, options?: Omit<RequestOptions, "method">) =>
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
