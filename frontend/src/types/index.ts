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
  created_at: string;
  updated_at: string;
  waypoints: Waypoint[];
}

export interface TripListItem {
  id: string;
  title: string;
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
  created_at: string;
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

// API response shapes

export interface HealthResponse {
  status: string;
  db: string;
}
