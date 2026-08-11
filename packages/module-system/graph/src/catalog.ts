/**
 * What a template may name inside a `GraphView`.
 *
 * This file is the reason the plugin system is usable rather than merely well-designed. Props tell an
 * author that `layout.type` is a string; nothing in a prop list says which strings exist, and a plugin
 * nobody can name might as well not be registered. The globe is the cautionary case — its layer
 * protocol is good, and an LLM still cannot author a globe template, because no catalog of layer names
 * ever reaches the generated context.
 *
 * So the catalog is declared here and picked up by `@we/ai-context` (`context: { type: 'plugins' }` in
 * this package's `package.json`), landing in CLAUDE.md alongside the component registry. A module
 * contributing its own expander adds to its own catalog and is documented the same way — which is what
 * makes "describe the graph you want" keep working for plugins that did not exist when the engine was
 * written.
 *
 * Keep the examples runnable. An author — human or otherwise — composes from a worked snippet far
 * better than from an option table, and a stale example is worse than none.
 */
import type { PluginCatalog } from '@we/schema-shared';

export const GRAPH_PLUGIN_CATALOG: PluginCatalog = {
  component: 'GraphView',
  description:
    'Names resolvable inside GraphView props: seed sources (seeds.source), expanders (expansion.expanders), layouts (layout.type) and behaviours (behaviours[]).',
  plugins: [
    // ─── Seed sources ──────────────────────────────────────────────────────────
    {
      id: 'query',
      category: 'seed',
      description: 'Loads instances of one entity type as nodes; can draw named relations immediately.',
      options: [
        { name: 'entity', type: 'string', description: 'Entity type to load (required).' },
        { name: 'where', type: 'object', description: 'Filter, same operators as $query.' },
        { name: 'order', type: 'object', description: 'e.g. { createdAt: "desc" }.' },
        { name: 'limit', type: 'number', description: 'Defaults to 100.' },
        { name: 'relations', type: 'string[]', description: 'Relations to hydrate and draw as edges up front.' },
      ],
      example: `{ "source": "query", "options": { "entity": "Post", "limit": 50, "relations": ["author"] } }`,
    },
    {
      id: 'schema',
      category: 'seed',
      description:
        "Maps the dataset's own entity types and the relations between them — one node per type. Picks up model types installed after the template was written, so it suits spaces whose vocabulary is open-ended.",
      options: [{ name: 'entities', type: 'string[]', description: 'Restrict to these types; omit for all of them.' }],
      example: `{ "source": "schema" }`,
    },
    {
      id: 'dataset',
      category: 'seed',
      description: 'Seeds a single node for the current space — the starting point for exploring outward.',
      options: [{ name: 'label', type: 'string' }],
      example: `{ "source": "dataset", "options": { "label": "This space" } }`,
    },

    // ─── Expanders ─────────────────────────────────────────────────────────────
    {
      id: 'entity',
      category: 'expander',
      description:
        "Follows an entity's typed relations, forwards and backwards, from the dataset's schema. The default for knowledge maps.",
      options: [
        { name: 'relations', type: 'string[]', description: 'Only follow these.' },
        { name: 'exclude', type: 'string[]', description: 'Never follow these.' },
      ],
      example: `"expansion": { "expanders": ["entity"], "direction": "both", "defaultDepth": 1 }`,
    },
    {
      id: 'collection',
      category: 'expander',
      description:
        'Opens a container into its children through an untyped to-many relation — the drill-down the schema cannot describe. Recurses naturally into nested collections.',
      options: [
        { name: 'parents', type: 'string[]', description: 'Container types. Defaults to CollectionBlock.' },
        { name: 'via', type: 'string', description: 'Relation holding the children. Defaults to "children".' },
        { name: 'children', type: 'string[]', description: 'Child entity types to look for.' },
      ],
      example: `"expansion": { "expanders": ["collection"], "defaultDepth": 2, "direction": "out" }`,
    },
    {
      id: 'schema',
      category: 'expander',
      description:
        'Opens an entity-type node from the schema seed into instances of that type — the step from "what kinds of thing are here" to "here they are". Paired with the schema seed it makes one map out of two.',
      options: [{ name: 'limit', type: 'number', description: 'Instances loaded per type. Default 25.' }],
      example: `"seeds": { "source": "schema" }, "expansion": { "expanders": ["schema", "entity"] }`,
    },
    {
      id: 'property',
      category: 'expander',
      description:
        'Opens an instance out into its own scalar fields, and optionally into shared value nodes so instances converge on common values. The resolution level below an entity.',
      options: [
        { name: 'properties', type: 'string[]', description: 'Only show these fields.' },
        { name: 'valueNodes', type: 'boolean', description: 'Promote values to shared nodes. Defaults to true.' },
      ],
      example: `"expansion": { "expanders": ["property"] }`,
    },

    // ─── Layouts ───────────────────────────────────────────────────────────────
    {
      id: 'force',
      category: 'layout',
      description:
        'Force-directed, with warm start so newly expanded nodes settle around what is already placed rather than restarting the whole map. The default.',
      options: [
        { name: 'distance', type: 'number', description: 'Preferred edge length. Default 90.' },
        { name: 'charge', type: 'number', description: 'Repulsion; more negative spreads further. Default -220.' },
        { name: 'collide', type: 'number', description: 'Minimum spacing. Default 28.' },
      ],
      example: `{ "type": "force", "options": { "distance": 140 } }`,
    },
    {
      id: 'tree',
      category: 'layout',
      description: 'Layered hierarchy from the graph roots. The right choice for containment and org charts.',
      options: [
        { name: 'direction', type: '"down" | "right"' },
        { name: 'levelGap', type: 'number' },
        { name: 'siblingGap', type: 'number' },
      ],
      example: `{ "type": "tree", "options": { "direction": "right", "levelGap": 200 } }`,
    },
    {
      id: 'radial',
      category: 'layout',
      description: 'Concentric rings by hop distance from the roots — reads as distance from a centre.',
      options: [{ name: 'ringGap', type: 'number' }],
      example: `{ "type": "radial" }`,
    },
    {
      id: 'grid',
      category: 'layout',
      description: 'Uniform grid, optionally ordered by a node data field. Honest default when edges say little.',
      options: [
        { name: 'columns', type: 'number' },
        { name: 'sortBy', type: 'string', description: 'Node data field to order by.' },
      ],
      example: `{ "type": "grid", "options": { "columns": 6, "sortBy": "name" } }`,
    },
    {
      id: 'manual',
      category: 'layout',
      description:
        'Positions come from the nodes themselves — a board, where position is the data being edited rather than something derived. Pair with drag-node and persist via onNodeDragEnd.',
      options: [
        { name: 'xField', type: 'string', description: 'Node data field holding x. Default "x".' },
        { name: 'yField', type: 'string', description: 'Node data field holding y. Default "y".' },
      ],
      example: `{ "type": "manual" }`,
    },

    // ─── Metrics ───────────────────────────────────────────────────────────────
    {
      id: 'degree',
      category: 'metric',
      description:
        'How connected a node is, normalised 0..1. The usual answer to "make the important things bigger". Reference it from a style value rather than a fixed number.',
      options: [{ name: 'range', type: '[number, number]', description: 'Output range, e.g. [8, 30].' }],
      example: `"nodeStyle": [{ "style": { "size": { "metric": "degree", "range": [10, 34] } } }]`,
    },
    {
      id: 'community',
      category: 'metric',
      description:
        'Groups the visible graph by label propagation. Pair with scale: "categorical" to colour each cluster differently — this is what makes a cluster map.',
      options: [{ name: 'rounds', type: 'number', description: 'Propagation rounds. Default 8.' }],
      example: `"nodeStyle": [{ "style": { "color": { "metric": "community", "scale": "categorical" } } }]`,
    },

    // ─── Behaviours ────────────────────────────────────────────────────────────
    {
      id: 'pan-zoom',
      category: 'behaviour',
      description: 'Drag the background to pan, wheel to zoom about the pointer. List it last — it is the fallback.',
      example: `"behaviours": ["pan-zoom", "select", "expand-on-double-click"]`,
    },
    {
      id: 'select',
      category: 'behaviour',
      description: 'Click to select, shift-click to extend, background to clear. Emits onNodeClick.',
    },
    {
      id: 'drag-node',
      category: 'behaviour',
      description:
        'Drag a node to move it. Releases on drop by default so the layout stays in charge; pass { pin: true } on a board.',
      options: [{ name: 'pin', type: 'boolean', description: 'Leave the node pinned where it was dropped.' }],
      example: `{ "type": "drag-node", "options": { "pin": true } }`,
    },
    {
      id: 'expand-on-double-click',
      category: 'behaviour',
      description: 'Double-click a node to expand it. The usual gesture on a map you also want to select on.',
      options: [{ name: 'direction', type: '"in" | "out" | "both"' }],
    },
    {
      id: 'expand-on-click',
      category: 'behaviour',
      description: 'Single click expands — for maps meant purely for exploring, where selection is not needed.',
      options: [{ name: 'direction', type: '"in" | "out" | "both"' }],
    },
  ],
};
