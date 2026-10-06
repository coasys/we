/** Geometry on the sphere that both engines need and neither should work out twice. */

/** Mean earth radius in metres. */
export const EARTH_RADIUS = 6_371_008.8;

/** [longitude, latitude] in degrees, the order GeoJSON and both engines use. */
export type LonLat = readonly [number, number];

/** [longitude, latitude, height in metres]. */
export type LonLatHeight = readonly [number, number, number];

const RAD = Math.PI / 180;

/** Whether two numbers are a place on the earth. */
export function isLonLat(longitude: unknown, latitude: unknown): boolean {
  return (
    typeof longitude === 'number' &&
    typeof latitude === 'number' &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

/** Great-circle distance in metres. */
export function distance(a: LonLat, b: LonLat): number {
  const [lon1, lat1] = [a[0] * RAD, a[1] * RAD];
  const [lon2, lat2] = [b[0] * RAD, b[1] * RAD];
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Points along the great circle from `a` to `b`, raised into an arc whose middle is `share` of the
 * line's length above the ground. A share of 0 gives the line on the surface.
 */
export function arcPositions(a: LonLat, b: LonLat, share: number, segments = 48): LonLatHeight[] {
  const length = distance(a, b);
  const peak = Math.max(0, share) * length;
  const angle = length / EARTH_RADIUS;
  const [lon1, lat1, lon2, lat2] = [a[0] * RAD, a[1] * RAD, b[0] * RAD, b[1] * RAD];
  const steps = angle === 0 ? 1 : segments;
  const out: LonLatHeight[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let lon = lon1;
    let lat = lat1;
    if (angle > 0) {
      // Spherical interpolation, so a long line follows the earth's curve rather than cutting through it.
      const f1 = Math.sin((1 - t) * angle) / Math.sin(angle);
      const f2 = Math.sin(t * angle) / Math.sin(angle);
      const x = f1 * Math.cos(lat1) * Math.cos(lon1) + f2 * Math.cos(lat2) * Math.cos(lon2);
      const y = f1 * Math.cos(lat1) * Math.sin(lon1) + f2 * Math.cos(lat2) * Math.sin(lon2);
      const z = f1 * Math.sin(lat1) + f2 * Math.sin(lat2);
      lat = Math.atan2(z, Math.sqrt(x * x + y * y));
      lon = Math.atan2(y, x);
    }
    // A parabola: zero at both ends, `peak` in the middle.
    out.push([lon / RAD, lat / RAD, 4 * peak * t * (1 - t)]);
  }
  return out;
}
