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
      id: 'board',
      category: 'seed',
      description:
        "A container's contents at the positions somebody put them. Membership is ordinary containment, so a card composed onto the board is found like any child; position comes from Placement records parented to the same board, which is why the same note can sit on two boards in two places. Pair with layout: manual and drag-node { pin: true }, and persist a drop through recordStore.placeOnBoard. Loads nothing until a board is chosen.",
      options: [
        { name: 'board', type: 'string', description: 'Record id of the board (required).' },
        {
          name: 'contains',
          type: 'string[]',
          description:
            'Types the board may hold beyond whatever its placements name — one query each. Defaults to the block vocabulary; anything *placed* is loaded whether or not it is listed.',
        },
        { name: 'via', type: 'string', description: 'Relation holding the contents. Defaults to "children".' },
        {
          name: 'connections',
          type: 'string',
          description:
            'Reified relation entity to draw as lines between the cards — e.g. "Relationship". Only pairs whose two ends are both on the board are drawn, since a line to something elsewhere would leave the canvas. Each line carries the record it stands for, so clicking one can open it. Omit for a board with no connections.',
        },
        {
          name: 'typeStyles',
          type: 'string',
          description:
            'Entity holding this board\'s colour per kind of thing — WE passes "TypeStyle". Read onto every node as `boardTypeColor`, for a style rule to pick up with `{ from: "data.boardTypeColor" }`. This is what a board\'s key writes.',
        },
        {
          name: 'pending',
          type: 'string[]',
          description:
            'Record ids whose card stands for a suggestion nobody has agreed to yet — an extraction pass can stage a whole record, so it is on the board and answers every query the accepted ones do. Read onto the matching node as `pending: true`, for a style rule to pick up with `{ when: { pending: true } }`. Ids rather than a query because only the capability that staged them knows which they are.',
        },
        { name: 'limit', type: 'number', description: 'Rows per type. Default 200.' },
      ],
      example: `{ "source": "board", "options": { "board": { "$": "local.boardId" } } }`,
    },
    {
      id: 'dataset',
      category: 'seed',
      description: 'Seeds a single node for the current space — the starting point for exploring outward.',
      options: [{ name: 'label', type: 'string', description: 'What the node is called. Defaults to the space name.' }],
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
        {
          name: 'direction',
          type: '"down" | "right"',
          description: 'Which way the tree grows from its roots. Default "down".',
        },
        { name: 'levelGap', type: 'number', description: 'Distance between one rank and the next.' },
        { name: 'siblingGap', type: 'number', description: 'Distance between neighbours on the same rank.' },
      ],
      example: `{ "type": "tree", "options": { "direction": "right", "levelGap": 200 } }`,
    },
    {
      id: 'radial',
      category: 'layout',
      description: 'Concentric rings by hop distance from the roots — reads as distance from a centre.',
      options: [{ name: 'ringGap', type: 'number', description: 'Distance between one ring and the next.' }],
      example: `{ "type": "radial" }`,
    },
    {
      id: 'grid',
      category: 'layout',
      description: 'Uniform grid, optionally ordered by a node data field. Honest default when edges say little.',
      options: [
        { name: 'columns', type: 'number', description: 'How many columns. Derived from the node count when omitted.' },
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

    // ─── Presentation ──────────────────────────────────────────────────────────
    {
      id: 'curve',
      category: 'style',
      description:
        'Edge style — the shape a connection is drawn with. "smooth" (default) leaves and arrives along the axis the edge mostly runs on, the flow-chart S, so it reads as direction and suits hierarchies and pipelines. "straight" is a direct line, right when the layout is already doing the talking. "arc" bows to one side, for a graph dense enough that lines need telling apart by shape. "step" turns at right angles, for containment and org charts where the eye follows a rank. Two nodes related in both directions are always separated — shifted sideways, or crossed at different points — so picking a shape never hides a relationship.',
      example: `"edgeStyle": [{ "style": { "curve": "smooth" } }]`,
    },
    {
      id: 'arrow',
      category: 'style',
      description:
        'Edge style — which ends carry an arrowhead. "target" (default) points at the thing being related to; "both" for a mutual relationship drawn as one line; "none" when the relation has no direction worth showing. The head scales with the line\'s width, and the line stops short of it rather than running underneath.',
      example: `"edgeStyle": [{ "style": { "arrow": "none" } }]`,
    },
    {
      id: 'scaleWithZoom',
      category: 'style',
      description:
        'Edge style. true (default) treats the line as part of the drawing, so it thickens as you zoom in — right for a board. false pins it to a constant on-screen width, so hairlines stay visible when you zoom out to see a whole network.',
      example: `"edgeStyle": [{ "style": { "scaleWithZoom": false } }]`,
    },
    {
      id: 'content',
      category: 'style',
      description:
        "Node style, cards only. Names a host-supplied component to draw INSIDE the card instead of a text label — WE registers `block`, which renders a CollectionBlock's composed content the way a post card does. A label can only ever be the first line, so a card holding an image and three paragraphs shows sixty characters and gives no sign the rest exists. Clipped, not scrolled: a card is a preview, and what does not fit is reached by opening it. Falls back to the label when the host supplies no component by that name.",
      example: `"nodeStyle": [{ "style": { "shape": "card", "width": 180, "content": "block" } }]`,
    },
    {
      id: 'contentMinZoom',
      category: 'style',
      description:
        'Node style. Hides card content below this zoom and falls back to the label. The sibling of labelMinZoom, and the thing that decides whether rich cards scale: a hundred documents rendered at once is a hundred component trees, and at the zoom where a board reads as coloured rectangles none of them is legible anyway.',
      example: `"nodeStyle": [{ "style": { "shape": "card", "content": "block", "contentMinZoom": 0.5 } }]`,
    },
    {
      id: 'scaleLabelWithZoom',
      category: 'style',
      description:
        'Node style. true (default) scales the label with the camera; false keeps it a constant on-screen size, which keeps text readable at any zoom on a map you navigate by reading. Affects the label only — a node mark always scales, because its size and its hit area are both world units.',
      example: `"nodeStyle": [{ "style": { "scaleLabelWithZoom": false } }]`,
    },
    {
      id: 'labelMinZoom',
      category: 'style',
      description:
        'Node style. Hides the label below this zoom level, so a dense graph stays readable when zoomed out and gains its detail as you move in.',
      example: `"nodeStyle": [{ "style": { "labelMinZoom": 0.6 } }]`,
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

    // ─── Controls ──────────────────────────────────────────────────────────────
    {
      id: 'zoom-in',
      category: 'control',
      description: 'Zooms toward the centre of the view. Shown by default.',
      example: `"controls": ["zoom-in", "zoom-out", "fit"]`,
    },
    { id: 'zoom-out', category: 'control', description: 'Zooms out from the centre. Shown by default.' },
    {
      id: 'fit',
      category: 'control',
      description:
        'Frames everything currently on the graph. Deliberately not a re-layout — it moves the camera, never the nodes.',
    },
    {
      id: 'pin',
      category: 'control',
      description:
        'Holds the selected nodes where they are, so the layout stops moving them; press again to release. The usual way to shape a force graph — put the thing you care about where you want it, hold it there, and let the rest settle around it. Held nodes are ringed so the state is visible. Not shown by default: on a board every node is placed already and it means nothing.',
      example: `"controls": ["zoom-in", "zoom-out", "fit", "pin"]`,
    },
    {
      id: 'lock',
      category: 'control',
      description:
        'Blocks moving nodes, so a graph cannot be rearranged by accident while it is being read or shown to someone. Affects dragging only — panning, zooming and a settling force layout all carry on. Not shown by default, and only meaningful where the template allows dragging at all.',
      example: `"controls": ["zoom-in", "zoom-out", "fit", "lock"]`,
    },
    {
      id: 'relayout',
      category: 'control',
      description:
        'Re-runs the layout. Not shown by default: a rescue for a tangled force graph, and destructive on a board, where it would discard every position somebody chose.',
      example: `"controls": ["zoom-in", "zoom-out", "fit", "relayout"]`,
    },

    // ─── Behaviours ────────────────────────────────────────────────────────────
    {
      id: 'pan-zoom',
      category: 'behaviour',
      description:
        'Drag the background to pan, wheel to zoom about the pointer. **List it last.** It claims a press on empty canvas, and dispatch stops at the first behaviour that claims — so anything after it never sees a background press. Listed before `select`, clicking empty canvas silently stops clearing the selection.',
      example: `"behaviours": ["select", "expand-on-double-click", "pan-zoom"]`,
    },
    {
      id: 'select',
      category: 'behaviour',
      description:
        'Click to select, shift-click to extend, background to clear. Emits onNodeClick, and onSelectionChange with an empty list when a background click clears it. Must be listed BEFORE pan-zoom, which claims the background press it needs to see.',
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
      id: 'connect-nodes',
      category: 'behaviour',
      description:
        "Drag from one node to another to connect them, emitting onEdgeCreate with both ends. Writes nothing — what a connection means is the template's decision, so it answers by creating whatever record it thinks the connection is. List it BEFORE drag-node: both claim a press on a node and the first wins. Arm it from a control the user can see rather than a modifier key, which is undiscoverable and absent on a touchscreen.",
      options: [
        {
          name: 'armed',
          type: 'boolean',
          description: 'Whether the gesture is live. Default true. Disarmed, the press falls through to drag-node.',
        },
      ],
      example: `"behaviours": [{ "type": "connect-nodes", "options": { "armed": { "$": "local.connecting" } } }, "select", { "type": "drag-node" }, "pan-zoom"]`,
    },
    {
      id: 'node-double-click',
      category: 'behaviour',
      description:
        "Double-click a node to emit onNodeDoubleClick, with the record it stands for resolved onto the payload. Writes nothing — what opening a node means is the template's decision. Pairs with canvas-double-click, which handles the same gesture on empty canvas; list both and exactly one fires. Do NOT list it alongside expand-on-double-click, which claims the same gesture to do something else.",
      example: `"behaviours": ["node-double-click", "canvas-double-click", "pan-zoom", "select"]`,
    },
    {
      id: 'canvas-double-click',
      category: 'behaviour',
      description:
        "Double-click empty canvas to emit onCanvasDoubleClick with the world point. Writes nothing — what gets made there is the template's decision. List it BEFORE pan-zoom, which is the background fallback. Claims only the background, so it composes with expand-on-double-click: a double-click on a node opens it, one beside a node creates.",
      example: `"behaviours": ["canvas-double-click", "pan-zoom", "select", { "type": "drag-node", "options": { "pin": true } }]`,
    },
    {
      id: 'expand-on-double-click',
      category: 'behaviour',
      description: 'Double-click a node to expand it. The usual gesture on a map you also want to select on.',
      options: [
        {
          name: 'direction',
          type: '"in" | "out" | "both"',
          description: 'Which way relations are followed when the node opens. Default "both".',
        },
      ],
      example: `{ "type": "expand-on-double-click", "options": { "direction": "out" } }`,
    },
    {
      id: 'expand-on-click',
      category: 'behaviour',
      description: 'Single click expands — for maps meant purely for exploring, where selection is not needed.',
      options: [
        {
          name: 'direction',
          type: '"in" | "out" | "both"',
          description: 'Which way relations are followed when the node opens. Default "both".',
        },
      ],
      example: `{ "type": "expand-on-click", "options": { "direction": "out" } }`,
    },
  ],
};
