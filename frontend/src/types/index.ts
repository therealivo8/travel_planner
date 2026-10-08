// Trip domain types — aligned with Phase 2 backend schema

export type TripMode = "point_to_point" | "radius";
export type TripStatus = "draft" | "planned" | "completed";

export interface Trip {
  id: string;
  user_id: string;
  title: string;
  mode: TripMode;
  status: TripStatus;
  start_address: string;
  start_lat: number;
  start_lng: number;
  end_address: string | null;
  end_lat: number | null;
  end_lng: number | null;
  max_drive_minutes: number | null;
  notes: string | null;
  total_distance_meters: number | null;
  total_drive_seconds: number | null;
  route_polyline: string | null;
  share_token: string | null;
  is_public: boolean;
  start_date: string | null;
  cover_image_url: string | null;
  vehicle_mpg: number;
  fuel_price_per_unit: number;
  budget_total: number | null;
  currency: string;
  timezone: string;
  is_example: boolean;
  share_recap: boolean;
  in_progress: boolean;
  ended: boolean;
  my_role: TripRole;
  owner_name: string | null;
  member_count: number;
  version: number;
  created_at: string;
  updated_at: string;
  waypoints: Waypoint[];
}

export interface TripListItem {
  id: string;
  title: string;
  total_distance_meters: number | null;
  total_drive_seconds: number | null;
  cover_image_url: string | null;
  is_example?: boolean;
  role?: TripRole;
  owner_name?: string | null;
  route_thumb?: string | null;
  start_date: string | null;
  is_public: boolean;
  mode: TripMode;
  status: TripStatus;
  created_at: string;
  updated_at: string;
}

export interface Waypoint {
  id: string;
  trip_id: string;
  position: number;
  address: string;
  lat: number;
  lng: number;
  label: string | null;
  stop_duration_minutes: number | null;
  notes: string | null;
  drive_seconds_from_prev: number | null;
  distance_meters_from_prev: number | null;
  place_id: string | null;
  itinerary_day_id: string | null;
  scheduled_arrival_time: string | null;
  visited_at?: string | null;
  skipped?: boolean;
  created_at: string;
}

// Phase 5: Itinerary types
export interface ItineraryWaypoint {
  id: string;
  label: string | null;
  address: string;
  position: number;
  day_position: number | null;
  scheduled_arrival_time: string | null;
  drive_seconds_from_prev: number | null;
  stop_duration_minutes?: number | null;
  notes?: string | null;
  visited_at: string | null;
  skipped: boolean;
}

export interface ItineraryDay {
  id: string;
  trip_id: string;
  day_number: number;
  date: string | null;
  title: string | null;
  notes: string | null;
  waypoints: ItineraryWaypoint[];
}

export interface Itinerary {
  trip_id: string;
  days: ItineraryDay[];
  unscheduled_waypoints: ItineraryWaypoint[];
}

export interface ShareInfo {
  share_token: string;
  share_url: string;
  is_public: boolean;
}

export interface PublicTrip {
  id: string;
  title: string;
  mode: TripMode;
  start_address: string;
  start_lat: number;
  start_lng: number;
  end_address: string | null;
  end_lat: number | null;
  end_lng: number | null;
  total_distance_meters: number | null;
  total_drive_seconds: number | null;
  route_polyline: string | null;
  start_date: string | null;
  cover_image_url: string | null;
  units: "imperial" | "metric";
  waypoints: Waypoint[];
  days: ItineraryDay[];
  recap?: Recap | null;
}

export interface RouteLeg {
  from_waypoint_id: string | null;
  to_waypoint_id: string | null;
  distance_meters: number | null;
  drive_seconds: number | null;
}

export interface RouteData {
  trip_id: string;
  total_distance_meters: number | null;
  total_drive_seconds: number | null;
  route_polyline: string | null;
  legs: RouteLeg[];
}

export interface GeocodeResult {
  address: string;
  lat: number;
  lng: number;
  place_id: string | null;
}

export interface PaginatedTrips {
  items: TripListItem[];
  total: number;
  page: number;
  page_size: number;
}

// Phase 4: Radius mode types

export type SuggestionCategory = "park" | "restaurant" | "landmark" | "town" | "other";

export interface RadiusSuggestion {
  id: string;
  trip_id: string;
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: SuggestionCategory;
  drive_seconds_from_start: number;
  distance_meters_from_start: number;
  rating: number | null;
  user_ratings_total: number | null;
  // Backend-computed: rating weighted by log(review count) — see places.quality_score.
  // Suggestions are pre-sorted by this within each ~5-minute time bucket; exposed here
  // mainly so the UI can show "why" a place ranks where it does, not for re-sorting.
  quality_score: number;
  selected: boolean;
  created_at: string;
}

export interface RadiusDiscoverResponse {
  isochrone_geojson: GeoJSONPolygon | Record<string, never>;
  suggestions: RadiusSuggestion[];
  /** Set by POST /discover: served from the shared cache, and when the data was fetched. */
  cached?: boolean;
  updated_at?: string | null;
}

export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface RadiusSelectRequest {
  suggestion_ids: string[];
  generate_route: boolean;
}

// Phase 7: Corridor stops + radius itinerary builder

export interface CorridorSuggestion {
  id: string;
  trip_id: string;
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: SuggestionCategory;
  rating: number | null;
  user_ratings_total: number | null;
  // Backend-computed: rating weighted by log(review count) — see places.quality_score.
  quality_score: number;
  detour_seconds: number;
  route_fraction: number;
  selected: boolean;
  created_at: string;
}

export interface CorridorDiscoverResponse {
  suggestions: CorridorSuggestion[];
  max_detour_seconds: number;
  cached?: boolean;
  updated_at?: string | null;
}

export interface MyQuota {
  remaining: Record<string, number>;
  limits: Record<string, number>;
  resets_at: string;
}

export interface SkuUsage {
  sku: string;
  today: number;
  month: number;
  day_budget: number | null;
  month_budget: number | null;
  free_allowance: number | null;
  estimated_cost_usd: number;
}

export interface AdminUsage {
  month_start: string;
  skus: SkuUsage[];
  estimated_total_cost_usd: number;
}

export interface CorridorSelectRequest {
  suggestion_ids: string[];
  insert_as_waypoints: boolean;
}

export interface ItineraryBuildRequest {
  suggestion_ids: string[];
  stop_duration_minutes?: number;
}

export interface ItineraryBuildOut {
  trip_id: string;
  waypoints: Waypoint[];
  total_drive_seconds: number;
  total_stop_minutes: number;
  total_trip_minutes: number;
  budget_minutes: number;
  within_budget: boolean;
  over_under_minutes: number;
  dropped_suggestion_ids: string[];
}

// API response shapes

export interface HealthResponse {
  status: string;
  db: string;
}

// ── Phase 16: trip logistics ────────────────────────────────────────────────

export type ExpenseCategory = "fuel" | "lodging" | "food" | "activities" | "other";

export interface Expense {
  id: string;
  trip_id: string;
  itinerary_day_id: string | null;
  category: ExpenseCategory;
  amount: number;
  note: string | null;
  spent_on: string;
  created_at: string;
}

export interface Budget {
  currency: string;
  vehicle_mpg: number;
  fuel_price_per_unit: number;
  distance_miles: number;
  estimated_fuel: number;
  fuel_by_day: Record<string, number>;
  budget_total: number | null;
  spent_by_category: Record<ExpenseCategory, number>;
  spent_total: number;
  remaining: number | null;
}

/** Temperatures are Celsius; convert for display. */
export interface DayWeather {
  hi: number | null;
  lo: number | null;
  precip_pct: number | null;
  code: number | null;
  sunrise: string | null;
  sunset: string | null;
  after_dark: boolean;
}

export interface PackingItem {
  id: string;
  label: string;
  category: string;
  packed: boolean;
  position: number;
}

export interface PackingTemplate {
  name: string;
  item_count: number;
}

export interface PackingSuggestion {
  template: string;
  reason: string;
}

export interface NavLink {
  label: string;
  url: string;
}

export interface DayNavigation {
  google: NavLink[];
  apple: NavLink[];
}

export interface TripNavigation {
  trip: DayNavigation;
  days: Record<string, DayNavigation>;
}

// ── Phase 17: on the road & memories ────────────────────────────────────────

export interface TripPhoto {
  id: string;
  waypoint_id: string | null;
  itinerary_day_id: string | null;
  width: number;
  height: number;
  caption: string | null;
  taken_at: string | null;
  url: string;
}

export interface RecapStop {
  id: string;
  label: string | null;
  address: string;
  visited: boolean;
  skipped: boolean;
  visited_at: string | null;
  notes: string | null;
  photos: TripPhoto[];
}

export interface RecapDay {
  id: string;
  day_number: number;
  date: string | null;
  title: string | null;
  notes: string | null;
  stops: RecapStop[];
  photos: TripPhoto[];
}

export interface Recap {
  title: string;
  total_distance_meters: number | null;
  total_drive_seconds: number | null;
  days_count: number;
  stops_planned: number;
  stops_visited: number;
  stops_skipped: number;
  photo_count: number;
  spent_by_category: Record<string, number> | null;
  spent_total: number | null;
  currency: string | null;
  days: RecapDay[];
}

export interface MapTrip {
  id: string;
  title: string;
  year: number;
  route_polyline: string;
  total_distance_meters: number | null;
  stops_count: number;
  visited_stops: { lat: number; lng: number; label: string | null }[];
}

export interface MyMap {
  years: number[];
  stats: {
    trips: number;
    total_distance_meters: number;
    stops_visited: number;
    longest_trip_title: string | null;
    longest_trip_distance_meters: number | null;
  };
  trips: MapTrip[];
}

// ── Phase 19: collaboration ─────────────────────────────────────────────────

export type TripRole = "owner" | "editor" | "viewer";

export interface Member {
  user_id: string;
  name: string;
  role: TripRole;
  is_you: boolean;
  joined_at: string | null;
}

export interface Invite {
  id: string;
  role: "editor" | "viewer";
  expires_at: string;
  max_uses: number;
  uses: number;
}

export interface InviteCreated extends Invite {
  url: string;
  emailed: boolean;
}

export interface InvitePreview {
  valid: boolean;
  trip_title: string | null;
  owner_name: string | null;
  role: "editor" | "viewer" | null;
}

export type VoteKind = "radius" | "corridor" | "waypoint";

export interface VoteTally {
  up: number;
  down: number;
  mine: number;
  voters: { user_id: string; name: string; value: number }[];
}

export type CommentKind = "trip" | "day" | "waypoint";

export interface TripComment {
  id: string;
  user_id: string;
  author: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  mine: boolean;
}

export interface Activity {
  id: string;
  trip_id: string;
  kind: string;
  summary: string;
  created_at: string;
}

export interface Notifications {
  unread: number;
  items: (Activity & { trip_title: string })[];
}
