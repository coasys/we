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

/** The buckets, as an expression the vocabulary seed takes. */
export const VOCABULARY_BUCKETS = `[
  { key: 'signals', label: 'Signal types', entity: 'SignalType' },
  { key: 'connections', label: 'Relationship types', entity: 'RelationshipType' },
  { key: 'states', label: 'Task states', entity: 'TaskState', opens: { entity: 'TaskBlock', field: 'status', key: 'slug' } },
  { key: 'kinds', label: 'Involvement types', entity: 'InvolvementType' },
  { key: 'topics', label: 'Topics', entity: 'Topic' },
  { key: 'models', label: 'Models', models: recordStore.creatableEntities.map(k, { name: k.value, label: k.label }) },
  { key: 'other', label: 'From other apps', models: datasetStore.currentDatasetEntities.filter(e, !(e.name in recordStore.creatableEntities.map(k, k.value))).map(e, { name: e.name }) },
  { key: 'workflows', label: 'Workflows', workflows: workflowStore.workflows.map(f, { name: f.name, label: f.label, steps: f.steps, moves: f.moves }) },
  { key: 'policy', label: 'Policy', items: spaceStore.policy.sentences.map(s, { id: s, label: s }) }
].filter(b, b.key != 'other' || count(b.models))`;

export interface VocabularyMapOptions {
  /** Which nodes are open, as the graph's `open` takes it — the interface keeps it (an address, local state). */
  open?: SchemaProp;
  /** What opening or closing a node does — the graph reports it; the interface records it. */
  onNodeOpen?: SchemaProp;
  /** A record to select and bring into view. */
  focus?: SchemaProp;
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
    What opens into what: a bucket into its members, a model into its fields and a Records node, the
    Records node into the model's records, a task state into the tasks in it (the bucket's `opens`),
    any record into its fields — each field one node saying its name and value, as a card's do on the
    canvas, rather than a field node with its value hanging off it as another.
  */
          expansion: {
            defaultDepth: 0,
            direction: 'out',
            expanders: ['vocabulary', 'vocabulary-records', 'schema-properties', 'schema-instances', 'property'],
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
              card: { width: 180, height: 64 },
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
            { style: { shape: 'card', width: 180, height: 64, color: 'accent-soft' } },
            { when: { kind: 'cluster', type: 'vocabulary' }, style: { color: 'accent', height: 56 } },
            { when: { 'data.final': true }, style: { borderColor: 'accent-text', borderWidth: 2 } },
            { when: { kind: 'property' }, style: { color: 'control-surface', height: 44, content: 'property' } },
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
          ...(opts.onNodeClick !== undefined ? { onNodeClick: opts.onNodeClick } : {}),
          showStatus: true,
        },
      },
    ],
  };
}
