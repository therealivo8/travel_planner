/** Google Maps directions from wherever the user is *now* to one stop (no origin = current
 * location). Free deep link, no API key or billing. */
export function navigateTo(stop: { lat: number; lng: number; place_id?: string | null }): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${stop.lat},${stop.lng}`,
    travelmode: "driving",
  });
  if (stop.place_id) params.set("destination_place_id", stop.place_id);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
