import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import {
  askWhatGoesHere,
  BACK_TO_CHOOSER,
  canvasEditing,
  canvasSeedOptions,
  CARD_LOCALS,
  focusDim,
  focusDimWhere,
  KIND_CARD_RULES,
  KIND_STYLES_QUERY,
  kindGlyph,
  newNoteModal,
  newThingChooser,
  PLACED_CARD_STYLE,
  recordFormModal,
  SUGGESTION_STYLES,
  TREE_BEHAVIOURS,
  TREE_CARD_STYLE,
  TREE_EDGE_RULES,
  TREE_LOCALS,
  TREE_ON,
  TREE_QUERIES,
  TREE_REFRAME,
  TREE_VOICE_SUMMARY,
  TREE_WEIGH,
  TREE_WEIGHTS,
  treeArrange,
  treeLayout,
  treeStrip,
  vocabularyMap,
} from '@we/template-kit';

import { type Crumb, viewBar } from './bar.ts';
import { BUCKET, DNA_AT, DNA_ID, DNA_KIND, DNA_QUERIES, dnaCrumbs, dnaFocusOf, editDna } from './dna.ts';
import { DNA_FOCUS, DNA_PARAM, IN_CANVAS, inspect, PAGE_EXPR, withView } from './paths.ts';

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
export const CALL = `(${PAGE_EXPR}) == 'record' && routeStore.params.kind == 'call' ? routeStore.params.id : ''`;
const PERSON = `(${PAGE_EXPR}) == 'person' ? routeStore.params.did : ''`;
const WORKFLOW = `(${PAGE_EXPR}) == 'workflows' && workflowStore.open`;

/** The space's canvas — its `canvas` landmark, whose placements are its children. */
const CANVAS_EXPR = "spaceStore.landmarks.canvas ? spaceStore.landmarks.canvas : ''";
const CANVAS = { $: CANVAS_EXPR };

/** A record's own page, which a double-click opens. */
const RECORD_PAGE = "spaceStore.spacePath + '/record/' + event.recordType + '?id=' + event.recordId";

/** Social DNA in focus, over the canvas. */
const ON_DNA = `(${IN_CANVAS}) && ${DNA_FOCUS}`;

/** A bucket's node on the map, by the address the vocabulary seed gives it. */
const BUCKET_NODE = `'we-graph://cluster/vocabulary/' + ${BUCKET}`;

/**
 * Social DNA in focus, as two dimmings: everything in the other kinds, and — with one definition
 * chosen — the others of its kind. Naming what to dim rather than what to keep, so what a chosen
 * definition opens into (its fields, its records) stays whole. A definition is a record by its id, a
 * model by its name, a rule of the policy by its words.
 */
const OTHER_KINDS = `{ 'data.bucket': { exists: true, not: ${BUCKET} } }`;
const SIBLING = (key: string, value: string) =>
  `{ 'data.bucket': ${BUCKET}, type: { not: 'vocabulary' }, '${key}': { not: ${value} } }`;
const SIBLINGS = `(${DNA_KIND} == 'model' ? ${SIBLING('data.entity', DNA_ID)} : ${DNA_KIND} == 'policy' ? ${SIBLING('data.item', DNA_ID)} : ${SIBLING('data.recordId', DNA_ID)})`;

/** The definition chosen, opened: a record or a model by what the graph's `open` takes; a rule has nothing inside. */
const OPEN_DEFINITION = `${DNA_ID} && ${DNA_KIND} != 'policy' ? [${DNA_ID}] : []`;

/**
 * What the map centres on: a definition (a model by its name), a rule of the policy by its key on the
 * map (`policy:<rule>`), or a kind's bucket. All of it, nothing.
 */
const FOCUS = `${DNA_AT} == 'all' ? '' : !(${DNA_ID}) ? ${BUCKET_NODE} : ${DNA_KIND} == 'policy' ? 'policy:' + ${DNA_ID} : ${DNA_ID}`;

/** A node pressed, opened in the inspector — when it stands for a record the inspector reads. */
const OPEN_IN_INSPECTOR: SchemaProp = {
  $if: {
    condition: { $: "event.recordId && event.recordType && event.recordType != '$schema'" },
    then: inspect('event.recordId', { $: 'event.recordType' }),
  },
};

/**
 * The vocabulary map with the Social DNA in focus, drawn over the canvas in Canvas mode — how the
 * definitions connect, where the Social DNA page (`socialDna.ts`) lists them to read through.
 */
const dnaMap: SchemaNode = vocabularyMap({
  // Its kind opened, and the definition chosen opened into what it is.
  open: {
    $: `distinct(local.vocabOpen, ${DNA_AT} != 'all' ? [${BUCKET_NODE}] : [], ${OPEN_DEFINITION})`,
  },
  onNodeOpen: {
    $setLocal: 'vocabOpen',
    value: {
      $: 'event.open ? distinct(local.vocabOpen, [event.id]) : local.vocabOpen.filter(k, k != event.id)',
    },
  },
  // What the tree chose, centred and held there while the map opens around it.
  focus: { $: FOCUS },
  focusCentre: true,
  /*
    Pressing a bucket, a definition, a model or a rule moves the focus to it, as choosing its row in the
    tree does — the map lights it and dims the rest, and the tree lights its row. It used to only open
    the inspector, so the map stayed lit for whatever the tree had chosen before. A definition, or one
    of its uses, opens in the inspector as well; a model is not a record it reads.
  */
  onNodeClick: [
    {
      $if: {
        condition: { $: dnaFocusOf('event') },
        then: { $invoke: 'routeStore.setParam', args: [DNA_PARAM, { $: dnaFocusOf('event') }] },
      },
    },
    OPEN_IN_INSPECTOR,
  ],
  focusRules: [focusDimWhere(`${DNA_AT} != 'all'`, OTHER_KINDS), focusDimWhere(DNA_ID, SIBLINGS)],
});

/** The group of the tree what is in focus belongs to — the page a crumb goes back to — or nothing. */
const GROUPS: Record<string, string> = {
  calls: 'Calls',
  people: 'People',
  channels: 'Channels',
  workflows: 'Workflows',
};
const GROUP = `(${CALL}) ? 'calls' : (${PERSON}) ? 'people' : ({ ${Object.keys(GROUPS)
  .map((g) => `${g}: '${g}'`)
  .join(', ')} }[${PAGE_EXPR}] ?? '')`;
const ITEM = `(${CALL}) || (${PERSON}) || ${WORKFLOW}`;

/**
 * Where the bar says this is: the Social DNA in focus, or what the tree chose and the group it is in —
 * Calls › the call, People › a person, Workflows › one — each step back staying on the canvas.
 */
const CRUMBS: Crumb[] = [
  ...dnaCrumbs(ON_DNA),
  {
    label: {
      $: `{ ${Object.entries(GROUPS)
        .map(([g, label]) => `${g}: '${label}'`)
        .join(', ')} }[${GROUP}]`,
    },
    onClick: [
      { $if: { condition: { $: `(${GROUP}) == 'workflows'` }, then: { $invoke: 'workflowStore.closeWorkflow' } } },
      { $invoke: 'routeStore.navigate', args: [{ $: withView(`spaceStore.spacePath + '/' + (${GROUP})`) }] },
    ],
    when: `!(${ON_DNA}) && (${GROUP}) != ''`,
  },
  {
    label: {
      $: [
        `(${CALL}) ? (first(local.focusCall).title ? first(local.focusCall).title : 'A call')`,
        `: (${PERSON}) ? (profileStore.profiles.find(p, p.did == (${PERSON})).name ?? 'A person')`,
        `: workflowStore.open.label`,
      ].join(' '),
    },
    when: `!(${ON_DNA}) && (${ITEM})`,
  },
  { label: 'Canvas', when: `!(${ON_DNA}) && (${GROUP}) == ''` },
];

export const canvasPane: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $localState: {
    ...CARD_LOCALS,
    // Which nodes of the vocabulary map are open, beside the bucket a focus opens.
    vocabOpen: { type: 'array', initial: [] },
    /*
      How the canvas is being read: freeform or a tree, and what the tree is made of — the mode, the
      spine and the order in the address, so a link carries the reading. See `canvasTree` in the kit.
      Declared here rather than on the graph, because the strip that sets them is a sibling of it.
    */
    ...TREE_LOCALS,
  },
  $queries: {
    // The vocabularies the strip's pickers offer — the connection kinds a spine is chosen from, the
    // reactions an order is weighed by. See `TREE_QUERIES`.
    ...TREE_QUERIES,
    // What the Social DNA crumbs name a definition by, asked only while it is on the canvas.
    ...Object.fromEntries(
      Object.entries(DNA_QUERIES).map(([name, query]) => [name, { ...query, when: { $: ON_DNA } }]),
    ),
    // The space's colours by kind, which the cards and the chooser below are drawn in.
    typeStyles: KIND_STYLES_QUERY,
    focusCall: {
      entity: 'CollectionBlock',
      where: { id: { $: CALL } },
      select: ['title'],
      limit: 1,
      when: { $: CALL },
    },
  },
  children: [
    viewBar(CRUMBS, { $: `(${ON_DNA}) ? 'dna' : 'squares-four'` }, [
      { type: '$if', props: { condition: { $: ON_DNA }, then: editDna } },
    ]),
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
              options: {
                ...canvasSeedOptions({
                  canvas: CANVAS,
                  members: { id: { $: 'spaceStore.root' }, via: 'children' },
                }),
                /*
                  What each card weighs, whenever the tree is shown or the order is a reaction — read
                  early so ordering by one is a re-sort rather than a reload. See `TREE_WEIGH`.
                */
                weigh: TREE_WEIGH,
                // How much each person's voice counts in that weight — re-applied without a read.
                weights: TREE_WEIGHTS,
              },
            },
            /*
              One expression over one graph, freeform or forest — so switching is a rearrangement of
              the cards already loaded, not a remount. The freeform side is `manual` as it was, parked
              at this canvas's card size. See `treeLayout` in the kit.
            */
            layout: treeLayout({ card: { width: 200, height: 140 } }),
            // Back into view when the tree's cards change size — see `TREE_REFRAME`.
            reframeOn: TREE_REFRAME,
            // A dot grid, as d12's canvas has: it moves with the canvas, so a pan reads as a pan.
            backdrop: { pattern: 'dots', gap: 24 },
            nodeStyle: [
              { style: { shape: 'card', width: 200, height: 140, content: 'record', contentMinZoom: 0.4 } },
              // Each kind in its colour; a card somebody coloured keeps its own, over it.
              KIND_CARD_RULES,
              { style: PLACED_CARD_STYLE },
              /*
                In the tree every card gets one box — a rank reads as significance, so a size somebody
                chose while arranging would claim an importance the data does not support. Its colour
                survives. See `TREE_CARD_STYLE`.
              */
              { style: TREE_CARD_STYLE },
              ...SUGGESTION_STYLES,
              // The focus, after the suggestions: a suggestion out of focus is dimmed with the rest.
              focusDim(CALL, 'data.origin', CALL),
              focusDim(PERSON, 'data.author', PERSON),
              focusDim(WORKFLOW, 'data.recordId', 'workflowStore.open.records.map(r, r.record)'),
            ],
            /*
              The connections the tree is not following, faint — the honest counterpart of placing each
              card under one parent. Freeform the list answers nothing, so the lines are as they were.
              See `TREE_EDGE_RULES`.
            */
            edgeStyle: [TREE_EDGE_RULES],
            /*
              `arrange-nodes` replaces `drag-node` in the tree rather than joining it — both claim a
              press on a card, and a coordinate is not what a drag there writes. See `TREE_BEHAVIOURS`.
            */
            behaviours: TREE_BEHAVIOURS,
            // Not in the tree, which gives every card one box: a resize there would change nothing on
            // screen, and its handles would sit over the card's reaction badge on the same edge.
            resizable: { $: `!${TREE_ON}` },
            /*
              `CANVAS_EXPR` parenthesised: it is a ternary itself, and a ternary binds to the right, so
              pasted in bare it answered with the canvas's own `ad4m://` address whenever there was a
              canvas — the workshop's canvas once said a call's id the same way. Drawn as an invitation,
              with the workshop's gradient, since neither sentence is a dead end.
            */
            empty: {
              $: `(${CANVAS_EXPR}) ? 'Nothing on this canvas yet. Double-click anywhere to add a card, or start a call: what it commits to appears here on its own.' : 'This space has no canvas of its own. Spaces made with a starter kit have one.'`,
            },
            emptyIcon: 'squares-four',
            emptyGradient: 'accent',
            ...canvasEditing({
              canvas: CANVAS,
              // Read old against new in the inspector beside the canvas, as the workshop does.
              onReview: inspect('event.recordId', { $: 'event.recordType' }),
            }),
            // A drag in the tree writes the structure the layout reads, not a coordinate it then
            // erases — and the spine goes with it, which only the reader knows. See `treeArrange`.
            onNodeArrange: treeArrange(CANVAS),
            // Who answered with the reaction the tree is weighed by, for the strip's list of voices.
            onSeedSummary: TREE_VOICE_SUMMARY,
            onCanvasDoubleClick: askWhatGoesHere(CANVAS),
            onNodeDoubleClick: { $invoke: 'routeStore.navigate', args: [{ $: RECORD_PAGE }] },
            // A card opens in the inspector beside the canvas, which selects what the inspector shows.
            onNodeClick: OPEN_IN_INSPECTOR,
            focus: { $: 'routeStore.params.card' },
          },
        },
        // Social DNA, over the canvas, which stays mounted beneath so coming back to it is instant.
        {
          type: '$if',
          props: {
            condition: { $: ON_DNA },
            then: dnaMap,
          },
        },
        /*
          How the canvas is read: the mode, and what the tree is made of. In the canvas's own corner
          rather than a panel, because a panel can be closed and this is the only way out of the
          mode — the viewBar ends above the box this strip is absolute inside, so it wants no `below`.
        */
        treeStrip(),
      ],
    },
    recordFormModal({ back: BACK_TO_CHOOSER, entityPicker: false, iconColor: kindGlyph }),
    newThingChooser(CANVAS),
    newNoteModal(CANVAS),
  ],
};
