import { describe, expect, it } from 'vitest';

import type { StoredTemplate } from '../src/indexer';
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
    const malformed = { schema: mockTemplate as TemplateSchema } as unknown as StoredTemplate;
    const result = ensureSections(malformed);
    expect(result.sections.length).toBeGreaterThan(0);
  });
});

/*
  A node is addressable or it is invisible to the editor.

  Ids are how a patch names what it changes, so a node that never gets one is rendered, is seen
  by the model, and cannot be edited — which is not an error anywhere. It simply does not land.

  `meta.panels` was exactly that. A shell keeps whole interfaces there and compaction has always
  walked them, but `ensureNodeIds` did not: on `workshopTemplate` that left 1,127 of 1,807 nodes
  unaddressable, the Inspector panel's 870 among them. It surfaced as a model being handed a node
  and answering that it could not find an id for it.
*/
describe('ids reach every node the renderer does', () => {
  const panelled = (): SchemaNode =>
    ({
      type: 'Column',
      meta: {
        name: 'Shell',
        panels: [
          {
            id: 'inspector',
            snap: 'right',
            node: { type: 'Column', children: [{ type: 'we-text', children: ['Inside'] }] },
          },
          { id: 'from-a-module', module: 'transcribe' },
        ],
      },
      children: [{ type: 'we-text', children: ['Outside'] }],
    }) as unknown as SchemaNode;

  const panelNode = (schema: SchemaNode) =>
    (schema as unknown as { meta: { panels: { node?: SchemaNode }[] } }).meta.panels[0].node!;

  it('gives a node inside meta.panels an id, like any other', async () => {
    const { ensureNodeIds } = await import('../src/indexer');
    const panel = panelNode(ensureNodeIds(panelled()));

    expect(panel.id).toBeDefined();
    expect((panel.children as SchemaNode[])[0].id).toBeDefined();
  });

  it('finds that node by its id, so a patch can land on it', async () => {
    const { ensureNodeIds, findNodeById } = await import('../src/indexer');
    const schema = ensureNodeIds(panelled());
    const inner = (panelNode(schema).children as SchemaNode[])[0];

    expect(findNodeById(schema, inner.id!)?.node).toBe(inner);
  });

  /*
    The other half, and the one that would bite silently: ids are transient and `stripNodeIds`
    is what keeps them out of the stored template. Numbering panels without stripping them would
    write `n12` into every panel of every template anybody saved.
  */
  it('strips them again, panels included', async () => {
    const { ensureNodeIds, stripNodeIds } = await import('../src/indexer');
    const schema = stripNodeIds(ensureNodeIds(panelled()));
    const panel = panelNode(schema);

    expect(panel.id).toBeUndefined();
    expect((panel.children as SchemaNode[])[0].id).toBeUndefined();
    expect(JSON.stringify(schema)).not.toMatch(/"id":"n\d+"/);
  });

  it('leaves a panel entry that carries no node alone', async () => {
    const { ensureNodeIds } = await import('../src/indexer');
    const panels = (ensureNodeIds(panelled()) as unknown as { meta: { panels: Record<string, unknown>[] } }).meta
      .panels;

    expect(panels[1]).toEqual({ id: 'from-a-module', module: 'transcribe' });
  });
});
