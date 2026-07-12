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
  created_at: string;
}

// Phase 5: Itinerary types
export interface ItineraryWaypoint {
  id: string;
  label: string | null;
  address: string;
  position: number;
  scheduled_arrival_time: string | null;
  drive_seconds_from_prev: number | null;
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
  waypoints: Waypoint[];
  days: ItineraryDay[];
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
  selected: boolean;
  created_at: string;
}

export interface RadiusDiscoverResponse {
  isochrone_geojson: GeoJSONPolygon | Record<string, never>;
  suggestions: RadiusSuggestion[];
}

export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface RadiusSelectRequest {
  suggestion_ids: string[];
  generate_route: boolean;
}

// API response shapes

export interface HealthResponse {
  status: string;
  db: string;
}
