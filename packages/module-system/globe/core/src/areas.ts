/**
 * Areas: GeoJSON shapes, and the set of countries rows can name instead of drawing.
 */
import type { LonLat } from './geo';
import { isLonLat } from './geo';

/** One polygon: an outer ring, then any holes. */
export type Polygon = LonLat[][];

/** A GeoJSON Polygon or MultiPolygon as a list of polygons, with any position that is not a place dropped. */
export function polygonsOf(geometry: unknown): Polygon[] {
  if (!geometry || typeof geometry !== 'object') return [];
  const { type, coordinates } = geometry as { type?: string; coordinates?: unknown };
  const ring = (positions: unknown): LonLat[] =>
    Array.isArray(positions)
      ? positions
          .filter((p): p is [number, number] => Array.isArray(p) && isLonLat(p[0], p[1]))
          .map((p) => [p[0], p[1]] as const)
      : [];
  const polygon = (rings: unknown): Polygon =>
    Array.isArray(rings) ? rings.map(ring).filter((r) => r.length >= 3) : [];
  if (type === 'Polygon') return [polygon(coordinates)].filter((p) => p.length);
  if (type === 'MultiPolygon' && Array.isArray(coordinates)) return coordinates.map(polygon).filter((p) => p.length);
  return [];
}

export interface NamedArea {
  name: string;
  polygons: Polygon[];
}

/** An area set, indexed by each of the names a row may use for an area, lower-cased. */
export type AreaIndex = Map<string, NamedArea>;

/** Index a FeatureCollection by `name`, `iso_a2` and `iso_a3`, whichever each feature carries. */
export function indexAreas(collection: unknown): AreaIndex {
  const index: AreaIndex = new Map();
  const features = (collection as { features?: unknown[] } | undefined)?.features;
  if (!Array.isArray(features)) return index;
  for (const feature of features) {
    const { properties, geometry } = (feature ?? {}) as { properties?: Record<string, unknown>; geometry?: unknown };
    const polygons = polygonsOf(geometry);
    if (!polygons.length) continue;
    const name = typeof properties?.name === 'string' ? properties.name : '';
    const area: NamedArea = { name, polygons };
    for (const property of ['name', 'iso_a2', 'iso_a3']) {
      const value = properties?.[property];
      if (typeof value === 'string' && value) index.set(`${property}:${value.toLowerCase()}`, area);
    }
  }
  return index;
}

/** The area a row's key names, by the property the layer matches on. */
export function findArea(index: AreaIndex, match: string, key: string): NamedArea | undefined {
  return index.get(`${match}:${key.trim().toLowerCase()}`);
}

/**
 * A URL a layer may fetch, or undefined. Layer options come from the template, and a layer that
 * fetched whatever an option said could be made to send what the template read to anywhere — and the
 * Content-Security-Policy cannot stop that, because `connect-src` must allow any https host for the
 * node. So: the app's own origin only.
 */
export function permittedDataUrl(url: string | undefined, pageOrigin: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, pageOrigin).origin === new URL(pageOrigin).origin ? url : undefined;
  } catch {
    return undefined;
  }
}

const loaded = new Map<string, Promise<AreaIndex>>();

/** An area set fetched once per URL and shared by every layer that names it. A failed fetch is retried next time. */
export function loadAreas(url: string): Promise<AreaIndex> {
  let pending = loaded.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${url} answered ${response.status}`);
        return response.json();
      })
      .then(indexAreas);
    pending.catch(() => loaded.delete(url));
    loaded.set(url, pending);
  }
  return pending;
}
