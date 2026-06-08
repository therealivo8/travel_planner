"use client";

import React, { useEffect } from "react";
import {
  Map,
  AdvancedMarker,
  Pin,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import type { Waypoint } from "@/types";

interface Props {
  startLat: number;
  startLng: number;
  startAddress: string;
  endLat: number | null;
  endLng: number | null;
  endAddress: string | null;
  waypoints: Waypoint[];
  routePolyline: string | null;
  layers?: React.ReactNode;
}

function RoutePolyline({ encodedPolyline }: { encodedPolyline: string }) {
  const map = useMap();
  const geometryLib = useMapsLibrary("geometry");

  useEffect(() => {
    if (!map || !geometryLib || !encodedPolyline) return;

    const path = geometryLib.encoding.decodePath(encodedPolyline);
    const line = new google.maps.Polyline({
      path,
      strokeColor: "#2563EB",
      strokeWeight: 4,
      strokeOpacity: 0.8,
      map,
    });

    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });

    return () => {
      line.setMap(null);
    };
  }, [map, geometryLib, encodedPolyline]);

  return null;
}

export function TripMap({
  startLat,
  startLng,
  startAddress,
  endLat,
  endLng,
  endAddress,
  waypoints,
  routePolyline,
  layers,
}: Props) {
  const defaultCenter = { lat: startLat, lng: startLng };

  return (
    <Map
      defaultCenter={defaultCenter}
      defaultZoom={6}
      mapId="trip-map"
      gestureHandling="greedy"
      disableDefaultUI={false}
      style={{ width: "100%", height: "100%" }}
    >
      {/* Start marker */}
      <AdvancedMarker position={{ lat: startLat, lng: startLng }} title={startAddress}>
        <Pin background="#16A34A" borderColor="#15803D" glyphColor="white" glyph="S" />
      </AdvancedMarker>

      {/* End marker */}
      {endLat != null && endLng != null && (
        <AdvancedMarker
          position={{ lat: endLat, lng: endLng }}
          title={endAddress ?? "Destination"}
        >
          <Pin background="#DC2626" borderColor="#B91C1C" glyphColor="white" glyph="E" />
        </AdvancedMarker>
      )}

      {/* Waypoint markers */}
      {waypoints.map((wp, i) => (
        <AdvancedMarker
          key={wp.id}
          position={{ lat: wp.lat, lng: wp.lng }}
          title={wp.label ?? wp.address}
        >
          <Pin
            background="#2563EB"
            borderColor="#1D4ED8"
            glyphColor="white"
            glyph={String(i + 1)}
          />
        </AdvancedMarker>
      ))}

      {/* Route polyline */}
      {routePolyline && <RoutePolyline encodedPolyline={routePolyline} />}

      {/* Optional overlay layers (e.g. IsochroneLayer) */}
      {layers}
    </Map>
  );
}
