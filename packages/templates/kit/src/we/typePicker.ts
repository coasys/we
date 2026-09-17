import { sectionLabel } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

export interface TypePickerOptions {
  /** What choosing a kind does. `kind` is an expression naming the chosen entry — `{ label, value, via, … }`. */
  pick: (kind: string) => SchemaProp;
  /** The kinds, as an expression. Defaults to `recordStore.creatableEntities`. */
  items?: string;
  /** Entity names to put first within their section, in this order — tasks and events on a canvas. */
  lead?: string[];
  /**
   * The colour a kind is drawn in, as an expression over `kind` — its icon's colour. Omit for the
   * ordinary text colour. A canvas passes the colour its key gives the kind, so the two agree.
   */
  fill?: (kind: string) => string;
  /**
   * What a composed kind is called here — "Note" on a canvas, where a collection is a sticky note.
   * Defaults to the kind's own label ("Collection"), which is the class rather than the word.
   */
  composedLabel?: string;
  /** Its icon, likewise. */
  composedIcon?: string;
  /** The heading over the composed kind's section. Defaults to "Documents" — what a composed kind is. */
  composedHeading?: string;
  /** The `$localState` name the search text lives in. Declared here. */
  searchLocal?: string;
}

/**
 * "What would you like to make?" — every kind this space can create, as a grid of cards to search.
 *
 * ## Sections
 *
 * **Documents** first (a composed kind — a note, written in the composer), then **This space** (the
 * community's own types), then **Blocks** (WE's). A community that modelled its vocabulary means those types, so they
 * come before the built-ins. A section with nothing matching the search is left out, not drawn empty.
 *
 * ## Search
 *
 * Over each kind's name and description, case-insensitive, focused when the picker mounts. Enter takes
 * the first match in the order drawn, so a person who knows what they want types three letters and
 * presses Enter.
 *
 * ## Cards
 *
 * Icon, name and description, on a sunken ground so a card stands clearly apart from the modal it
 * sits in. Where the caller gives a kind's colour, the icon takes it — the same colour the canvas draws
 * that kind in, so the chooser reads as a key — on a raised disc, with no ring: colour on the glyph
 * alone says it, and outlines around cards and discs were noise around it.
 *
 * One fragment rather than one per surface, because a canvas's chooser, a record form's type selector
 * and a graph's add button all ask the same question of the same list. The caller says what a pick
 * does and what a composed kind is called there.
 */
/**
 * The picker's lists, as expressions — the matches for the search, each section, and every match in
 * the order drawn. Exported so they can be run in a test: they are strings, and nothing else would
 * notice one that parses and answers the wrong list.
 */
export function typePickerLists(opts: Pick<TypePickerOptions, 'items' | 'lead' | 'composedLabel' | 'searchLocal'>) {
  const items = opts.items ?? 'recordStore.creatableEntities';
  const search = opts.searchLocal ?? 'typeSearch';
  const composedLabel = opts.composedLabel ? `'${opts.composedLabel.replace(/'/g, "\\'")}'` : '';

  /** A kind's name as drawn, for the entry the expression `kind` names. */
  const nameOf = (kind: string) =>
    composedLabel ? `(${kind}.via == 'composer' ? ${composedLabel} : ${kind}.label)` : `${kind}.label`;
  const matches = `${items}.filter(k, contains(${nameOf('k')}, local.${search}) || contains(k.description, local.${search}))`;

  const composed = `${matches}.filter(k, k.via == 'composer')`;
  const own = `${matches}.filter(k, k.via != 'composer' && k.group == 'This space')`;
  const lead = `[${(opts.lead ?? []).map((name) => `'${name}'`).join(', ')}]`;
  const builtIn =
    `distinct(${lead}, ${matches}.map(k, k.value))` +
    `.filter(n, ${matches}.exists(k, k.value == n && k.via != 'composer' && k.group != 'This space'))` +
    `.map(n, find(${items}, { value: n }))`;
  /** Every match, in the order the sections draw them — what Enter picks the first of. */
  const drawnOrder = `distinct(${composed}, ${own}, ${builtIn})`;

  return { search, composedLabel, nameOf, matches, composed, own, builtIn, drawnOrder };
}

export function typePicker(opts: TypePickerOptions): SchemaNode {
  const { search, nameOf, matches, composed, own, builtIn, drawnOrder } = typePickerLists(opts);

  const card = (kind: string): SchemaNode => ({
    type: 'we-button',
    props: {
      variant: 'bare',
      width: '100%',
      height: '100%',
      ax: 'start',
      ay: 'start',
      p: '300',
      r: '300',
      bg: 'surface-sunken',
      /*
        A step lighter than the default border — part of the way to `border-strong`. On the sunken
        ground the default edge all but disappeared; the strong one draws a box around every card.
      */
      border: '1px solid color-mix(in srgb, var(--we-role-border) 65%, var(--we-role-border-strong))',
      hoverProps: { bg: 'surface-hover' },
      label: { $: nameOf(kind) },
      onClick: opts.pick(kind),
    },
    children: [
      {
        type: 'Row',
        props: { gap: '300', ay: 'start', width: '100%' },
        children: [
          {
            type: 'Column',
            props: {
              width: '36px',
              height: '36px',
              flexShrink: '0',
              r: 'full',
              ax: 'center',
              ay: 'center',
              bg: 'surface-raised',
            },
            children: [
              {
                type: 'we-icon',
                props: {
                  name: {
                    $: `${kind}.via == 'composer' ? '${opts.composedIcon ?? 'note'}' : ${kind}.icon ? ${kind}.icon : 'cube'`,
                  },
                  color: opts.fill ? { $: opts.fill(kind) } : 'text',
                },
              },
            ],
          },
          {
            type: 'Column',
            props: { gap: '100', flex: '1', minWidth: '0' },
            children: [
              {
                type: 'we-text',
                props: { variant: 'label' },
                children: [{ $: nameOf(kind) }],
              },
              {
                type: '$if',
                props: {
                  condition: { $: `${kind}.description` },
                  then: {
                    type: 'we-text',
                    props: { variant: 'footnote', color: 'text-muted' },
                    children: [{ $: `${kind}.description` }],
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  });

  const section = (list: string, label?: string): SchemaNode => ({
    type: '$if',
    props: {
      condition: { $: `count(${list})` },
      then: {
        type: 'Column',
        props: { gap: '200', width: '100%' },
        children: [
          ...(label ? [sectionLabel({ label })] : []),
          {
            type: 'Grid',
            props: { minChildWidth: '220px', gap: '200', width: '100%' },
            children: [{ type: '$each', props: { items: { $: list }, as: 'kind' }, children: [card('kind')] }],
          },
        ],
      },
    },
  });

  return {
    type: 'Column',
    props: { gap: '400', width: '100%' },
    $localState: { [search]: { type: 'string', initial: '' } },
    children: [
      {
        type: 'we-input',
        props: {
          value: { $: `local.${search}` },
          placeholder: 'Search types…',
          autofocus: true,
          width: '100%',
          onInput: { $setLocal: search, value: { $: 'event.detail' } },
          onKeyDown: {
            $if: {
              condition: { $: `arg.detail.key == 'Enter' && count(${drawnOrder})` },
              then: opts.pick(`first(${drawnOrder})`),
            },
          },
        },
        children: [{ type: 'we-icon', slot: 'start', props: { name: 'magnifying-glass', color: 'text-muted' } }],
      },
      section(composed, opts.composedHeading ?? 'Documents'),
      section(own, 'This space'),
      section(builtIn, 'Blocks'),
      {
        type: '$if',
        props: {
          condition: { $: `!count(${matches})` },
          then: {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-muted' },
            children: [{ $: `'Nothing matches "' + local.${search} + '"'` }],
          },
        },
      },
    ],
  };
}
