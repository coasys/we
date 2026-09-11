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
import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { anchorScope, panelHeader, sectionLabel, swatchRow } from '@we/template-kit';

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
  return { entity: 'Placement', scope: anchorScope(call), limit: 200, when: call };
}

/**
 * What a kind is drawn in before the community says otherwise — the template's own opinion, and the
 * fallback the key shows beside a kind nobody has coloured. Roles, not scale positions: these are
 * the tinted panels the design system keeps legible in either polarity.
 */
export const KIND_DEFAULTS: Record<string, string> = {
  TaskBlock: 'accent-muted',
  EventBlock: 'warning-surface',
};

/** The colour every card starts from — and the whole of a card's colour when no lens is on. */
const PLAIN = 'surface';

/** The default fill for a kind, as an expression over `kind`. */
export function kindDefaultFill(kind: string): string {
  return Object.entries(KIND_DEFAULTS).reduceRight(
    (rest, [name, color]) => `(${kind} == '${name}' ? '${color}' : ${rest})`,
    `'${PLAIN}'`,
  );
}

/** The community's colour for a kind, else the template's default. Reads `local.typeStyles`. */
export function kindFill(kind: string): string {
  const chosen = `find(local.typeStyles, { nodeType: ${kind} }).color`;
  return `(${chosen} ? ${chosen} : ${kindDefaultFill(kind)})`;
}

/**
 * A state's fill: the colour the community picked for it, else a tint by what it counts as.
 *
 * The vocabulary's own fallback maps a semantic to a *text* role, which is right for the icon it was
 * written for and wrong as a fill — `success-text` behind a label is a label nobody can read. These
 * are the surface roles the same semantics carry elsewhere. Open is plain on purpose: it is the
 * unmarked state, and a board where "to do" is a colour is a board where everything is.
 */
export function stateFill(state: string): string {
  return (
    `(${state}.color ? ${state}.color : ` +
    `${state}.semantic == 'done' ? 'success-surface' : ` +
    `${state}.semantic == 'active' ? 'accent-muted' : ` +
    `${state}.semantic == 'blocked' ? 'warning-surface' : ` +
    `${state}.semantic == 'cancelled' ? 'surface-sunken' : '${PLAIN}')`
  );
}

/**
 * The colour one card was given on this call's canvas, else plain. Reads `local.placements`.
 *
 * `we:unset` is the value the canvas writes to take a colour away — the ORM cannot store an empty
 * string — and the graph seed drops it before a rule sees it; a row read straight off the query
 * has to drop it here.
 */
export function freeformFill(id: string): string {
  const own = `find(local.placements, { node: ${id} }).color`;
  return `((${own} && ${own} != 'we:unset') ? ${own} : '${PLAIN}')`;
}

/**
 * A record's fill under whatever lenses are on — for a task card on the board or an event row on
 * the calendar, where the card is a `Column` with a `bg` rather than a graph node.
 *
 * The same order the graph rules below resolve in: state for a record that has one, then kind, then
 * the card's own colour when nothing is on, else plain.
 */
export function recordFill(opts: { kind: string; id: string; status?: string }): SchemaProp {
  const byState = opts.status
    ? `${BY_STATE} && ${opts.status} ? ${stateFill(`find(spaceStore.taskStates, { slug: ${opts.status} })`)} : `
    : '';
  return {
    $: `${byState}${BY_KIND} ? ${kindFill(`'${opts.kind}'`)} : ${NO_LENS} ? ${freeformFill(opts.id)} : '${PLAIN}'`,
  };
}

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
    // By kind: the template's defaults, then the community's key in front of them.
    { $: `${BY_KIND} ? [${defaults}] : []` },
    { $: `${BY_KIND} ? local.typeStyles.map(s, { when: { type: s.nodeType }, style: { color: s.color } }) : []` },
    // By state: one rule per state the community has, matched on the record's own field.
    {
      $: `${BY_STATE} ? spaceStore.taskStates.map(s, { when: { 'data.status': s.slug }, style: { color: ${stateFill('s')} } }) : []`,
    },
    // Freeform: the card's own colour, and only when nothing else claims the card.
    { $: `${NO_LENS} ? [{ style: { color: { from: 'data.canvasColor' } } }] : []` },
  ];
}

/** A coloured disc — the key's mark beside a name. */
function disc(bg: SchemaProp): SchemaNode {
  return {
    type: 'Column',
    props: { width: '16px', height: '16px', r: '100', flexShrink: '0', bg, border: '1px solid border-strong' },
  };
}

/** One lens's switch, in the panel's header. */
function lensButton(lens: 'kind' | 'state', label: string, icon: string): SchemaNode {
  const on = lens === 'kind' ? BY_KIND : BY_STATE;
  return {
    type: 'we-tooltip',
    props: { content: `Colour cards by ${label.toLowerCase()}` },
    children: [
      {
        type: 'we-button',
        props: {
          size: 'sm',
          gap: '100',
          variant: { $: `${on} ? 'secondary' : 'ghost'` },
          onClick: toggleLens(lens),
        },
        children: [
          { type: 'we-icon', props: { name: icon } },
          { type: 'we-text', children: [label] },
        ],
      },
    ],
  };
}

/**
 * One kind, with its colour — and, opened, the palette that sets it.
 *
 * The rows come from data, so which are open is a set of names rather than a boolean each — the
 * same reason the sidebar holds its collapsed groups that way.
 */
const kindRow: SchemaNode = {
  type: 'Column',
  props: { gap: '200', width: '100%' },
  children: [
    {
      type: 'we-button',
      props: { variant: 'bare', width: '100%', onClick: { $toggleLocalIn: 'openKinds', value: { $: 'kind' } } },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', width: '100%' },
          children: [
            disc({ $: kindFill('kind') }),
            {
              type: '$if',
              props: {
                condition: { $: 'recordStore.displays[kind].icon' },
                then: {
                  type: 'we-icon',
                  props: { size: 'xs', color: 'text-muted', name: { $: 'recordStore.displays[kind].icon' } },
                },
              },
            },
            {
              type: 'we-text',
              props: { variant: 'label', truncate: true, flex: '1', minWidth: '0', textAlign: 'left' },
              children: [{ $: 'recordStore.displays[kind].label ? recordStore.displays[kind].label : kind' }],
            },
            {
              type: 'we-icon',
              props: {
                size: 'xs',
                color: 'text-faint',
                name: { $: "kind in local.openKinds ? 'caret-down' : 'caret-right'" },
              },
            },
          ],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'kind in local.openKinds' },
        enterTransition: [
          { type: 'reveal', duration: 200 },
          { type: 'fade', duration: 150 },
        ],
        then: swatchRow({
          // `''` rather than nothing, so the Default swatch is the one outlined for a kind nobody has
          // coloured — a comparison against undefined outlines none of them.
          current: { $: "find(local.typeStyles, { nodeType: kind }).color ?? ''" },
          pick: (token) => ({
            $action: 'recordStore.setSpaceTypeColor',
            args: [{ $: 'spaceStore.currentSpace.id' }, { $: 'kind' }, token],
          }),
        }),
      },
    },
  ],
};

/** One state, read-only: its colour is the vocabulary's, and the vocabulary is where it is set. */
const stateRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', width: '100%', py: '100' },
  children: [
    disc({ $: stateFill('state') }),
    {
      type: 'we-text',
      props: { variant: 'label', truncate: true, flex: '1', minWidth: '0' },
      children: [{ $: 'state.name' }],
    },
  ],
};

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
 */
export const keyPanel: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', p: '300', gap: '300', overflow: 'hidden' },
  $queries: { typeStyles: TYPE_STYLES_QUERY },
  $localState: { openKinds: { type: 'array', initial: [] } },
  children: [
    panelHeader({
      title: 'Key',
      help: 'What the colours on the cards mean. Turn a lens on to colour every card by its kind or by its state; with both off, each card keeps the colour it was given in the inspector.',
      aside: {
        type: 'Row',
        props: { gap: '100', ay: 'center' },
        children: [lensButton('kind', 'Kind', 'cube'), lensButton('state', 'State', 'circle-half')],
      },
    }),
    {
      type: 'we-scroll-area',
      props: { flex: '1', minHeight: '0', width: '100%' },
      children: [
        {
          type: 'Column',
          props: { gap: '400', width: '100%' },
          children: [
            {
              type: 'Column',
              props: { gap: '300', width: '100%', opacity: { $: `${BY_KIND} ? 1 : 0.6` } },
              children: [
                sectionLabel({ label: 'Kinds' }),
                {
                  type: '$if',
                  props: {
                    condition: { $: 'count(shapeStore.extractionCandidates)' },
                    then: {
                      type: '$each',
                      // What a call here can produce — every kind that could land on the canvas,
                      // whether or not this one has yet, since the colour is the space's.
                      props: { items: { $: 'shapeStore.extractionCandidates' }, as: 'kind' },
                      children: [kindRow],
                    },
                    else: {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-faint' },
                      children: ['Nothing here can be extracted yet.'],
                    },
                  },
                },
              ],
            },
            {
              type: 'Column',
              props: { gap: '300', width: '100%', opacity: { $: `${BY_STATE} ? 1 : 0.6` } },
              children: [
                sectionLabel({
                  label: 'States',
                  // The colours are the vocabulary's, so that is where they change — one editor per
                  // fact. Offered to whoever can change what every member sees.
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
                }),
                {
                  type: '$each',
                  props: { items: { $: 'spaceStore.offeredTaskStates' }, as: 'state' },
                  children: [stateRow],
                },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: ['Anything without a state stays plain.'],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
