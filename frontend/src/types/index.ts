// Trip domain types — shared across components and API responses

export type TripMode = "point-to-point" | "radius";
export type TripStatus = "draft" | "planned" | "completed";

export interface Trip {
  id: string;
  title: string;
  mode: TripMode;
  status: TripStatus;
  coverImage?: string;
  distanceMi?: number;
  driveTimeMin?: number;
  stopCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Waypoint {
  id: string;
  tripId: string;
  label: string;
  lat: number;
  lng: number;
  order: number;
  notes?: string;
}

// API response shapes

export interface HealthResponse {
  status: string;
  db: string;
}
