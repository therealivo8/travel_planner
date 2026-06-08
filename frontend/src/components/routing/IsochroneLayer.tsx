"use client";

import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { GeoJSONPolygon } from "@/types";

interface Props {
  geojson: GeoJSONPolygon;
}

export function IsochroneLayer({ geojson }: Props) {
  const map = useMap();

  useEffect(() => {
    if (!map || !geojson?.coordinates?.length) return;

    // ORS returns [lng, lat] — Google Maps wants {lat, lng}
    const path = geojson.coordinates[0].map(([lng, lat]) => ({ lat, lng }));

    const polygon = new google.maps.Polygon({
      paths: path,
      strokeColor: "#7C3AED",
      strokeWeight: 2,
      strokeOpacity: 0.8,
      fillColor: "#7C3AED",
      fillOpacity: 0.1,
      map,
    });

    // Fit the map to show the full isochrone
    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });

    return () => {
      polygon.setMap(null);
    };
  }, [map, geojson]);

  return null;
}
