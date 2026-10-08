export type LatLng = [lat: number, lng: number];

/** Decode a Google-encoded polyline (precision 5). */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Project points to SVG coordinates inside a `width` x `height` box with `pad` margin,
 * keeping the true aspect ratio (longitude is scaled by cos(latitude)).
 */
export function projectToBox(points: LatLng[], width: number, height: number, pad = 12) {
  if (points.length === 0) return [] as [number, number][];
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * kx, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return points.map(
    ([lat, lng]): [number, number] => [
      offX + (lng - minLng) * kx * scale,
      offY + (maxLat - lat) * scale,
    ]
  );
}

export function routeToPath(encoded: string, width: number, height: number, pad = 12) {
  const xy = projectToBox(decodePolyline(encoded), width, height, pad);
  if (xy.length === 0) return null;
  return {
    d: xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
    start: xy[0],
    end: xy[xy.length - 1],
  };
}
