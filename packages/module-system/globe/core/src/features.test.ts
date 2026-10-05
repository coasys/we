/**
 * Rows to features with no engine: where a kind reads its geometry, how its style rules resolve, and
 * what it groups. Everything an engine's renderer would otherwise have to get right twice.
 */
import { describe, expect, it, vi } from 'vitest';

import { indexAreas } from './areas';
import { clusterCellDegrees, clusterPoints } from './cluster';
import { FeatureDiffer } from './diff';
import { areaFeatures, hexFeatures, pathFeatures, pointFeatures } from './features';
import { arcPositions, distance } from './geo';
import { flattenRow, readNumber } from './rows';

const members = [
  { id: 'a', name: 'Ann', role: 'admin', posts: 10, location: { latitude: 51.5, longitude: -0.12, country: 'GB' } },
  { id: 'b', name: 'Bo', role: 'member', posts: 0, location: { latitude: 48.85, longitude: 2.35, country: 'FR' } },
  { id: 'c', name: 'Cy', role: 'member', posts: 5, location: { latitude: 48.86, longitude: 2.34, country: 'fr' } },
  { id: 'd', name: 'Di', role: 'member', posts: 3 },
];

describe('rows', () => {
  it('reads dotted paths, and numbers stored as text', () => {
    expect(readNumber({ a: { b: '4.5' } }, 'a.b')).toBe(4.5);
    expect(readNumber({ a: { b: '' } }, 'a.b')).toBeUndefined();
  });

  it('flattens a row two levels deep by dotted key', () => {
    expect(flattenRow(members[0])).toMatchObject({ name: 'Ann', 'location.country': 'GB' });
  });
});

describe('points', () => {
  const base = { data: members, latitude: 'location.latitude', longitude: 'location.longitude' };

  it('places the rows that have a place, and leaves out the rest', () => {
    const features = pointFeatures(base);
    expect(features.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(features[0]).toMatchObject({ position: [-0.12, 51.5], label: 'Ann', color: 'primary-500', size: 12 });
  });

  it('applies rules in the graph dialect: a when clause, a field metric, a field ref', () => {
    const features = pointFeatures({
      ...base,
      style: [
        { style: { color: 'accent' } },
        { when: { 'data.role': 'admin' }, style: { color: 'warning-500', image: { from: 'data.name' } } },
        { style: { size: { metric: 'field', options: { from: 'posts' }, range: [8, 28] } } },
      ],
    });
    const byId = Object.fromEntries(features.map((f) => [f.id, f]));
    expect(byId.a).toMatchObject({ color: 'warning-500', size: 28, image: 'Ann' });
    expect(byId.b).toMatchObject({ color: 'accent', size: 8 });
    expect(byId.c.size).toBe(8 + (5 / 10) * 20);
  });

  it('reads nested fields in a rule by their dotted name', () => {
    const features = pointFeatures({
      ...base,
      style: [{ when: { 'data.location.country': 'FR' }, style: { color: 'danger-500' } }],
    });
    expect(features.find((f) => f.id === 'b')?.color).toBe('danger-500');
  });

  it('keeps the first of two rows sharing an id, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const features = pointFeatures({
      data: [
        { id: 'x', latitude: 1, longitude: 1 },
        { id: 'x', latitude: 2, longitude: 2 },
      ],
    });
    expect(features).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('paths', () => {
  const routes = [
    { id: 'r1', from: { latitude: 51.5, longitude: -0.12 }, to: { latitude: 40.71, longitude: -74 } },
    { id: 'r2', from: { latitude: 51.5, longitude: -0.12 }, to: { latitude: 48.85, longitude: 2.35 } },
  ];

  it('reads from and to, and gives a rule the length to read', () => {
    const features = pathFeatures({
      data: routes,
      style: [{ when: { 'data.length': { gt: 1000 } }, style: { arcHeight: 0.3, color: 'accent' } }],
    });
    expect(features.map((f) => [f.id, f.arcHeight, f.color])).toEqual([
      ['r1', 0.3, 'accent'],
      ['r2', 0, 'primary-500'],
    ]);
  });

  it('takes a whole line from one field', () => {
    const [feature] = pathFeatures({
      data: [
        {
          id: 'l',
          line: [
            [0, 0],
            [1, 1],
            [2, 0],
          ],
        },
      ],
      coordinates: 'line',
    });
    expect(feature.positions).toHaveLength(3);
  });

  it('raises an arc by a share of its length, and lands at both ends', () => {
    const a = [-0.12, 51.5] as const;
    const b = [-74, 40.71] as const;
    const arc = arcPositions(a, b, 0.25, 10);
    expect(arc[0][2]).toBe(0);
    expect(arc[10][2]).toBeCloseTo(0);
    expect(arc[5][2]).toBeCloseTo(0.25 * distance(a, b));
    expect(arc[10][0]).toBeCloseTo(-74);
  });
});

describe('areas', () => {
  const countries = indexAreas({
    type: 'FeatureCollection',
    features: [
      {
        properties: { name: 'France', iso_a2: 'FR', iso_a3: 'FRA' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 45],
              [5, 45],
              [5, 50],
              [0, 45],
            ],
          ],
        },
      },
      {
        properties: { name: 'United Kingdom', iso_a2: 'GB' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [-5, 50],
                [0, 50],
                [0, 55],
                [-5, 50],
              ],
            ],
          ],
        },
      },
    ],
  });

  it('groups rows into the countries they name, whatever the case, and counts them', () => {
    const features = areaFeatures({ data: members, area: 'countries', key: 'location.country' }, countries);
    const byName = Object.fromEntries(features.map((f) => [f.subject.label, f]));
    expect(byName.France.subject.data).toMatchObject({ count: 2, value: 2 });
    expect(byName['United Kingdom'].subject.data).toMatchObject({ count: 1, role: 'admin', name: 'United Kingdom' });
    // Shaded by count, cool to hot, when no rules are given.
    expect(byName.France.color).toBe('primary-900');
  });

  it('sums a field instead of counting', () => {
    const features = areaFeatures(
      { data: members, area: 'countries', key: 'location.country', aggregate: 'sum', value: 'posts' },
      countries,
    );
    expect(features.find((f) => f.subject.label === 'France')?.subject.data?.value).toBe(5);
  });

  it('draws a row from its own GeoJSON', () => {
    const [feature] = areaFeatures({
      data: [
        {
          id: 'mine',
          shape: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        },
      ],
      geometry: 'shape',
      style: [{ style: { height: 5000 } }],
    });
    expect(feature).toMatchObject({ id: 'mine', height: 5000 });
    expect(feature.polygons[0][0]).toHaveLength(4);
  });
});

describe('hexbins', () => {
  it('bins rows by cell, and passes what is in each cell on', () => {
    const features = hexFeatures({
      data: members,
      latitude: 'location.latitude',
      longitude: 'location.longitude',
      resolution: 4,
    });
    expect(features).toHaveLength(2);
    const paris = features.find((f) => f.group.count === 2)!;
    expect(paris.group.rows.map((r) => r.id)).toEqual(['b', 'c']);
    expect(paris.boundary.length).toBeGreaterThanOrEqual(6);
    expect(paris.color).toBe('primary-900');
  });

  it('raises a cell by a rule reading its value', () => {
    const features = hexFeatures({
      data: members,
      latitude: 'location.latitude',
      longitude: 'location.longitude',
      style: [{ style: { height: { metric: 'field', options: { from: 'value' }, range: [0, 10000] } } }],
    });
    expect(features.map((f) => f.height).sort((a, b) => a - b)).toEqual([0, 10000]);
  });
});

describe('cells', () => {
  it('draws a cell across the antimeridian without wrapping round the earth', async () => {
    const { cellShape } = await import('./aggregate');
    const { latLngToCell } = await import('h3-js');
    const { boundary } = cellShape(latLngToCell(0, 179.99, 3));
    const longitudes = boundary.map(([x]) => x);
    expect(Math.max(...longitudes) - Math.min(...longitudes)).toBeLessThan(10);
  });
});

describe('clustering', () => {
  const points = [
    { id: 'p', position: [2.35, 48.85] as const },
    { id: 'q', position: [2.36, 48.86] as const },
    { id: 'r', position: [-74, 40.71] as const },
  ];

  it('joins points within a cell, and leaves them apart close in', () => {
    const far = clusterPoints(points, clusterCellDegrees(60, 5000));
    expect(far.map((c) => c.members.length).sort()).toEqual([1, 2]);
    expect(far.find((c) => c.members.length === 2)?.id).toBe('cluster:p');
    expect(clusterPoints(points, 0)).toHaveLength(3);
  });
});

describe('diffing', () => {
  it('reports what changed by id, and ignores rows that are new objects drawing the same', () => {
    const differ = new FeatureDiffer<ReturnType<typeof pointFeatures>[number]>();
    const first = differ.diff(pointFeatures({ data: members }));
    expect(first.added).toHaveLength(0);
    const rows = members.map((m) => ({ ...m, ...m.location }));
    expect(differ.diff(pointFeatures({ data: rows })).added).toHaveLength(3);
    const again = differ.diff(pointFeatures({ data: rows.map((r) => ({ ...r })) }));
    expect(again).toMatchObject({ added: [], changed: [], removed: [], unchanged: 3 });
    const recoloured = differ.diff(
      pointFeatures({ data: rows.slice(1), style: [{ when: { id: 'b' }, style: { color: 'accent' } }] }),
    );
    expect(recoloured.changed.map((f) => f.id)).toEqual(['b']);
    expect(recoloured.removed).toEqual(['a']);
  });
});
