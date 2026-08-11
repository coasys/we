/**
 * Ready-made graphs, as schema fragments.
 *
 * These are the module's most important export, and not because they save typing. An LLM asked to
 * "make me a knowledge map" composes far better from one working example than from a list of props —
 * and the same is true of a person opening the editor for the first time. Each of these is a complete,
 * placeable graph that does something on real data, and each demonstrates a different axis of the
 * spec, so between them they teach the whole surface.
 *
 * They are also deliberately small. A fragment that configured everything would be a thing to modify
 * rather than a thing to read.
 *
 * These are *module-provided* fragments — the scope `docs/architecture/template-fragments.md` names
 * alongside the kit's own — and they follow `packages/templates/kit/CONVENTIONS.md`: a single
 * options object where anything varies, bodies that read as the tree they emit, and a doc comment
 * saying why each exists.
 */
import type { SchemaNode } from '@we/schema-shared';

/**
 * A map of the space's own vocabulary: one node per entity type, edges for declared relations.
 *
 * The answer to a space whose model set is open-ended — interpretation installs classes as data, so
 * what a community talks about is not knowable when a template is written. This picks up whatever is
 * there, including classes added after the template was authored.
 */
export const schemaMap: SchemaNode = {
  type: 'GraphView',
  props: {
    seeds: { source: 'schema' },
    layout: { type: 'force', options: { distance: 140 } },
    expansion: { defaultDepth: 0 },
    nodeStyle: [
      { style: { size: 20, color: 'primary-500', shape: 'rect' } },
      { when: { 'data.relations': { gt: 3 } }, style: { size: 28, color: 'primary-700' } },
    ],
    edgeStyle: [{ style: { showLabel: true, curve: 'arc' } }],
    height: '100%',
  },
};

/**
 * A knowledge map over one entity type, one hop deep.
 *
 * The default shape for "show me what is in here and how it connects". `defaultDepth: 1` is the
 * judgement call: zero shows disconnected dots and tells you nothing about structure, two opens far
 * enough that the first paint is already a hairball on any real dataset.
 */
export interface KnowledgeMapOptions {
  /** The entity type the map is seeded from and highlights. */
  entity: string;
}

export const knowledgeMap = (opts: KnowledgeMapOptions): SchemaNode => ({
  type: 'GraphView',
  props: {
    seeds: { source: 'query', options: { entity: opts.entity, limit: 60 } },
    expansion: { defaultDepth: 1, direction: 'both', limit: 25, maxNodes: 600 },
    layout: { type: 'force' },
    nodeStyle: [
      { style: { size: 14, color: 'neutral-400' } },
      { when: { type: opts.entity }, style: { size: 20, color: 'primary-500' } },
      { when: { unresolved: true }, style: { color: 'neutral-200' } },
    ],
    edgeStyle: [{ style: { curve: 'arc', arrow: 'target' } }],
    behaviours: ['pan-zoom', 'select', 'expand-on-double-click', { type: 'drag-node' }],
    height: '100%',
  },
});

/**
 * Content of the current space as a hierarchy, drilling into nested collections.
 *
 * A tree layout rather than force, because containment *is* a hierarchy and a force simulation over
 * one produces a worse drawing than arithmetic does. Deliberately shows how the collection expander
 * recurses: a collection inside a collection is the same rule applied again.
 */
export const contentTree: SchemaNode = {
  type: 'GraphView',
  props: {
    seeds: { source: 'query', options: { entity: 'CollectionBlock', limit: 40 } },
    expansion: { defaultDepth: 1, direction: 'out', expanders: ['collection'], maxNodes: 400 },
    layout: { type: 'tree', options: { direction: 'right', levelGap: 200 } },
    nodeStyle: [
      { style: { size: 12, color: 'neutral-400', shape: 'rect' } },
      { when: { type: 'CollectionBlock' }, style: { size: 18, color: 'primary-500' } },
      { when: { 'data.kind': 'call' }, style: { color: 'success-500', icon: 'phone' } },
    ],
    edgeStyle: [{ style: { curve: 'step', arrow: 'target', color: 'neutral-200' } }],
    height: '100%',
  },
};

/**
 * A static diagram — no data layer, no exploration.
 *
 * Included as a fragment because it is the shape an LLM should reach for when asked for a flowchart
 * or an org chart, and the risk otherwise is that it configures an expansion policy to draw six boxes.
 */
export const staticDiagram: SchemaNode = {
  type: 'GraphView',
  props: {
    seeds: {
      literal: true,
      nodes: [
        { id: 'a', kind: 'resource', type: 'step', label: 'Draft' },
        { id: 'b', kind: 'resource', type: 'step', label: 'Review' },
        { id: 'c', kind: 'resource', type: 'step', label: 'Publish' },
      ],
      edges: [
        { id: 'a-b', source: 'a', target: 'b', type: 'next' },
        { id: 'b-c', source: 'b', target: 'c', type: 'next' },
      ],
    },
    layout: { type: 'tree', options: { direction: 'right' } },
    nodeStyle: [{ style: { shape: 'rect', size: 22, color: 'primary-500' } }],
    behaviours: ['pan-zoom', 'select'],
    height: '100%',
  },
};
