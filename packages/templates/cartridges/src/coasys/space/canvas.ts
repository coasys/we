import type { SchemaNode } from '@we/schema-shared';
import {
  askWhatGoesHere,
  BACK_TO_CHOOSER,
  canvasEditing,
  canvasSeedOptions,
  CARD_LOCALS,
  focusDim,
  focusDimWhere,
  newNoteModal,
  newThingChooser,
  PLACED_CARD_STYLE,
  recordFormModal,
  SOCIAL_DNA_LABELS,
  SUGGESTION_STYLES,
  vocabularyMap,
} from '@we/template-kit';

import { viewBar } from './bar.ts';
import { DNA_FOCUS, IN_CANVAS, PAGE_EXPR } from './paths.ts';

/**
 * The space in Canvas mode: whatever the tree has chosen, seen on the map it lives on.
 *
 * Every row of the tree is a focus. In Page mode it opens its page; here it dims the canvas to what
 * belongs to it, and leaves the rest faint, so somebody keeps their bearings:
 *
 * | Chosen | On the canvas |
 * |---|---|
 * | The Feed, a group's page | everything |
 * | A call | what was extracted from it |
 * | A person | what they made |
 * | A workflow | the records going through it |
 * | Social DNA, a kind of it, one definition, the policy | the vocabulary map: its kind open, the definition open into what it is, the rest dimmed |
 *
 * Two maps, never one: the content canvas is what the space holds, arranged by people; the vocabulary
 * is what it has defined, generated and laid out by itself. Social DNA is never a card on the content
 * canvas, so choosing it shows the vocabulary map over the canvas instead (the kit's `vocabularyMap`).
 *
 * Drawn outside the routes, so it stays mounted while the focus changes: choosing one thing after
 * another restyles the canvas rather than drawing it again.
 */

/**
 * What is in focus, each read from the address as the page it would open is: a call's page, a person's,
 * the workflow open on the Workflows page. Read directly rather than through the tree's whole choice
 * (`SELECTED_EXPR`), which is long enough that the few places using it here passed what an expression
 * may be.
 */
const CALL = `(${PAGE_EXPR}) == 'record' && routeStore.params.kind == 'call' ? routeStore.params.id : ''`;
const PERSON = `(${PAGE_EXPR}) == 'person' ? routeStore.params.did : ''`;
const WORKFLOW = `(${PAGE_EXPR}) == 'workflows' && workflowStore.open`;

/** The space's canvas — its `canvas` landmark, whose placements are its children. */
const CANVAS_EXPR = "spaceStore.landmarks.canvas ? spaceStore.landmarks.canvas : ''";
const CANVAS = { $: CANVAS_EXPR };

/** A record's own page, which is where a suggested change is read old against new. */
const RECORD_PAGE = "spaceStore.spacePath + '/record/' + event.recordType + '?id=' + event.recordId";

/** Social DNA in focus: the map, and which kind, which definition of it, and which of its fields. */
const ON_DNA = `(${IN_CANVAS}) && ${DNA_FOCUS}`;
const DNA_KIND = `split(${DNA_FOCUS}, '|')[0]`;
const DNA_ID = `split(${DNA_FOCUS}, '|')[1]`;
const DNA_FIELD = `split(${DNA_FOCUS}, '|')[2]`;

/** A kind of Social DNA in the tree, as the vocabulary map's bucket for it, and as the bar names it. */
const DNA_KINDS: Record<string, { bucket: string; label: string }> = Object.fromEntries(
  (
    [
      ['signal', 'signals'],
      ['connection', 'connections'],
      ['state', 'states'],
      ['involvement', 'kinds'],
      ['topic', 'topics'],
      ['model', 'models'],
      ['policy', 'policy'],
    ] as const
  ).map(([kind, bucket]) => [kind, { bucket, label: SOCIAL_DNA_LABELS[bucket] }]),
);
const lookup = (field: 'bucket' | 'label') =>
  `{ ${Object.entries(DNA_KINDS)
    .map(([kind, entry]) => `${kind}: '${entry[field]}'`)
    .join(', ')} }[${DNA_KIND}]`;
const BUCKET = lookup('bucket');

/** A bucket's node on the map, by the address the vocabulary seed gives it. */
const BUCKET_NODE = `'we-graph://cluster/vocabulary/' + ${BUCKET}`;

/** A model's name, the tree knowing a model by the Shape record's id. */
const MODEL_NAME = `shapeStore.spaceShapes.find(s, s.id == (${DNA_ID})).name`;

/**
 * Social DNA in focus, as two dimmings: everything in the other kinds, and — with one definition
 * chosen — the others of its kind. Naming what to dim rather than what to keep, so what a chosen
 * definition opens into (its fields, its records) stays whole. A definition is a record by its id, a
 * model by its name, a rule of the policy by its words.
 */
const OTHER_KINDS = `{ 'data.bucket': { exists: true, not: ${BUCKET} } }`;
const SIBLING = (key: string, value: string) =>
  `{ 'data.bucket': ${BUCKET}, type: { not: 'vocabulary' }, '${key}': { not: ${value} } }`;
const SIBLINGS = `(${DNA_KIND} == 'model' ? ${SIBLING('data.entity', MODEL_NAME)} : ${DNA_KIND} == 'policy' ? ${SIBLING('data.item', DNA_ID)} : ${SIBLING('data.recordId', DNA_ID)})`;

/** The definition chosen, opened: a record or a model by what the graph's `open` takes; a rule has nothing inside. */
const OPEN_DEFINITION = `${DNA_ID} && ${DNA_KIND} != 'policy' ? [${DNA_KIND} == 'model' ? ${MODEL_NAME} : ${DNA_ID}] : []`;

/** What the map selects: a field of the definition, a model's by the model's name, or a record definition. */
const FOCUS = `${DNA_FIELD} ? (${DNA_KIND} == 'model' ? ${MODEL_NAME} : ${DNA_ID}) + '#' + ${DNA_FIELD} : ${DNA_ID} && !(${DNA_KIND} in ['model', 'policy']) ? ${DNA_ID} : ''`;

/** The bar's words for what is in focus. */
const TITLE = [
  `(${ON_DNA}) ? (${DNA_FOCUS} == 'all' ? 'Social DNA' : ${lookup('label')})`,
  `: (${CALL}) ? (first(local.focusCall).title ? first(local.focusCall).title : 'A call')`,
  `: (${PERSON}) ? (profileStore.profiles.find(p, p.did == (${PERSON})).name ?? 'A person')`,
  `: ${WORKFLOW} ? workflowStore.open.label`,
  `: 'Canvas'`,
].join(' ');

export const canvasPane: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $localState: {
    ...CARD_LOCALS,
    // Which nodes of the vocabulary map are open, beside the bucket a focus opens.
    vocabOpen: { type: 'array', initial: [] },
  },
  $queries: {
    focusCall: {
      entity: 'CollectionBlock',
      where: { id: { $: CALL } },
      select: ['title'],
      limit: 1,
      when: { $: CALL },
    },
  },
  children: [
    viewBar([{ $: TITLE }], { $: `(${ON_DNA}) ? 'dna' : 'squares-four'` }),
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', position: 'relative' },
      children: [
        {
          type: 'GraphView',
          props: {
            width: '100%',
            height: '100%',
            seeds: {
              source: 'canvas',
              options: canvasSeedOptions({
                canvas: CANVAS,
                members: { id: { $: 'spaceStore.root' }, via: 'children' },
              }),
            },
            layout: { type: 'manual', options: { size: { width: 200, height: 140 } } },
            // A dot grid, as d12's canvas has: it moves with the canvas, so a pan reads as a pan.
            backdrop: { pattern: 'dots', gap: 24 },
            nodeStyle: [
              { style: { shape: 'card', width: 200, height: 140, content: 'record', contentMinZoom: 0.4 } },
              { style: PLACED_CARD_STYLE },
              ...SUGGESTION_STYLES,
              // The focus, after the suggestions: a suggestion out of focus is dimmed with the rest.
              focusDim(CALL, 'data.origin', CALL),
              focusDim(PERSON, 'data.author', PERSON),
              focusDim(WORKFLOW, 'data.recordId', 'workflowStore.open.records.map(r, r.record)'),
            ],
            behaviours: [
              // A right-drag from a card draws a line from it, beside the handles on a selected card.
              { type: 'connect-nodes', options: { button: 'secondary' } },
              'node-double-click',
              'canvas-double-click',
              'marquee-select',
              'select',
              { type: 'drag-node', options: { pin: true } },
              'pan-zoom',
            ],
            resizable: true,
            empty: {
              $: `${CANVAS_EXPR} ? 'Nothing here yet. Double-click to make something, or drop something in from Pocket.' : 'This space has no canvas.'`,
            },
            emptyIcon: 'squares-four',
            ...canvasEditing({
              canvas: CANVAS,
              onReview: { $invoke: 'routeStore.navigate', args: [{ $: RECORD_PAGE }] },
            }),
            onCanvasDoubleClick: askWhatGoesHere(CANVAS),
            onNodeDoubleClick: { $invoke: 'routeStore.navigate', args: [{ $: RECORD_PAGE }] },
          },
        },
        // Social DNA, over the canvas, which stays mounted beneath so coming back to it is instant.
        {
          type: '$if',
          props: {
            condition: { $: ON_DNA },
            then: vocabularyMap({
              // Its kind opened, and the definition chosen opened into what it is.
              open: {
                $: `distinct(local.vocabOpen, ${DNA_FOCUS} != 'all' ? [${BUCKET_NODE}] : [], ${OPEN_DEFINITION})`,
              },
              onNodeOpen: {
                $setLocal: 'vocabOpen',
                value: {
                  $: 'event.open ? distinct(local.vocabOpen, [event.id]) : local.vocabOpen.filter(k, k != event.id)',
                },
              },
              // A field chosen is selected, by the graph's `<id>#<field>`; else a definition that is a record.
              focus: { $: FOCUS },
              focusRules: [focusDimWhere(`${DNA_FOCUS} != 'all'`, OTHER_KINDS), focusDimWhere(DNA_ID, SIBLINGS)],
            }),
          },
        },
      ],
    },
    recordFormModal({ back: BACK_TO_CHOOSER, entityPicker: false }),
    newThingChooser(CANVAS),
    newNoteModal(CANVAS),
  ],
};
