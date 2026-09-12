/**
 * The workshop's key — what the colours on its cards mean, and where they are decided.
 *
 * Three ways a card can be coloured, in layers:
 *
 * - **By kind.** Every task one colour, every event another. The community's own mapping, held on
 *   the space (`Space.typeStyles`) and edited from the key, so a canvas made tomorrow starts out
 *   coloured like every other one. On by default — it is the reading the template had before the
 *   key existed.
 * - **By state.** A task takes its state's colour, from the vocabulary the community already keeps in
 *   Settings. Everything without a state shares one plain colour. Off by default.
 * - **Freeform.** The colour somebody gave one card in the inspector, saved on its placement. The
 *   base: it shows when both lenses are off, and comes back untouched when they are turned off
 *   again. A lens that left individually coloured cards in their own colours would be a key that
 *   lied about some of them.
 *
 * With both lenses on, state wins for a task and kind answers for the rest.
 *
 * Underneath all three, and not a lens at all: **the canvas itself** — what a card with no other
 * colour is drawn in, and the ground behind them. Both were constants in the template, which made
 * the one colour every canvas certainly shows the only colour nobody could change. They are the
 * key's top two rows now, held as `TypeStyle` rows on the space like everything else here — see
 * `CARD_KEY`.
 *
 * ## The lenses live in the address
 *
 * The key is a **panel**, and a panel is drawn outside the route tree — so it and the canvas cannot
 * share a `$localState`, for the reason the inspector reads `?card=` rather than a local. The one
 * thing both can see is the address, and a lens is view state besides: send somebody a canvas
 * coloured by state and they should arrive looking at it coloured by state. `?colour=` holds it,
 * absent meaning the default, so an ordinary link stays clean.
 *
 * ## Rules from data, not from the seed
 *
 * The graph's `canvas` seed can read a canvas's `TypeStyle`s itself and stamp them onto each node.
 * This template does not ask it to: the key is the *space's*, it is wanted on the tasks and events
 * pages as much as the canvas, and a mapping the seed swallowed would be one only the graph could
 * see. So the template queries the records and builds the graph's style rules from them with an
 * expression — the shape the graph section already uses for edges — and the same query answers a
 * task card's fill on the board. One policy, two spellings, kept here so they cannot disagree.
 */
import type { ExpressionToken, SchemaNode, SchemaProp } from '@we/schema-shared';
import { anchorScope, panelHeader, panelScroll, sectionLabel, stateFill, stateIcon } from '@we/template-kit';

/** The query parameter the lenses ride in — `kind`, `state`, `kind,state` or `none`. */
export const LENS_PARAM = 'colour';

/**
 * What the address says, with absent meaning the default. A ternary rather than `??`, because the
 * switcher carries the parameter from page to page and an empty one must read as the default too.
 */
const LENS = `(routeStore.params.${LENS_PARAM} ? routeStore.params.${LENS_PARAM} : 'kind')`;

/** Whether each lens is on — expressions, readable wherever the address is. */
export const BY_KIND = `contains(${LENS}, 'kind')`;
export const BY_STATE = `contains(${LENS}, 'state')`;
export const NO_LENS = `!(${BY_KIND} || ${BY_STATE})`;

/**
 * The lens parameter, ready to append to a query string the template builds — empty when the
 * address holds none. Every navigation this template makes spells its query out in full, and an
 * explicit `?` drops whatever the address held, so each one has to carry this or the lens is lost
 * on the first click between pages.
 */
export const LENS_QUERY = `\${routeStore.params.${LENS_PARAM} ? '&${LENS_PARAM}=' + routeStore.params.${LENS_PARAM} : ''}`;

/**
 * Turn one lens on or off, leaving the other as it is.
 *
 * Writes the parameter rather than a local, for the reason above. The result that equals the default
 * is written as nothing at all, so a reader who turns state on and off again is back at the address
 * they started with — and `none` is the one value that has to be spelt, since absent already means
 * something.
 */
export function toggleLens(lens: 'kind' | 'state'): SchemaProp {
  const other = lens === 'kind' ? 'state' : 'kind';
  const on = `contains(${LENS}, '${lens}')`;
  const otherOn = `contains(${LENS}, '${other}')`;
  // Both on is always spelt `kind,state`, so the same reading is the same address.
  const both = "'kind,state'";
  const onlyOther = other === 'kind' ? "''" : `'${other}'`;
  const onlyThis = lens === 'kind' ? "''" : `'${lens}'`;
  return {
    $action: 'routeStore.setParam',
    args: [LENS_PARAM, { $: `${on} ? (${otherOn} ? ${onlyOther} : 'none') : (${otherOn} ? ${both} : ${onlyThis})` }],
  };
}

/**
 * The community's key, as a query. Declare it on whatever reads it — each route, and each panel —
 * since local scope resets at a `$routes` outlet and a panel cannot see a route's locals at all.
 *
 * `when`, because an unresolved anchor is pruned rather than refused and pruning widens: without it
 * the first frame would ask for every `TypeStyle` in the dataset, each canvas's own included.
 */
export const TYPE_STYLES_QUERY = {
  entity: 'TypeStyle',
  scope: { anchor: 'Space', via: 'typeStyles', anchorId: { $: 'spaceStore.currentSpace.id' } },
  limit: 50,
  when: { $: 'spaceStore.currentSpace.id' },
};

/**
 * Where the cards of one call sit, and what colour each was given — for the pages that are not the
 * canvas, which have no seed to read a placement for them. Gated like the key: an anchor that has
 * not resolved would otherwise read every placement in the space.
 */
export function placementsQuery(call: Record<string, unknown>) {
  // Ordered by kind, which is what lets the key list each kind once with the `$prev` grouping.
  return { entity: 'Placement', scope: anchorScope(call), order: { nodeType: 'asc' }, limit: 200, when: call };
}

/*
 * Every colour the key handles is a **CSS value** rather than a token name, because the picker emits
 * CSS — a `var(--we-color-…)` from its token grid, a literal from its custom tab — and the space
 * stores what the picker emitted. So the defaults below are written in the same form, and one string
 * reaches a graph rule, a `bg` and the picker's own swatch without anything translating between
 * them.
 */

/**
 * What a kind is drawn in before the community says otherwise — the template's own opinion, and the
 * fallback the key shows beside a kind nobody has coloured.
 *
 * Absolute colours, not roles, for the reason `STATE_FILLS` sets out at length in the kit: these
 * were `accent-muted` and `warning-surface`, which are tinted panels defined *relative to the page*
 * and so invert with it — in a dark theme an event card came out darker than an uncoloured one and
 * four points off the canvas's own ground. A card is an object rather than a panel, and the post-it
 * below already said so in a hex. These are the same claim for the other two, in the same spelling.
 *
 * Chosen rather than derived, like the states', and readable together: blue, pink and yellow are
 * three hues apart at a glance, which is the whole job of a colour that means "kind of thing".
 */
export const KIND_DEFAULTS: Record<string, string> = {
  TaskBlock: '#86c2ff',
  EventBlock: '#ff94f7',
  // The post-it. A literal rather than a role on purpose: a note is yellow in a dark theme too, and
  // the card's ink follows the fill's lightness rather than the theme's, so it stays readable.
  CollectionBlock: '#ffea9f',
};

/**
 * What a kind is called and drawn with, here and in the inspector — one answer, so the two panels
 * on the same edge cannot call one card two different things.
 *
 * `CollectionBlock` is overridden because its display says "Collection", which is the class read
 * back rather than the word anybody uses: on this canvas one of them is a note. The fallback past
 * it is the model's own name, for a kind nothing has a display for at all.
 */
export function kindLabel(kind: string): string {
  return `(${kind} == 'CollectionBlock' ? 'Note' : recordStore.displays[${kind}].label ? recordStore.displays[${kind}].label : ${kind})`;
}

export function kindIcon(kind: string): string {
  return `(${kind} == 'CollectionBlock' ? 'note' : recordStore.displays[${kind}].icon)`;
}

/**
 * The colour every card starts from — and the whole of a card's colour when no lens is on.
 *
 * A step on the neutral ramp rather than the surface role: a card is a thing *on* the surface, and
 * one drawn in the surface's own colour disappears into a board whose ground is a surface too. The
 * step follows the theme's polarity, and the card's ink follows the step.
 *
 * The template's opinion, and the floor the community's own choice sits on — see `CARD_KEY`.
 */
const PLAIN = 'var(--we-color-neutral-200)';
export const PLAIN_FILL = PLAIN;

/** What the canvas's ground is before the community says otherwise — the page it is drawn on. */
export const CANVAS_DEFAULT = 'var(--we-role-page)';

/**
 * The two colours in the key that are not about a *kind* of thing: what a card with no other colour
 * is drawn in, and what the canvas behind them is.
 *
 * Held as `TypeStyle` rows on the space like every other colour here, under a name no entity can
 * have. A `TypeStyle` is already "a colour the community keeps on its space under a name", which is
 * exactly what these two are — and storing them the same way means they arrive in the same
 * subscription, clear the same way (`setSpaceTypeColor` with an empty colour deletes the row), and
 * need no field on `Space`, no store action and no migration for two more colours.
 *
 * The `@` is what keeps them out of everything that reads the key *as* a key. A model name is a bare
 * identifier, so nothing can collide with these; `KEY_RESERVED` below is how the graph's per-kind
 * rules leave them alone rather than emitting a rule matching a type called `@card`.
 */
export const CARD_KEY = '@card';
export const CANVAS_KEY = '@canvas';

/** The space's colour for one of the keys above, as an expression. Reads `local.typeStyles`. */
const spaceColor = (key: string) => `find(local.typeStyles, { nodeType: '${key}' }).color`;

/** Whether the community has chosen one — so there is something for a reset to take away. */
export const cardColorChosen = spaceColor(CARD_KEY);
export const canvasColorChosen = spaceColor(CANVAS_KEY);

/**
 * What a card with no other colour is drawn in: the community's choice, else the template's.
 *
 * An expression rather than `PLAIN_FILL` wherever a card's colour is *decided* — the key's own rows,
 * the graph's base rule — so recolouring the plain card recolours every reading of it at once.
 */
export const CARD_FILL = `(${cardColorChosen} ? ${cardColorChosen} : '${PLAIN}')`;

/** The same for the canvas's ground, which the graph takes as a `bg`. */
export const CANVAS_FILL = `(${canvasColorChosen} ? ${canvasColorChosen} : '${CANVAS_DEFAULT}')`;

/** The key's rows that are not kinds, for the per-kind rules to skip. */
const KEY_RESERVED = `['${CARD_KEY}', '${CANVAS_KEY}']`;

/** The default fill for a kind, as an expression over `kind`. */
export function kindDefaultFill(kind: string): string {
  return Object.entries(KIND_DEFAULTS).reduceRight(
    (rest, [name, color]) => `(${kind} == '${name}' ? '${color}' : ${rest})`,
    CARD_FILL,
  );
}

/** The community's colour for a kind, else the template's default. Reads `local.typeStyles`. */
export function kindFill(kind: string): string {
  const chosen = `find(local.typeStyles, { nodeType: ${kind} }).color`;
  return `(${chosen} ? ${chosen} : ${kindDefaultFill(kind)})`;
}

/*
 * `stateFill` and `stateIcon` were here, each a chain over `semantic` written out by hand — and each
 * disagreeing with the one Settings → Vocabulary drew the same states with. They are
 * `@we/template-kit`'s now, read by both, which is also what lets the picker below and the edit form
 * over there show the same default.
 */

/*
 * There was a `recordFill` here, and a `freeformFill` under it — the same policy spelt for a card
 * that is a `Column` with a `bg` rather than a graph node. Both are gone with the board's and the
 * calendar's colours; see the board's card for why those went.
 *
 * Worth knowing that the canvas never used either. It is a graph, so all three layers reach it as
 * `nodeStyle` rules (below) — `kindFill`, `stateFill`, and the card's own colour as
 * `data.canvasColor`, which the `canvas` seed stamps onto each node from its `Placement`. So the
 * key still has three layers and a reader can still colour a card; only the second spelling is
 * gone, along with the `placements` query it needed to read a placement the seed hands the canvas
 * for free.
 */

/**
 * The graph's colour rules, built from the address and the data.
 *
 * Splice these into a `nodeStyle` between the card's shape and the proposal fade. Each entry is an
 * expression answering a list of rules, which the graph flattens — so a lens that is off contributes
 * nothing, and the base rule's plain fill is what shows through. Reads `local.typeStyles`.
 */
export function lensNodeRules(): SchemaProp[] {
  const defaults = Object.entries(KIND_DEFAULTS)
    .map(([name, color]) => `{ when: { type: '${name}' }, style: { color: '${color}' } }`)
    .join(', ');
  return [
    /*
      The plain card, as the community set it — before any lens, since this is what a lens colours
      *over*. Unconditional: it is the base rule's fill made adjustable, so a canvas whose community
      has chosen nothing is exactly what it was.
    */
    { $: `[{ style: { color: ${CARD_FILL} } }]` },
    // By kind: the template's defaults, then the community's key in front of them.
    { $: `${BY_KIND} ? [${defaults}] : []` },
    /*
      The community's key. Filtered, because the same subscription carries the two rows that are not
      kinds — a rule matching a type called `@card` would match nothing, and be one more thing a
      reader of the style list has to work out is inert.
    */
    {
      $:
        `${BY_KIND} ? local.typeStyles.filter(s, !(s.nodeType in ${KEY_RESERVED}))` +
        `.map(s, { when: { type: s.nodeType }, style: { color: s.color } }) : []`,
    },
    // By state: one rule per state the community has, matched on the record's own field.
    {
      $: `${BY_STATE} ? spaceStore.taskStates.map(s, { when: { 'data.status': s.slug }, style: { color: ${stateFill('s')} } }) : []`,
    },
    // Freeform: the card's own colour, and only when nothing else claims the card.
    { $: `${NO_LENS} ? [{ style: { color: { from: 'data.canvasColor' } } }] : []` },
  ];
}

/**
 * How wide the mark at the start of a row is.
 *
 * The picker's own swatch variable, so every row of the key — a kind's, a state's, the canvas's two
 * — carries the same disc at the same size. There was a hand-drawn `Column` here for the rows that
 * could not be edited, at a different radius and a different border, and the difference said nothing
 * true: a state's colour is no less the community's for being part of its vocabulary.
 */
const MARK = '24px';

/**
 * The colour picker the rest of the app uses, at the key's scale.
 *
 * The same primitive the vocabulary picks a state's colour with, and for the same reason it offers
 * tokens first: a token from the grid keeps following the theme's hue and polarity, where a hex
 * pinned against a light theme is a hole in a dark one. The custom tab is there for the community
 * that wants exactly its own colour anyway.
 */
function picker(value: SchemaProp, pick: SchemaProp): SchemaNode {
  return {
    type: 'we-color-picker',
    props: {
      tokens: true,
      value,
      onChange: pick,
      // The picker's own size variable; its default is a form-field swatch, and a row wants a disc.
      styles: { '--we-color-picker-swatch': MARK },
    },
  };
}

/**
 * The way back to the default, at the end of the row it belongs to.
 *
 * A separate control rather than an empty swatch in the picker's grid: a picker has no notion of
 * "none", and the default it goes back to is a rule's answer rather than a colour of its own.
 *
 * After the name, not before it. Leading the row it sat between the swatch and the glyph — two
 * marks and a control before the word that says what any of them are about — and it is the one
 * thing in the row that is *about* the row rather than part of reading it.
 *
 * `arrow-counter-clockwise`, which is the app's word for undoing to a previous state: an `x` here
 * reads as delete, and what this takes away is a choice, not the row.
 */
function resetButton(chosen: SchemaProp, clear: SchemaProp): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: chosen,
      then: {
        type: 'we-tooltip',
        props: { content: 'Back to the default' },
        children: [
          {
            type: 'we-button',
            props: { size: 'xs', variant: 'ghost', square: true, color: 'text-faint', onClick: clear },
            children: [{ type: 'we-icon', props: { name: 'arrow-counter-clockwise' } }],
          },
        ],
      },
    },
  };
}

export interface KeyRowOptions {
  /** The colour itself — the picker, at the key's scale. */
  mark: SchemaNode;
  /** The glyph before the name. An expression where the row comes from data; omitted draws none. */
  icon?: string | ExpressionToken;
  /** What this row is. */
  label: string | ExpressionToken;
  /** Shown at the end of the row — the reset, where there is something to reset. */
  trailing?: SchemaNode;
}

/**
 * One row of the key: a colour, what it is, and whatever can be done about it.
 *
 * One shape for every row — the two canvas colours, each kind, each state — so the panel reads as a
 * single list rather than as three lists with three spacings. The rows carry their own room above and
 * below rather than the lists spacing them; see `kindRows` for why that is load-bearing there.
 */
export function keyRow(opts: KeyRowOptions): SchemaNode {
  const glyph: SchemaNode = { type: 'we-icon', props: { size: 'xs', color: 'text-muted', name: opts.icon } };
  return {
    type: 'Row',
    props: { gap: '300', ay: 'center', width: '100%', py: '100' },
    children: [
      opts.mark,
      // A literal glyph is always there; one read from data is drawn only where there is one, since
      // a model that declares no icon would otherwise leave a gap the size of one in every row.
      ...(!opts.icon
        ? []
        : typeof opts.icon === 'string'
          ? [glyph]
          : [{ type: '$if', props: { condition: opts.icon, then: glyph } } as SchemaNode]),
      {
        type: 'we-text',
        props: { variant: 'label', truncate: true, flex: '1', minWidth: '0' },
        children: [opts.label],
      },
      ...(opts.trailing ? [opts.trailing] : []),
    ],
  };
}

/**
 * A lens's own switch, on the heading of the section it governs.
 *
 * It was a pair of buttons in the panel's header, which put the controls one place and what they did
 * another — and left both lists on screen whether or not either was colouring anything, so most of
 * the panel was a legend for a reading nobody had asked for. On the heading, the switch says what the
 * section below it *is* for, and the section is there only while it is on.
 *
 * Still the address, not a local: a panel and a route cannot share one, and a lens is view state —
 * see `toggleLens`. A switch reports only that it was flicked, which is all `toggleLens` needs.
 */
function lensSwitch(lens: 'kind' | 'state', label: string): SchemaNode {
  const on = lens === 'kind' ? BY_KIND : BY_STATE;
  return {
    type: 'we-tooltip',
    props: { content: `Colour cards by ${label}` },
    children: [
      {
        type: 'we-switch',
        props: {
          size: 'sm',
          label: `Colour cards by ${label}`,
          checked: { $: on },
          onChange: toggleLens(lens),
        },
      },
    ],
  };
}

/**
 * A section of the key that a lens turns on, with its switch on its own heading.
 *
 * `$if` rather than `$animate`: what is inside is a list of rows built from two subscriptions and
 * nothing in it is worth keeping mounted while it is off — and the panel is narrow, so a section
 * left in the DOM at zero height is a scroll region pretending to be shorter than it is.
 */
function lensSection(opts: {
  lens: 'kind' | 'state';
  label: string;
  /** What this lens colours and how far the colours reach, behind the heading's info glyph. */
  help?: string;
  aside?: SchemaNode;
  body: SchemaNode;
}): SchemaNode {
  const on = opts.lens === 'kind' ? BY_KIND : BY_STATE;
  return {
    type: 'Column',
    props: { gap: '300', width: '100%' },
    children: [
      sectionLabel({
        label: opts.label,
        ...(opts.help ? { help: opts.help } : {}),
        aside: {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            ...(opts.aside ? [{ type: '$if', props: { condition: { $: on }, then: opts.aside } } as SchemaNode] : []),
            lensSwitch(opts.lens, opts.lens),
          ],
        },
      }),
      {
        type: '$if',
        props: {
          condition: { $: on },
          enterTransition: [
            { type: 'reveal', duration: 200 },
            { type: 'fade', duration: 150 },
          ],
          then: opts.body,
        },
      },
    ],
  };
}

/**
 * The colours that are not about a kind of thing: the plain card, and the ground behind them.
 *
 * Above the lenses because they are underneath them — what a canvas looks like before anybody says
 * anything about kinds or states — and because neither is a reading that can be turned off. The
 * plain fill was a constant in the template until now, which made the one colour every canvas
 * certainly shows the only one nobody could change.
 */
const canvasRows: SchemaNode = {
  type: 'Column',
  // No gap: the rows carry their own room, as every other list in the panel does.
  props: { width: '100%' },
  children: [
    keyRow({
      mark: picker(
        { $: CARD_FILL },
        {
          $action: 'recordStore.setSpaceTypeColor',
          args: [{ $: 'spaceStore.currentSpace.id' }, CARD_KEY, { $: 'event.detail' }],
        },
      ),
      icon: 'square',
      label: 'Cards',
      trailing: resetButton(
        { $: cardColorChosen },
        {
          $action: 'recordStore.setSpaceTypeColor',
          args: [{ $: 'spaceStore.currentSpace.id' }, CARD_KEY, ''],
        },
      ),
    }),
    keyRow({
      mark: picker(
        { $: CANVAS_FILL },
        {
          $action: 'recordStore.setSpaceTypeColor',
          args: [{ $: 'spaceStore.currentSpace.id' }, CANVAS_KEY, { $: 'event.detail' }],
        },
      ),
      icon: 'frame-corners',
      label: 'Background',
      trailing: resetButton(
        { $: canvasColorChosen },
        {
          $action: 'recordStore.setSpaceTypeColor',
          args: [{ $: 'spaceStore.currentSpace.id' }, CANVAS_KEY, ''],
        },
      ),
    }),
  ],
};

/**
 * One kind, with the picker that sets its colour for the whole space.
 *
 * `kind` is an expression naming the kind, because the rows come from two lists bound to different
 * names — see `kindRows`.
 */
function kindRow(kind: string): SchemaNode {
  return keyRow({
    mark: picker(
      { $: kindFill(kind) },
      {
        $action: 'recordStore.setSpaceTypeColor',
        args: [{ $: 'spaceStore.currentSpace.id' }, { $: kind }, { $: 'event.detail' }],
      },
    ),
    icon: { $: kindIcon(kind) },
    label: { $: kindLabel(kind) },
    trailing: resetButton(
      { $: `find(local.typeStyles, { nodeType: ${kind} }).color` },
      {
        $action: 'recordStore.setSpaceTypeColor',
        args: [{ $: 'spaceStore.currentSpace.id' }, { $: kind }, ''],
      },
    ),
  });
}

/**
 * The kinds on this canvas, each once — not every kind the space has.
 *
 * Two lists make up "on the canvas". What extraction may write for this call, kept only where a
 * record of it exists, since a kind the call is listening for and has never produced is not on
 * anything. And whatever has been *placed*, which is how a note, a dropped record or a shape this
 * community defined gets here — listed by the placements' own `nodeType`, ordered so the `$prev`
 * grouping yields each kind once, and skipping the ones the first list already named.
 *
 * The first list asks one small query per kind, with the kind as the entity — the documented shape
 * for a type the template was not written for. Cheap: `limit: 1`, and there are a handful.
 */
function kindRows(opts: { call: Record<string, unknown>; extracted: string }): SchemaNode {
  return {
    type: 'Column',
    /*
      No `gap`. Each kind in the first list is wrapped in a node that holds its query, and that
      node renders whether or not the row inside it does — so a gap here spaced the empty ones as
      if they were rows, and every kind the call listens for but has not produced was a blank line.
      The rows carry their own room instead, and an empty wrapper is zero height and costs nothing.
    */
    props: { width: '100%' },
    children: [
      {
        type: '$each',
        props: { items: { $: opts.extracted }, as: 'kind' },
        children: [
          {
            type: 'Column',
            props: { width: '100%' },
            $queries: { found: { entity: { $: 'kind' }, scope: anchorScope(opts.call), limit: 1 } },
            children: [
              {
                type: '$if',
                props: {
                  condition: { $: 'count(local.found) || kind in local.placements.map(p, p.nodeType)' },
                  then: kindRow('kind'),
                },
              },
            ],
          },
        ],
      },
      {
        type: '$each',
        props: { items: { $: 'local.placements' }, as: 'placement' },
        children: [
          {
            type: '$if',
            props: {
              condition: {
                $: `placement.nodeType != prev.nodeType && !(placement.nodeType in (${opts.extracted}))`,
              },
              then: kindRow('placement.nodeType'),
            },
          },
        ],
      },
      {
        type: '$if',
        props: {
          condition: { $: `!count(local.placements) && !count(${opts.extracted})` },
          then: {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-faint', py: '100' },
            children: ['Nothing on the canvas yet. Double-click it to add something.'],
          },
        },
      },
    ],
  };
}

/**
 * What a pick and a reset on a state row write.
 *
 * By slug, because that is how `updateTaskState` addresses a state: the three a space starts with
 * are *virtual* until somebody acts on one, and colouring "To do" is one of the acts that writes it
 * down. An empty colour clears the field rather than storing an empty one, which is what takes the
 * state back to the template's default without deleting anything.
 */
const setStateColor = (color: SchemaProp): SchemaProp => ({
  $action: 'spaceStore.updateTaskState',
  args: [{ $: 'state.slug' }, { color }],
});

/**
 * One state, with the picker that sets its colour for the whole space.
 *
 * The same row as a kind's, and now the same control: mark, glyph, name, reset. It was read-only,
 * on the argument that a state's colour is the vocabulary's and the vocabulary is where it is set —
 * true, and the vocabulary had no way to set it. A colour could be given to a state only at the
 * moment it was created, so the three a space starts with could never have one at all.
 *
 * So: the picker here, and a real edit form in Settings → Vocabulary for the rest of what a state is
 * — its name, its glyph, what it counts as. Both write the same field on the same record, and the
 * `Edit` link above still leads to the one that can do more.
 *
 * Where the two rows genuinely differ is what they write. A kind's colour is a `TypeStyle` that
 * exists for nothing else, so it changes what a canvas draws and nothing more. A state's colour is
 * part of the community's vocabulary: a board's column heading takes it too. That is the point
 * rather than a leak — a state is one thing wherever it is shown — but it is why this row's help
 * says so out loud.
 */
const stateRow: SchemaNode = keyRow({
  mark: picker({ $: stateFill('state') }, setStateColor({ $: 'event.detail' })),
  icon: { $: stateIcon('state') },
  label: { $: 'state.name' },
  // A state nobody has coloured has nothing to reset: its fill is the template's, and the row would
  // otherwise offer to undo a choice that was never made. Same rule as a kind's.
  trailing: resetButton({ $: 'state.color' }, setStateColor('')),
});

/**
 * Whether the page the key is describing is on screen.
 *
 * The colours are the canvas's now — the board and the calendar draw plain cards — so the lenses and
 * the legend answer nothing on the other two pages.
 */
const ON_CANVAS = "'canvas' in routeStore.segments";

/**
 * The key, as a panel.
 *
 * A panel rather than a column floated inside the route, which is what the graph section's key is:
 * it has to be closable, has to survive moving between the three pages, and competes for the right
 * edge with the inspector and the calls list — the three tests the panel contract sets. The
 * floating version had to build its own dock, transition and pointer-events dance; a panel gets
 * dragging, resizing and layout memory from the host for nothing.
 *
 * Its own subscription, because a panel cannot read the root's. Cheap: fifty rows at most, and only
 * while the panel is open.
 *
 * ## Its contents are scoped to the canvas, and the panel is not
 *
 * `route: 'canvas'` on the `meta.panels` entry would be the obvious spelling and it is the wrong
 * one, for the reason the transcript and the readout are unscoped too: leaving the route
 * *unregisters* the panel, so its scroll position and both of these subscriptions are destroyed and
 * rebuilt on the way back. The declaration is what a panel *is*; whether it has anything to say
 * today is a question about its contents.
 *
 * So the panel is declared everywhere and branches inside. The subscriptions stay live across a
 * page change, which is what makes crossing back instant, and they are the two cheapest queries in
 * the template.
 */
export function keyPanel(opts: { call: Record<string, unknown>; extracted: string }): SchemaNode {
  return {
    type: 'Column',
    props: { width: '100%', height: '100%', p: '300', gap: '300', overflow: 'hidden' },
    // The key's own subscriptions: what is placed here, for the kinds list — see `kindRows`.
    $queries: { typeStyles: TYPE_STYLES_QUERY, placements: placementsQuery(opts.call) },
    children: [
      /*
        No aside. The lenses used to be a pair of buttons here — see `lensSwitch` for why each one is
        on the heading of the section it governs instead, which also leaves the header with nothing
        that has to be hidden off the canvas.
      */
      panelHeader({
        title: 'Key',
        help: 'What the colours on the cards of the canvas mean. Every card starts from the plain colour at the top; turn a lens on to colour cards by their kind or by their state, and with both off each card keeps the colour it was given in its header.',
      }),
      panelScroll({
        children: [
          {
            type: '$if',
            props: {
              condition: { $: ON_CANVAS },
              /*
                Said rather than shown blank, because the panel is reachable from all three pages and
                an empty one reads as a key that failed to load. One sentence naming where the
                colours are is the whole of it — the way back is the switcher two inches away, so
                this needs no button of its own.
              */
              else: {
                type: 'we-text',
                props: { variant: 'footnote', color: 'text-muted' },
                children: ['Colours are on the canvas. The board and the calendar draw every card plain.'],
              },
              then: {
                type: 'Column',
                props: { gap: '400', width: '100%' },
                children: [
                  // What a canvas is before any lens: the plain card, and the ground behind it.
                  {
                    type: 'Column',
                    props: { gap: '300', width: '100%' },
                    children: [
                      sectionLabel({
                        label: 'Canvas',
                        help: 'What a canvas looks like before anything else colours it: the fill of a card with no colour of its own, and the ground behind the cards. Both belong to the whole space, so every call in it opens looking the same.',
                      }),
                      canvasRows,
                    ],
                  },
                  lensSection({
                    lens: 'kind',
                    label: 'Kinds',
                    help: 'A colour per kind of thing on the canvas, kept on the space — so a canvas made tomorrow opens coloured like this one. It says nothing anywhere else.',
                    body: kindRows(opts),
                  }),
                  lensSection({
                    lens: 'state',
                    label: 'States',
                    /*
                      Said here because a state's colour reaches further than a kind's. A kind's is a
                      `TypeStyle` that exists to colour cards; a state's is part of the community's
                      vocabulary, so a board's column heading takes it too. That is a state being one
                      thing wherever it is shown rather than a leak, but somebody picking a colour on
                      a canvas should know where else it lands.
                    */
                    help: 'A colour per state, from the vocabulary this community keeps in Settings — so it is the same colour on a board\u2019s columns. Everything without a state keeps the plain card colour above.',
                    // The rest of what a state is — its name, its glyph, what it counts as — is
                    // Settings' to edit. Offered to whoever can change what every member sees.
                    aside: {
                      type: '$if',
                      props: {
                        condition: { $: 'spaceStore.canAdministerCurrentSpace' },
                        then: {
                          type: 'we-button',
                          props: {
                            size: 'xs',
                            variant: 'ghost',
                            onClick: { $action: 'shellStore.openSpaceSettings', args: ['vocabulary'] },
                          },
                          children: ['Edit'],
                        },
                      },
                    },
                    body: {
                      type: 'Column',
                      props: { width: '100%' },
                      children: [
                        {
                          type: '$each',
                          props: { items: { $: 'spaceStore.offeredTaskStates' }, as: 'state' },
                          children: [stateRow],
                        },
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-faint', pt: '200' },
                          children: ['Anything without a state stays plain.'],
                        },
                      ],
                    },
                  }),
                ],
              },
            },
          },
        ],
      }),
    ],
  };
}
