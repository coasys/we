import type { SchemaNode, SchemaProp } from '@we/schema-shared';

export interface PeopleFilterOptions {
  /** The `array` local holding the chosen DIDs. Declared by the caller, since what it filters reads it too. */
  people: string;
  /**
   * The `string` local holding how cards nobody chosen is on are drawn — `dim` or `hide`. Declared by
   * the caller. Only asked once somebody is chosen, since with nobody chosen nothing is either.
   */
  show: string;
  /**
   * The `boolean` local holding whether the surface lays itself out a row per person. Declared by the
   * caller; omit on a surface that has no rows to lay out — a calendar.
   */
  grouped?: string;
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
 * ## Two choices, not one menu
 *
 * How the others are drawn, and whether the surface is laid out a row per person, used to be one menu
 * of three — dim, hide, rows — and it did not make sense. With nobody chosen, dim and hide do nothing
 * at all; with somebody chosen and rows on, rows already leave everyone else out, so dim and hide do
 * nothing there either. The menu offered a choice that only sometimes existed and never said when.
 *
 * So they are two controls, each shown where it means something. **Dim | Hide** is part of the
 * filter's own readout — "3 of 11 cards · Dim | Hide · ✕" — so it appears with somebody chosen and
 * leaves with them, and not while rows are on. Two named options rather than a switch, because a switch
 * called "Hide others" says nothing about what off is. Dimming is first and the default: a filtered
 * board keeps its shape, and every column still says how loaded it is. **Group by person** is a switch
 * of its own after the readout, since a layout is worth choosing whoever is chosen.
 *
 * ## One control on every surface that has one
 *
 * The kanban and the calendar both have it, and must agree about what "dim" means and where the
 * choice is made. The caller declares the locals: the people with `syncParam`, since "look at what
 * Ana is on" is a thing a link should carry; how others are drawn and whether rows are on with
 * `persist`, since a link should not impose a way of reading.
 *
 * ## Why every face is an `AvatarStack` of one
 *
 * A ring is a tone, and the tone-to-ring table is the design system's. A stack resolves it; a bare
 * `we-avatar` in a schema cannot. So a chosen face is ringed the way a chosen face is ringed anywhere.
 */
export function peopleFilter(opts: PeopleFilterOptions): SchemaNode {
  const people = `local.${opts.people}`;
  const chosen = `count(${people})`;
  const max = opts.max ?? 6;
  const faces = expression(opts.faces);
  const inline = `filter(${faces}, {}, ${max})`;
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
    // `500` between one control and the next, where each keeps its own parts at `200`: at `400` the
    // groups ran together, and a switch read as belonging to the words of the control before it.
    props: { gap: '500', ay: 'center', wrap: true },
    children: [
      /*
        The faces and what they are filtering to, as one control: "2 of 65 cards · Dim | Hide · ✕" is
        the readout of the faces beside it, so the two sit at `300` rather than at the `500` that
        separates one control from the next.
      */
      {
        type: 'Row',
        props: { gap: '300', ay: 'center', wrap: true },
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
              /*
                A tooltip of its own: the menu's title becomes a tooltip only for its built-in trigger,
                and this chip is a custom one — a count, or a people glyph, which says nothing on its own.
              */
              {
                type: 'we-tooltip',
                props: { content: 'Find a member' },
                children: [
                  {
                    type: 'DropdownMenu',
                    props: {
                      triggerTitle: 'Find a member',
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
            ],
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
                  /*
                Dim | Hide — only while it does something. Rows on means everyone else's cards are
                already out of the layout, so the choice would change nothing.
              */
                  opts.grouped
                    ? {
                        type: '$if',
                        props: { condition: { $: `!local.${opts.grouped}` }, then: showChoice(opts.show) },
                      }
                    : showChoice(opts.show),
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
      },
      ...(opts.grouped
        ? [
            labelledSwitch({
              icon: 'rows',
              label: 'Group by person',
              checked: `local.${opts.grouped}`,
              local: opts.grouped,
            }),
          ]
        : []),
    ],
  };
}

/**
 * A control's name in a header, shown only from the medium tier of the surface it is drawn in — a
 * board in a narrow docked panel or on a phone is exactly where four labelled controls crowd the row,
 * and a wide board has room to say what each one is. The icon beside it stays either way, and the
 * control's tooltip and accessible name carry the words when the text is gone.
 *
 * ## CSS, not a branch on `surface.tier`
 *
 * It was a `$if` on `surface.tier`, and the labels never appeared at any width. A tier read in an
 * expression is answered from JavaScript — a resize observer reading a sentinel's computed style — and
 * inside a route it was not answered at all until the route pass was given the surface; `mdUpProps`
 * is a container query, answered by the browser wherever there is a surface above, which is the
 * mechanism the design system asks for whenever what changes is a value rather than a tree.
 *
 * The gap before the word is the word's own margin rather than the row's `gap`, because a label at
 * `display: none` is still a flex item: a row gap would leave the space for it on a narrow header.
 * Callers put the icon and this in a row with no gap of its own.
 */
export function headerLabel(text: string, props: Record<string, unknown> = {}): SchemaNode {
  return {
    type: 'we-text',
    props: {
      variant: 'label',
      color: 'text-muted',
      whiteSpace: 'nowrap',
      display: 'none',
      mdUpProps: { display: 'inline', ml: '100' },
      ...props,
    },
    children: [text],
  };
}

/**
 * Dim | Hide, as two options with the chosen one filled — a segmented control, written as two
 * buttons since the design system has none. Each is an icon and, with room, its word; the tooltip
 * says what it does either way. Anything that is not `hide` reads as `dim`, the default, so a value
 * stored by the old menu (`rows`) lands somewhere sensible.
 */
function showChoice(show: string): SchemaNode {
  const option = (value: 'dim' | 'hide', icon: string, label: string, hint: string): SchemaNode => ({
    type: 'we-tooltip',
    props: { content: hint },
    children: [
      {
        type: 'we-button',
        props: {
          // `sm`, the size of the header's other controls: an `xs` button draws its icon at 12px, which
          // beside a 16px switch glyph read as a smaller, lesser control.
          size: 'sm',
          gap: '0',
          label,
          variant: {
            $:
              value === 'hide'
                ? `local.${show} == 'hide' ? 'secondary' : 'ghost'`
                : `local.${show} != 'hide' ? 'secondary' : 'ghost'`,
          },
          onClick: { $setLocal: show, value },
        },
        children: [{ type: 'we-icon', props: { name: icon } }, headerLabel(label, { color: 'inherit' })],
      },
    ],
  });
  return {
    type: 'Row',
    props: { gap: '050', ay: 'center', p: '050', r: '300', border: '1px solid border' },
    children: [
      option('dim', 'circle-half', 'Dim', 'Fade the cards nobody chosen is on'),
      option('hide', 'eye-slash', 'Hide', 'Leave out the cards nobody chosen is on'),
    ],
  };
}

/**
 * A setting as an icon, its name where there is room, then its switch — the name first, so in a row of
 * controls it reads as belonging to the switch after it rather than to whatever came before. The
 * switch's accessible name and a tooltip carry the words when the header is too narrow for them.
 */
export function labelledSwitch(opts: { icon: string; label: string; checked: string; local: string }): SchemaNode {
  return {
    type: 'we-tooltip',
    props: { content: opts.label },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [
          {
            type: 'Row',
            props: { gap: '0', ay: 'center' },
            children: [
              { type: 'we-icon', props: { name: opts.icon, size: 'sm', color: 'text-muted' } },
              headerLabel(opts.label),
            ],
          },
          {
            type: 'we-switch',
            props: {
              size: 'sm',
              label: opts.label,
              checked: { $: opts.checked },
              onChange: { $setLocal: opts.local, value: { $: 'event.detail' } },
            },
          },
        ],
      },
    ],
  };
}
