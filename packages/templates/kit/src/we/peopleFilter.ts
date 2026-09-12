import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { peopleRow } from './peopleRow.ts';

/** How a surface draws what nobody chosen is on. `rows` is for a board; a list has nothing to lay out. */
export type PeopleFilterMode = 'dim' | 'hide' | 'rows';

export interface PeopleFilterOptions {
  /** The `array` local holding the chosen DIDs. Declared by the caller, since what it filters reads it too. */
  people: string;
  /** The `string` local holding the mode — `dim`, `hide` or `rows`. Declared by the caller. */
  show: string;
  /** The modes offered, in order. Defaults to dimming and hiding. */
  modes?: PeopleFilterMode[];
  /** How many things the chosen people are on, as an expression — the "3" in "3 of 11". */
  matched: SchemaProp;
  /** How many things there are — the "11". */
  total: SchemaProp;
  /** What the things are, singular, for the readout: "task". */
  noun: string;
  /** The plural, when it is not `${noun}s`. */
  nounPlural?: string;
}

const MODE_ENTRIES: Record<PeopleFilterMode, { label: string; icon: string }> = {
  dim: { label: 'Dim others', icon: 'circle-half' },
  hide: { label: 'Hide others', icon: 'eye-slash' },
  rows: { label: 'Row per person', icon: 'rows' },
};

/**
 * Narrow a surface to what some members are on — a menu of the space's members, searchable, with the
 * way the rest are drawn chosen above them.
 *
 * ## One control on every surface that has one
 *
 * The kanban and the calendar both have it, and they must agree about what "dim" and "hide" mean and
 * where the choice is made; two hand-written menus is how the marketplace browsers drifted apart. So
 * the fragment ships with its second caller, which the extraction rule allows when the alternative is
 * a divergence waiting to happen.
 *
 * ## Dim first
 *
 * Dimming is the default and is listed first. A filtered board keeps its shape — every column still
 * shows how loaded it is, which hiding cannot — and on a board it is also the mode in which dragging
 * is exactly what it was without a filter.
 *
 * ## Where the state lives is the caller's decision
 *
 * The chosen people are view state a link should carry — "look at what Ana is on" — so a caller
 * declares that local with `syncParam`. The mode is a preference a link should not impose, so it is
 * declared with `persist`. The fragment only names the two locals; it declares neither, because the
 * surface being filtered reads both.
 *
 * ## The readout
 *
 * A dimmed surface looks almost like an unfiltered one, and a filter somebody forgot they left on is
 * a bug report. So whenever anybody is chosen the faces and "3 of 11 tasks" sit beside the menu in
 * every mode, with a way to clear it.
 */
export function peopleFilter(opts: PeopleFilterOptions): SchemaNode {
  const people = `local.${opts.people}`;
  const show = `local.${opts.show}`;
  const chosen = `count(${people})`;
  const modes = opts.modes ?? ['dim', 'hide'];

  return {
    type: 'Row',
    props: { gap: '300', ay: 'center', wrap: true },
    children: [
      {
        type: 'DropdownMenu',
        props: {
          triggerIcon: 'users',
          triggerLabel: { $: `${chosen} ? \`\${${chosen}} \${plural(${chosen}, 'person', 'people')}\` : 'People'` },
          triggerVariant: { $: `${chosen} ? 'secondary' : 'ghost'` },
          size: 'sm',
          placement: 'bottom-start',
          searchable: true,
          searchPlaceholder: 'Find a member',
          items: [
            {
              type: 'group',
              id: 'show',
              label: 'Show',
              collapsible: false,
              // A mode entry carries `mode`, which is how the one handler below tells it from a person.
              items: modes.map((mode) => ({
                id: `mode-${mode}`,
                mode,
                label: MODE_ENTRIES[mode].label,
                icon: MODE_ENTRIES[mode].icon,
                selected: { $: `${show} == '${mode}'` },
              })),
            },
            { type: 'divider' },
            {
              type: 'group',
              id: 'people',
              label: 'Members',
              collapsible: false,
              items: {
                $: `spaceStore.members.map(m, { type: 'toggle', id: m.did, label: m.did == me.did ? m.name + ' (you)' : m.name, checked: m.did in ${people} })`,
              },
            },
          ],
          /*
            One handler for both halves. A mode is chosen, a person is toggled — and a toggle reports
            before its tick changes, so `$toggleLocalIn` is exactly right: it adds what is absent and
            removes what is present, reading the set when the press lands.
          */
          onSelect: [
            {
              $if: {
                condition: { $: 'arg.mode' },
                then: { $setLocal: opts.show, value: { $: 'arg.mode' } },
                else: { $toggleLocalIn: opts.people, value: { $: 'arg.id' } },
              },
            },
          ],
        },
      },
      {
        type: '$if',
        props: {
          condition: { $: chosen },
          then: {
            type: 'Row',
            props: { gap: '300', ay: 'center' },
            children: [
              peopleRow({ items: { $: people }, dids: true, max: 5, size: 'xs', minHeight: '24px' }),
              {
                type: 'we-text',
                props: {
                  variant: 'footnote',
                  color: 'text-muted',
                  whiteSpace: 'nowrap',
                  text: {
                    $: `\`\${${(opts.matched as { $: string }).$}} of \${${(opts.total as { $: string }).$}} \${plural(${(opts.total as { $: string }).$}, '${opts.noun}', '${opts.nounPlural ?? `${opts.noun}s`}')}\``,
                  },
                },
              },
              {
                type: 'we-tooltip',
                props: { content: 'Show everyone’s again' },
                children: [
                  {
                    type: 'we-button',
                    props: {
                      variant: 'ghost',
                      size: 'xs',
                      square: true,
                      label: 'Clear the people filter',
                      onClick: { $setLocal: opts.people, value: [] },
                    },
                    children: [{ type: 'we-icon', props: { name: 'x' } }],
                  },
                ],
              },
            ],
          },
        },
      },
    ],
  };
}
