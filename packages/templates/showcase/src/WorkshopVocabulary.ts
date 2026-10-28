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
 * kinds of part, topics, models and workflows — is never on the canvas, because those records are found by
 * type and nothing on the canvas contains them. `?vocab=1` swaps the canvas for a map of them: one
 * bucket per kind, in the order and words of the space's Vocabulary settings, each opening into what is
 * in it. A model opens into its fields and a Records node; a workflow into its steps and the moves between
 * them. Clicking a record inspects it like any card; editing stays where it is, in the settings.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { vocabularyMap } from '@we/template-kit';

/** Which cards are open, by node address, comma-separated — like the fold, in the address. */
export const OPEN_PARAM = 'open';
export const OPEN_NODES = `split(routeStore.params.${OPEN_PARAM})`;

/** Open a card or close it — from the graph's own report, for the reason `FOLD_FROM_GRAPH` gives. */
export const OPEN_FROM_GRAPH: SchemaProp = {
  $invoke: 'routeStore.setParam',
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
  // `property` draws the name quietly and the value plainly — see `PropertyCard` in the host.
  style: { shape: 'card', width: 170, height: 44, content: 'property', color: 'surface-sunken', labelMinZoom: 0.3 },
};

/**
 * The map of the space's vocabulary — the kit's (`vocabularyMap`), which the Coasys space draws too.
 * What is the workshop's: which cards are open (in the address, beside the fold), and a press on a
 * record inspecting it like any card, where a bucket, a workflow or a field has none and clears it.
 */
export const vocabularyCanvas: SchemaNode = vocabularyMap({
  open: { $: OPEN_NODES },
  onNodeOpen: OPEN_FROM_GRAPH,
  focus: { $: 'routeStore.params.card' },
  onNodeClick: [
    { $setLocal: 'inspecting', value: { $: "event.recordId ?? ''" } },
    { $setLocal: 'inspectingType', value: { $: "event.recordType ?? ''" } },
  ],
});

/** The control that swaps the canvas for the vocabulary map and back, beside the tree's. */
export const vocabularyToggle: SchemaNode = {
  type: 'we-tooltip',
  props: {
    placement: 'bottom',
    content: {
      $: `${VOCAB_ON} ? 'Back to the canvas' : 'What this space has defined — its words, models and workflows'`,
    },
  },
  children: [
    {
      type: 'we-button',
      props: {
        variant: { $: `${VOCAB_ON} ? 'soft' : 'ghost'` },
        onClick: { $invoke: 'routeStore.setParam', args: [VOCAB_PARAM, { $: `${VOCAB_ON} ? null : '1'` }] },
      },
      children: [
        { type: 'we-icon', props: { name: 'book-open-text' } },
        { type: 'we-text', props: { variant: 'label' }, children: ['Vocabulary'] },
      ],
    },
  ],
};
