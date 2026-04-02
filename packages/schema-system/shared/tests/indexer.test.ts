import { describe, expect, it } from 'vitest';

import { computeSectionIndex, ensureSections, extractByPath, patchByPath } from '../src/indexer';
import type { RouteSchema, SchemaNode, TemplateSchema } from '../src/types';

// Minimal template resembling weNativeApp structure
const mockTemplate: SchemaNode = {
  type: 'Row',
  props: { width: '100%', height: '100%' },
  children: [
    // [0] Left sidebar — navigation landmark
    {
      type: 'CollapsibleSidebar',
      props: { side: 'left' },
      children: [{ type: 'we-text', props: { text: 'Nav' } }],
    },
    // [1] Main column with routes
    {
      type: 'Column',
      props: { flex: 1 },
      children: [
        // [1,0] Header
        { type: 'we-text', props: { text: 'Header' } },
      ],
      routes: [
        // Route 0: home — large route with nested children
        {
          path: '/',
          type: 'Column',
          children: [
            // Small header
            { type: 'we-text', props: { text: 'Welcome' } },
            // Single-child wrapper (should be skipped)
            {
              type: 'Column',
              children: [
                // Large panel A (~big enough)
                {
                  type: 'StatsRow',
                  props: { data: 'x'.repeat(2000) },
                  children: [{ type: 'we-text', props: { text: 'Stats' } }],
                },
                // Large panel B
                {
                  type: 'ActivityFeed',
                  props: { data: 'y'.repeat(2000) },
                  children: [{ type: 'we-text', props: { text: 'Activity' } }],
                },
              ],
            },
          ],
        } as RouteSchema,
        // Route 1: small route
        {
          path: '/settings',
          type: 'Column',
          children: [{ type: 'we-text', props: { text: 'Settings' } }],
        } as RouteSchema,
      ],
    },
    // [2] Right sidebar — navigation landmark
    {
      type: 'CollapsibleSidebar',
      props: { side: 'right' },
      children: [{ type: 'we-text', props: { text: 'Chat' } }],
    },
  ],
};

describe('computeSectionIndex', () => {
  const sections = computeSectionIndex(mockTemplate);

  it('includes root section', () => {
    const root = sections.find((s) => s.key === 'root');
    expect(root).toBeDefined();
    expect(root!.type).toBe('root');
    expect(root!.path).toEqual([]);
  });

  it('detects navigation landmarks by CollapsibleSidebar type', () => {
    const navLeft = sections.find((s) => s.key === 'navigation:left');
    const navRight = sections.find((s) => s.key === 'navigation:right');
    expect(navLeft).toBeDefined();
    expect(navLeft!.path).toEqual([0]);
    expect(navRight).toBeDefined();
    expect(navRight!.path).toEqual([2]);
  });

  it('indexes routes by path', () => {
    const routeHome = sections.find((s) => s.key === 'route:/');
    const routeSettings = sections.find((s) => s.key === 'route:/settings');
    expect(routeHome).toBeDefined();
    expect(routeHome!.type).toBe('route');
    expect(routeSettings).toBeDefined();
    expect(routeSettings!.type).toBe('route');
  });

  it('uses -1 marker for routes in path', () => {
    const routeHome = sections.find((s) => s.key === 'route:/');
    // Routes are on children[1] → routes[-1, 0]
    expect(routeHome!.path).toEqual([1, -1, 0]);
  });

  it('indexes panels within large routes', () => {
    const panels = sections.filter((s) => s.type === 'panel');
    expect(panels.length).toBeGreaterThan(0);

    // Should find stats-row and activity-feed panels
    const statsPanel = panels.find((s) => s.key.includes('stats-row'));
    const activityPanel = panels.find((s) => s.key.includes('activity-feed'));
    expect(statsPanel).toBeDefined();
    expect(activityPanel).toBeDefined();
  });

  it('indexes sub-panels within wrapper containers', () => {
    // The wrapper Column inside route:/ has 2 children (StatsRow, ActivityFeed).
    // The wrapper itself may be indexed, but its children should ALSO be indexed as panels.
    const panels = sections.filter((s) => s.type === 'panel');
    const statsPanel = panels.find((s) => s.key.includes('stats-row'));
    const activityPanel = panels.find((s) => s.key.includes('activity-feed'));
    expect(statsPanel).toBeDefined();
    expect(activityPanel).toBeDefined();

    // The content nodes should be reachable via their paths
    const statsNode = extractByPath(mockTemplate, statsPanel!.path);
    expect(statsNode).not.toBeNull();
    expect(statsNode!.type).toBe('StatsRow');

    const activityNode = extractByPath(mockTemplate, activityPanel!.path);
    expect(activityNode).not.toBeNull();
    expect(activityNode!.type).toBe('ActivityFeed');
  });
});

describe('extractByPath', () => {
  it('extracts root with empty path', () => {
    const result = extractByPath(mockTemplate, []);
    expect(result).toBe(mockTemplate);
  });

  it('extracts a direct child', () => {
    const result = extractByPath(mockTemplate, [0]);
    expect(result!.type).toBe('CollapsibleSidebar');
    expect(result!.props!.side).toBe('left');
  });

  it('extracts a route via -1 marker', () => {
    const result = extractByPath(mockTemplate, [1, -1, 0]);
    expect(result).toBeDefined();
    expect((result as RouteSchema).path).toBe('/');
  });

  it('extracts nested children', () => {
    const result = extractByPath(mockTemplate, [1, 0]);
    expect(result!.type).toBe('we-text');
    expect(result!.props!.text).toBe('Header');
  });

  it('returns null for invalid path', () => {
    expect(extractByPath(mockTemplate, [99])).toBeNull();
    expect(extractByPath(mockTemplate, [1, -1, 99])).toBeNull();
  });
});

describe('patchByPath', () => {
  it('replaces root with empty path', () => {
    const replacement: SchemaNode = { type: 'Box' };
    const result = patchByPath(mockTemplate, [], replacement);
    expect(result).toEqual(replacement);
  });

  it('replaces a direct child without mutating original', () => {
    const replacement: SchemaNode = { type: 'NewSidebar', props: { side: 'left' } };
    const result = patchByPath(mockTemplate, [0], replacement);

    // Original unchanged
    expect(mockTemplate.children![0]).toHaveProperty('type', 'CollapsibleSidebar');

    // Result has replacement
    expect(result.children![0]).toEqual(replacement);
  });

  it('replaces a route via -1 marker', () => {
    const replacement: SchemaNode = { type: 'NewRoute', props: {} };
    const result = patchByPath(mockTemplate, [1, -1, 0], replacement as RouteSchema);

    // Original unchanged
    expect((mockTemplate.children![1] as SchemaNode).routes![0]).toHaveProperty('path', '/');

    // Result has replacement
    expect((result.children![1] as SchemaNode).routes![0]).toEqual(replacement);
  });

  it('throws on invalid path', () => {
    expect(() => patchByPath(mockTemplate, [99], { type: 'X' })).toThrow();
  });
});

describe('ensureSections', () => {
  it('returns StoredTemplate as-is when sections already present', () => {
    const stored = {
      schema: mockTemplate as TemplateSchema,
      sections: [{ key: 'root', type: 'root' as const, path: [], sizeEstimate: 100 }],
    };
    const result = ensureSections(stored);
    expect(result).toBe(stored); // same reference, not recomputed
  });

  it('bootstraps sections for a legacy TemplateSchema without sections', () => {
    const legacy = mockTemplate as TemplateSchema;
    const result = ensureSections(legacy);
    expect(result.schema).toBe(legacy);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections.find((s) => s.key === 'root')).toBeDefined();
  });

  it('bootstraps sections when blob has schema but missing sections array', () => {
    const malformed = { schema: mockTemplate as TemplateSchema } as any;
    const result = ensureSections(malformed);
    expect(result.sections.length).toBeGreaterThan(0);
  });
});
