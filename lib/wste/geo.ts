const EARTH_RADIUS_M = 6371000;

export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(a));
}

export function filterByRadius<T extends { lat: number; lng: number }>(
  points: T[],
  centerLat: number,
  centerLng: number,
  radiusM: number,
): T[] {
  return points.filter(
    (p) => haversineMeters(p.lat, p.lng, centerLat, centerLng) <= radiusM,
  );
}

export function nearestPoint<T extends { lat: number; lng: number }>(
  points: T[],
  centerLat: number,
  centerLng: number,
): { point: T; distanceM: number } | null {
  if (points.length === 0) return null;
  let nearest = points[0];
  let minDist = haversineMeters(points[0].lat, points[0].lng, centerLat, centerLng);
  for (let i = 1; i < points.length; i++) {
    const d = haversineMeters(points[i].lat, points[i].lng, centerLat, centerLng);
    if (d < minDist) { minDist = d; nearest = points[i]; }
  }
  return { point: nearest, distanceM: minDist };
}
