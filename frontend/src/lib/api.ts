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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;

  const authHeader: Record<string, string> = _accessToken
    ? { Authorization: `Bearer ${_accessToken}` }
    : {};

  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...rest,
  });

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
  CorridorDiscoverResponse,
  CorridorSelectRequest,
  ItineraryBuildOut,
  ItineraryBuildRequest,
  RadiusDiscoverResponse,
  RadiusSelectRequest,
  Trip,
} from "@/types";

export function discoverRadius(tripId: string, categories?: string[]) {
  const params = categories?.length
    ? "?" + categories.map((c) => `categories=${encodeURIComponent(c)}`).join("&")
    : "";
  return api.post<RadiusDiscoverResponse>(`/trips/${tripId}/radius/discover${params}`);
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
  opts?: { categories?: string[]; maxDetourMinutes?: number }
) {
  const params = new URLSearchParams();
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
