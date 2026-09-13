import type { SchemaNode, SchemaProp } from '@we/schema-shared';

/** How a surface draws what nobody chosen is on. `rows` is for a board; a list has nothing to lay out. */
export type PeopleFilterMode = 'dim' | 'hide' | 'rows';

export interface PeopleFilterOptions {
  /** The `array` local holding the chosen DIDs. Declared by the caller, since what it filters reads it too. */
  people: string;
  /** The `string` local holding the mode — `dim`, `hide` or `rows`. Declared by the caller. */
  show: string;
  /** The modes offered, in order. Defaults to dimming and hiding. */
  modes?: PeopleFilterMode[];
  /**
   * The people worth a face in the row, as a list of DIDs — whoever is on something this surface
   * shows, the viewer first. Everyone else in the space is behind the row's last chip.
   */
  faces: SchemaProp;
  /** How many faces the row draws before the rest collapse into a count. Defaults to six. */
  max?: number;
  /** How many things the chosen people are on, as an expression — the "3" in "3 of 11". */
  matched: SchemaProp;
  /** How many things there are — the "11". */
  total: SchemaProp;
  /** What the things are, singular, for the readout: "card". */
  noun: string;
  /** The plural, when it is not `${noun}s`. */
  nounPlural?: string;
}

const MODE_ENTRIES: Record<PeopleFilterMode, { label: string; short: string; icon: string }> = {
  dim: { label: 'Dim others', short: 'Dim', icon: 'circle-half' },
  hide: { label: 'Hide others', short: 'Hide', icon: 'eye-slash' },
  rows: { label: 'Row per person', short: 'Rows', icon: 'rows' },
};

const expression = (prop: SchemaProp) => (prop as { $: string }).$;

/**
 * Narrow a surface to what some people are on — a row of faces to press, and everyone else a search
 * away.
 *
 * ## Faces, not a menu
 *
 * Boards that filter by person have settled on a row of faces above the work: press one to narrow to
 * them, press again to let go. It is one press rather than two, and the row *is* the filter's state —
 * the chosen ringed, the rest faded — so there is nothing to open to find out what is on. What a row
 * cannot do is hold a large space, or say names; so it holds only the people on something here,
 * viewer first and at most `max` of them, and ends in a chip that opens every member with their face
 * and name, searchable. Somebody chosen from there joins the row while they are chosen, so the row
 * never stops showing the whole filter.
 *
 * ## The mode is its own control
 *
 * Dim, hide, or a row per person is a way of reading, not a choice of who — and most people only ever
 * press faces. So it sits apart, as a small menu labelled with the mode it is in. Dimming is the
 * default and first: a filtered board keeps its shape, and every column still says how loaded it is.
 *
 * ## One control on every surface that has one
 *
 * The kanban and the calendar both have it, and must agree about what "dim" means and where the
 * choice is made. The caller declares both locals: the people with `syncParam`, since "look at what
 * Ana is on" is a thing a link should carry; the mode with `persist`, since a link should not impose
 * a way of reading.
 *
 * ## Why every face is an `AvatarStack` of one
 *
 * A ring is a tone, and the tone-to-ring table is the design system's. A stack resolves it; a bare
 * `we-avatar` in a schema cannot. So a chosen face is ringed the way a chosen face is ringed anywhere.
 */
export function peopleFilter(opts: PeopleFilterOptions): SchemaNode {
  const people = `local.${opts.people}`;
  const show = `local.${opts.show}`;
  const chosen = `count(${people})`;
  const max = opts.max ?? 6;
  const faces = expression(opts.faces);
  const inline = `filter(${faces}, {}, ${max})`;
  const modes = opts.modes ?? ['dim', 'hide'];
  const profile = (did: string) => `find(profileStore.profiles, { did: ${did} })`;

  /** One face: press to choose or let go, ringed while chosen, faded while somebody else is. */
  const faceToggle = (did: string): SchemaNode => ({
    type: 'we-tooltip',
    props: { content: { $: `${did} == me.did ? 'You' : ${profile(did)}.name` } },
    children: [
      {
        type: 'we-button',
        props: {
          variant: 'bare',
          label: { $: `${did} == me.did ? 'You' : ${profile(did)}.name` },
          opacity: { $: `${chosen} && !(${did} in ${people}) ? 0.45 : 1` },
          transition: 'opacity 150 ease-in-out',
          hoverProps: { opacity: 1 },
          onClick: { $toggleLocalIn: opts.people, value: { $: did } },
        },
        children: [
          {
            type: 'AvatarStack',
            props: {
              size: 'sm',
              avatars: {
                $: `[{ image: ${profile(did)}.avatar, hash: ${did}, tone: ${did} in ${people} ? 'primary' : '' }]`,
              },
            },
          },
        ],
      },
    ],
  });

  return {
    type: 'Row',
    props: { gap: '400', ay: 'center', wrap: true },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [
          { type: '$each', props: { items: { $: inline }, as: 'face' }, children: [faceToggle('face')] },
          // Chosen from the full list and not already a face — so the row always shows the whole filter.
          {
            type: '$each',
            props: { items: { $: `${people}.filter(d, !(d in ${inline}))` }, as: 'face' },
            children: [faceToggle('face')],
          },
          {
            type: 'DropdownMenu',
            props: {
              triggerTitle: 'Everyone in this space',
              size: 'sm',
              itemSize: 'sm',
              placement: 'bottom-start',
              searchable: true,
              searchPlaceholder: 'Find a member',
              items: {
                $: `spaceStore.members.map(m, { type: 'toggle', id: m.did, label: m.did == me.did ? m.name + ' (you)' : m.name, checked: m.did in ${people}, avatar: { image: m.avatar, hash: m.did } })`,
              },
              // A toggle reports before its tick changes; `$toggleLocalIn` adds what is absent and removes what is present.
              onSelect: { $toggleLocalIn: opts.people, value: { $: 'arg.id' } },
            },
            children: [
              {
                type: 'Row',
                props: {
                  height: 'var(--we-avatar-size-sm)',
                  minWidth: 'var(--we-avatar-size-sm)',
                  px: '100',
                  r: 'pill',
                  ax: 'center',
                  ay: 'center',
                  bg: 'control-surface',
                  color: 'text-muted',
                  hoverProps: { color: 'text' },
                },
                children: [
                  {
                    type: '$if',
                    props: {
                      condition: { $: `count(${faces}) > ${max}` },
                      then: {
                        type: 'we-text',
                        props: {
                          fontSize: '100',
                          fontWeight: 'semibold',
                          text: { $: `'+' + (count(${faces}) - ${max})` },
                        },
                      },
                      else: { type: 'we-icon', props: { name: 'users-three', size: 'xs' } },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'DropdownMenu',
        props: {
          triggerIcon: 'sliders-horizontal',
          triggerLabel: {
            $: modes.reduceRight<string>(
              (rest, mode) => `${show} == '${mode}' ? '${MODE_ENTRIES[mode].short}' : ${rest}`,
              `'${MODE_ENTRIES[modes[0]].short}'`,
            ),
          },
          triggerVariant: 'ghost',
          triggerTitle: 'How the others are shown',
          size: 'sm',
          placement: 'bottom-start',
          items: modes.map((mode) => ({
            id: `mode-${mode}`,
            mode,
            label: MODE_ENTRIES[mode].label,
            icon: MODE_ENTRIES[mode].icon,
            selected: { $: `${show} == '${mode}'` },
          })),
          onSelect: { $setLocal: opts.show, value: { $: 'arg.mode' } },
        },
      },
      {
        type: '$if',
        props: {
          condition: { $: chosen },
          then: {
            type: 'Row',
            props: { gap: '200', ay: 'center' },
            children: [
              {
                type: 'we-text',
                props: {
                  variant: 'footnote',
                  color: 'text-muted',
                  whiteSpace: 'nowrap',
                  text: {
                    $: `\`\${${expression(opts.matched)}} of \${${expression(opts.total)}} \${plural(${expression(opts.total)}, '${opts.noun}', '${opts.nounPlural ?? `${opts.noun}s`}')}\``,
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
