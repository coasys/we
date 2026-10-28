import type { SchemaNode, SchemaProp } from '@we/schema-shared';

/**
 * What a space has defined, as a map: its signal types, connection kinds, task states, kinds of
 * involvement, topics, models, workflows and policy — one bucket per kind, each opening into what is
 * in it.
 *
 * Never on a space's canvas, because nothing there contains them: they are found by type. So they are
 * a map of their own, which an interface lays over its canvas when somebody asks what the space has
 * defined rather than what it holds. Shared by the workshop and the Coasys space; what each does when
 * a word is pressed, or opened, is its own, given as options.
 *
 * The buckets are in the space's Vocabulary settings' order and words — the two places a space's words
 * are shown must not name them differently — and the policy's rules after them, as the settings show
 * the policy beside the vocabulary. "From other apps" appears only where there is something in it.
 */

/**
 * What each kind of Social DNA is called, wherever one is named: the settings' sections, the map's
 * buckets, a space's tree. One list, because three lists had drifted — the same kind was "Connection
 * types" in the tree and "Relationship types" on the map beside it.
 */
export const SOCIAL_DNA_LABELS = {
  signals: 'Signal types',
  connections: 'Connection types',
  states: 'Task states',
  kinds: 'Involvement',
  topics: 'Topics',
  models: 'Models',
  workflows: 'Workflows',
  policy: 'Policy',
} as const;

const L = SOCIAL_DNA_LABELS;

/** How many uses a definition opens into — the latest few, not everything it was ever used for. */
const USES = 12;

/**
 * The buckets, as an expression the vocabulary seed takes. Each definition opens into its uses — see
 * `VocabularyUses` in the graph's expanders: a signal type into what was reacted to with it, a kind of
 * connection into its connections, a state into its tasks, a kind of involvement into what somebody is
 * involved in that way, a topic into what was tagged with it. What a definition *is* is on its card.
 */
export const VOCABULARY_BUCKETS = `[
  { key: 'signals', label: '${L.signals}', entity: 'SignalType', opens: { entity: recordStore.creatableEntities.map(k, k.value), through: 'signals', field: 'signalTypeId', key: 'id', label: 'reacted to', limit: ${USES} } },
  { key: 'connections', label: '${L.connections}', entity: 'RelationshipType', opens: { entity: 'Relationship', field: 'relationshipTypeId', key: 'id', pair: ['source', 'target'], label: 'connects', limit: ${USES} } },
  { key: 'states', label: '${L.states}', entity: 'TaskState', opens: { entity: 'TaskBlock', field: 'status', key: 'slug', label: 'in it', limit: ${USES} } },
  { key: 'kinds', label: '${L.kinds}', entity: 'InvolvementType', opens: { entity: 'Involvement', field: 'kind', key: 'slug', follow: 'node', label: 'involved in', limit: ${USES} } },
  { key: 'topics', label: '${L.topics}', entity: 'Topic', opens: { entity: 'Relationship', through: 'target', field: 'id', key: 'id', follow: 'source', label: 'about it', limit: ${USES} } },
  { key: 'models', label: '${L.models}', models: recordStore.creatableEntities.map(k, { name: k.value, label: k.label }) },
  { key: 'other', label: 'From other apps', models: datasetStore.currentDatasetEntities.filter(e, !(e.name in recordStore.creatableEntities.map(k, k.value))).map(e, { name: e.name }) },
  { key: 'workflows', label: '${L.workflows}', workflows: workflowStore.workflows.map(f, { name: f.name, label: f.label, steps: f.steps, moves: f.moves }) },
  { key: 'policy', label: '${L.policy}', items: spaceStore.policy.sentences.map(s, { id: s, label: s }) }
].filter(b, b.key != 'other' || count(b.models))`;

export interface VocabularyMapOptions {
  /** Which nodes are open, as the graph's `open` takes it — the interface keeps it (an address, local state). */
  open?: SchemaProp;
  /** What opening or closing a node does — the graph reports it; the interface records it. */
  onNodeOpen?: SchemaProp;
  /** A record — or a node by its id, such as a bucket — to select and bring into view. */
  focus?: SchemaProp;
  /** Centre `focus` and keep it centred while the map opens around it — see GraphView's `focusCentre`. */
  focusCentre?: boolean;
  /** What pressing a node does. */
  onNodeClick?: SchemaProp;
  /** Rules dimming what is not in focus — see `focusDimWhere` in `canvas.ts`. Last, so they win. */
  focusRules?: SchemaProp[];
}

/**
 * The vocabulary map, laid over a canvas, which stays mounted beneath: opaque, and above the canvas's
 * own layers, so nothing of the canvas shows or takes a press through it.
 */
export function vocabularyMap(opts: VocabularyMapOptions = {}): SchemaNode {
  return {
    type: 'Column',
    props: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', bg: 'page', zIndex: 1 },
    children: [
      {
        type: 'GraphView',
        props: {
          seeds: { source: 'vocabulary', options: { buckets: { $: VOCABULARY_BUCKETS } } },
          /*
            What opens into what: a bucket into its definitions, a definition into its uses (the
            bucket's `opens`), a model into its records. Never into fields: a field is part of what a
            thing is, not something inside it, so it is on the card and in an inspector instead.
          */
          expansion: {
            defaultDepth: 0,
            direction: 'out',
            expanders: ['vocabulary', 'vocabulary-records', 'schema'],
          },
          // Each bucket is a tree of its own, its members under it; containment edges make the parents.
          /*
        One tree per kind of word, closed until opened, in the settings' order. A kind with nothing
        in it is still a root (`unattached: 'trees'`), rather than a card in a zone of its own.
      */
          layout: {
            type: 'forest',
            /*
          The gap between ranks set rather than derived: a share of a 64-high card is about 40, and a
          line from a parent's bottom to a child's top needs more room than that to turn — in less it
          dived below the child and hooked back up into it. A little more than the canvas's tree has,
          since these lines run between shorter cards that sit wider apart.
        */
            // Sideways, tighter than the default share of the card's width, so a map of many small trees
            // stays close together.
            options: {
              card: { width: 200, height: 96 },
              levelGap: 110,
              siblingGap: 36,
              treeGap: 90,
              unattached: 'trees',
              sortBy: 'order',
            },
          },
          /*
        Lighter than the page, and in the theme's accent: the surface roles a card usually takes sit a
        step from the page and read as dark on dark here. The kinds of word are the strongest fill,
        what is in them a tint of it, and a card's properties the quietest.
      */
          nodeStyle: [
            { style: { shape: 'card', width: 200, height: 64, color: 'accent-soft' } },
            { when: { kind: 'cluster', type: 'vocabulary' }, style: { color: 'accent', height: 56 } },
            { when: { 'data.final': true }, style: { borderColor: 'accent-text', borderWidth: 2 } },
            // A definition, and each use of one, as a record: its fields on the card, as on a canvas.
            {
              when: { kind: 'entity', type: { not: '$schema' } },
              style: { height: 96, content: 'record', contentMinZoom: 0.4 },
            },
            { when: { kind: 'literal' }, style: { shape: 'circle', size: 12 } },
            // Last, so a word in focus and what it holds stand out whatever drew them.
            ...(opts.focusRules ?? []),
          ],
          /*
        A parent's lines leave its bottom edge and meet each child at its top, as the canvas's tree
        draws them — where the geometry decides, the outer children of a wide rank are met at their
        sides, and the same relationship reads three different ways. Not a workflow's moves, which run
        between steps side by side.
      */
          edgeStyle: [
            ...['contains', 'instance', 'property'].map((type) => ({
              when: { type },
              style: { sourceAnchor: 's', targetAnchor: 'n', ignoreRoute: true },
            })),
            // What a line is, where two kinds of thing hang off one card: its fields ("field",
            // "relation") and its records ("records", "status"). A bucket's members need no word.
            ...['instance', 'property'].map((type) => ({
              when: { type },
              style: { showLabel: true },
            })),
            { when: { type: 'move' }, style: { dashed: true, color: 'accent-text' } },
          ],
          ...(opts.open !== undefined ? { open: opts.open } : {}),
          ...(opts.onNodeOpen !== undefined ? { onNodeOpen: opts.onNodeOpen } : {}),
          ...(opts.focus !== undefined ? { focus: opts.focus } : {}),
          ...(opts.focusCentre ? { focusCentre: true } : {}),
          ...(opts.onNodeClick !== undefined ? { onNodeClick: opts.onNodeClick } : {}),
          showStatus: true,
        },
      },
    ],
  };
}
