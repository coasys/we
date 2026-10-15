/**
 * Looking inside cards, and the space's vocabulary as a map.
 *
 * Two readings the canvas offers beside freeform and tree.
 *
 * **Opening a card.** The caret on a selected card opens it into its fields (the `property`
 * expander), and closes it again. Which cards are open is in the address (`?open=`), beside the fold,
 * so a link carries what somebody was looking inside and a reload comes back to it. A card whose
 * children are already on the canvas still folds, as before — one caret, whatever is behind it.
 *
 * **The vocabulary.** What the space has *defined* — its signal types, connection kinds, task states,
 * kinds of part, topics, models and flows — is never on the canvas, because those records are found by
 * type and nothing on the canvas contains them. `?vocab=1` swaps the canvas for a map of them: one
 * bucket per kind, in the order and words of the space's Vocabulary settings, each opening into what is
 * in it. A model opens into its fields and a Records node; a flow into its steps and the moves between
 * them. Clicking a record inspects it like any card; editing stays where it is, in the settings.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

/** Which cards are open, by node address, comma-separated — like the fold, in the address. */
export const OPEN_PARAM = 'open';
export const OPEN_NODES = `split(routeStore.params.${OPEN_PARAM})`;

/** Open a card or close it — from the graph's own report, for the reason `FOLD_FROM_GRAPH` gives. */
export const OPEN_FROM_GRAPH: SchemaProp = {
  $action: 'routeStore.setParam',
  args: [
    OPEN_PARAM,
    { $: `join(event.open ? distinct(${OPEN_NODES}, [event.id]) : ${OPEN_NODES}.filter(k, k != event.id), ',')` },
  ],
};

/** The open set, ready to append to a query string the template builds — see `FOLD_QUERY`. */
export const OPEN_QUERY = `\${routeStore.params.${OPEN_PARAM} ? '&${OPEN_PARAM}=' + routeStore.params.${OPEN_PARAM} : ''}`;

/** The vocabulary map is on. In the address, so a link to it is a link to it. */
export const VOCAB_PARAM = 'vocab';
export const VOCAB_ON = `routeStore.params.${VOCAB_PARAM} == '1'`;
export const VOCAB_QUERY = `\${${VOCAB_ON} ? '&${VOCAB_PARAM}=1' : ''}`;

/**
 * What a card on the content canvas opens into: its own fields, as leaves, and — for a note or a
 * post — what is inside it. The layout puts the fields to the card's right and its contents below it.
 */
export const CANVAS_EXPANSION = { defaultDepth: 0, direction: 'out', expanders: ['property', 'collection'] } as const;

/**
 * A field opened out of a card: a small box beside it, saying the field and its value.
 *
 * After the card rules so it wins over them — a field is not a record, so it has no record content
 * to draw, no lens colour and no placement of its own.
 */
export const FIELD_NODE_RULE = {
  when: { kind: 'property' },
  // The size the canvas layout gives a field — `FIELD_BOX` in WorkshopTree — so they agree.
  style: { shape: 'card', width: 170, height: 44, content: '', color: 'surface-sunken', labelMinZoom: 0.3 },
};

/**
 * The buckets, in the Vocabulary settings' order and words — the two places a space's words are shown
 * must not name them differently. "From other apps" appears only where there is something in it.
 */
const BUCKETS = `[
  { key: 'signals', label: 'Signal types', entity: 'SignalType' },
  { key: 'connections', label: 'Relationship types', entity: 'RelationshipType' },
  { key: 'states', label: 'Task states', entity: 'TaskState', opens: { entity: 'TaskBlock', field: 'status', key: 'slug' } },
  { key: 'kinds', label: 'Involvement types', entity: 'InvolvementType' },
  { key: 'topics', label: 'Topics', entity: 'Topic' },
  { key: 'models', label: 'Models', models: shapeStore.spaceShapes.map(s, { name: s.name }) },
  { key: 'other', label: 'From other apps', models: datasetStore.currentDatasetEntities.map(e, { name: e.name }) },
  { key: 'flows', label: 'Flows', flows: flowStore.flows.map(f, { name: f.name, label: f.label, steps: f.steps, moves: f.moves }) }
].filter(b, b.key != 'other' || count(b.models))`;

/** The map of the space's vocabulary — see the module docblock. */
export const vocabularyCanvas: SchemaNode = {
  /*
    Laid over the canvas, which stays mounted beneath — see where the workshop places it. Opaque, and
    above the canvas's own layers, so nothing of the canvas shows or takes a press through it.
  */
  type: 'Column',
  props: { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', bg: 'page', zIndex: 1 },
  children: [
    {
      type: 'GraphView',
      props: {
        seeds: { source: 'vocabulary', options: { buckets: { $: BUCKETS } } },
        /*
      What opens into what: a bucket into its members, a model into its fields and a Records node, the
      Records node into the model's records, a task state into the tasks in it (the bucket's `opens`),
      any record into its fields — each field one node saying its name and value, as a card's do on the
      canvas, rather than a field node with its value hanging off it as another.
    */
        expansion: {
          defaultDepth: 0,
          direction: 'out',
          expanders: ['vocabulary', 'schema-properties', 'schema-instances', 'property'],
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
          options: { card: { width: 180, height: 64 }, levelGap: 110, unattached: 'trees', sortBy: 'order' },
        },
        nodeStyle: [
          { style: { shape: 'card', width: 180, height: 64, color: 'surface-raised' } },
          // A role: `accent-surface` is not one, so the roots painted nothing and read as bare words on the page.
          { when: { kind: 'cluster', type: 'vocabulary' }, style: { color: 'accent-muted', height: 56 } },
          { when: { kind: 'cluster', type: 'flow' }, style: { color: 'surface-sunken' } },
          { when: { 'data.final': true }, style: { borderColor: 'accent-text', borderWidth: 2 } },
          { when: { kind: 'property' }, style: { color: 'surface-sunken', height: 44 } },
          { when: { kind: 'literal' }, style: { shape: 'circle', size: 12 } },
        ],
        /*
          A parent's lines leave its bottom edge and meet each child at its top, as the canvas's tree
          draws them — where the geometry decides, the outer children of a wide rank are met at their
          sides, and the same relationship reads three different ways. Not a flow's moves, which run
          between steps side by side.
        */
        edgeStyle: [
          ...['contains', 'instance', 'property'].map((type) => ({
            when: { type },
            style: { sourceAnchor: 's', targetAnchor: 'n', ignoreRoute: true },
          })),
          { when: { type: 'move' }, style: { dashed: true, color: 'accent-text' } },
        ],
        open: { $: OPEN_NODES },
        onNodeOpen: OPEN_FROM_GRAPH,
        // A record on the map is inspected like any card; a bucket, a flow or a field has none, and clears it.
        focus: { $: 'routeStore.params.card' },
        onNodeClick: [
          { $setLocal: 'inspecting', value: { $: "event.recordId ?? ''" } },
          { $setLocal: 'inspectingType', value: { $: "event.recordType ?? ''" } },
        ],
        showStatus: true,
      },
    },
  ],
};

/** The control that swaps the canvas for the vocabulary map and back, beside the tree's. */
export const vocabularyToggle: SchemaNode = {
  type: 'we-tooltip',
  props: {
    placement: 'bottom',
    content: { $: `${VOCAB_ON} ? 'Back to the canvas' : 'What this space has defined — its words, models and flows'` },
  },
  children: [
    {
      type: 'we-button',
      props: {
        variant: { $: `${VOCAB_ON} ? 'secondary' : 'ghost'` },
        onClick: { $action: 'routeStore.setParam', args: [VOCAB_PARAM, { $: `${VOCAB_ON} ? null : '1'` }] },
      },
      children: [
        { type: 'we-icon', props: { name: 'book-open-text' } },
        { type: 'we-text', props: { variant: 'label' }, children: ['Vocabulary'] },
      ],
    },
  ],
};

/** The record types the Vocabulary settings edit. */
const VOCABULARY_ENTITIES = "['SignalType', 'RelationshipType', 'TaskState', 'InvolvementType', 'Topic']";

/**
 * Where a vocabulary record is edited, from its inspector. The map shows it; the settings change it —
 * they already have the right controls (a state's approvals, a kind's reflexivity), and a second copy
 * of them here would be two places to keep honest.
 */
export function vocabularyEditLink(cardType: string): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $: `${cardType} in ${VOCABULARY_ENTITIES}` },
      then: {
        type: 'we-button',
        props: {
          size: 'sm',
          variant: 'secondary',
          onClick: { $action: 'shellStore.openSpaceSettings', args: ['vocabulary'] },
        },
        children: [
          { type: 'we-icon', props: { name: 'book-open-text' } },
          { type: 'we-text', props: { variant: 'label' }, children: ['Edit in Vocabulary'] },
        ],
      },
    },
  };
}
