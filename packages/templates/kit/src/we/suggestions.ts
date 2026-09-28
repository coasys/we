/**
 * What extraction has proposed and nobody has decided — told apart, and something a reader can put away.
 *
 * ## Two kinds of suggestion, which want opposite drawings
 *
 * A pass stages one of two things. It **makes a record** (`create`): the record is in the graph from
 * the moment the pass ran, so it appears wherever records of its kind do, and nobody has agreed it
 * should exist. Or it **suggests changing an agreed record** (`update`): the executor would not
 * overwrite what a person owns, so it staged the new values beside the record and left the record
 * alone.
 *
 * They were one list of ids, so an accepted task a pass merely had an opinion about was faded and
 * dashed like a draft, offered a way to throw it away as though it were one — and a "hide
 * suggestions" built on that list would have hidden agreed work. The first kind is provisional and
 * may be faded, dashed, or hidden. The second is settled: the card looks like every other, and the
 * change is shown *on* it as old → new, answered per field with Accept or Reject.
 *
 * ## The words
 *
 * One vocabulary on every surface: a record a pass made is **pending acceptance**, a change to an
 * agreed record is a **pending change**, and both are answered **Accept** or **Reject** — the
 * executor's own verbs. A draft's badge still says "suggested": short enough for a card's header,
 * and clear of "review", which a card already uses for somebody reviewing the work.
 *
 * ## One setting across a call's pages
 *
 * Whether unconfirmed records are shown rides in the address, as `?suggestions=hide`. The board, the
 * calendar and the canvas are three pages about one call, and hiding suggestions is one intent; the
 * canvas's key is a panel, outside the route's tree, and the address is the one thing both can read
 * live — the same reason the key's lens is `?colour=`. Absent means shown: suggestions exist to be
 * reviewed.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { headerLabel } from './peopleFilter.ts';

/*
  These name the transcribe module's store, and a template that places anything built on them depends
  on that module. Say so: `meta.requires.modules: ['transcribe']` is what turns "the accept button does
  nothing in this deployment" into a reported dependency. A kit fragment cannot declare it for you —
  the declaration is the template's, since the template is what a deployment ships or omits.
*/
/** Records a pass made that nobody has kept — the transcribe module's list, by id. Empty without it. */
export const UNCONFIRMED = 'modules.transcribe.unconfirmedIds';

/** Agreed records carrying a suggested change, by id. Mark these; never fade or hide them. */
export const CHANGED = 'modules.transcribe.changedIds';

/** The address parameter holding the reader's choice. */
export const SUGGESTIONS_PARAM = 'suggestions';

/** Whether the reader has put unconfirmed records away, as expression source. */
export const SUGGESTIONS_HIDDEN = `routeStore.params.${SUGGESTIONS_PARAM} == 'hide'`;

/**
 * A list of records without the ones nobody has kept, while the reader has hidden them — expression
 * source, for a surface to hand whatever it draws from.
 */
export const withoutHiddenSuggestions = (list: string) =>
  `((${SUGGESTIONS_HIDDEN}) ? ${list}.filter(r, !(r.id in ${UNCONFIRMED})) : ${list})`;

/**
 * The suggested changes to one agreed record that would actually change something, as expression
 * source — `{ name, label, value }` rows, `value` being the proposed one.
 *
 * Filtered against the record, because a staged update carries every value the pass proposed,
 * including ones equal to what the record already holds (the executor snapshots them all as its
 * baseline). "Due date: Fri → Fri" is not a change anybody is being asked about.
 */
export const changesOf = (record: string) =>
  `((${record}.id in ${CHANGED}) ? find(modules.transcribe.pendingProposals, { id: ${record}.id }).fields.filter(f, ('' + ${record}[f.name]) != f.value) : [])`;

/** A value as a reader knows it: a state by its community's name rather than its slug. */
const readable = (field: string, value: string) =>
  `(${field} == 'status' ? (find(spaceStore.taskStates, { slug: ${value} }).name ?? ${value}) : ${value})`;

/** A round yes-or-no button in the success or danger role, the pair every suggestion is answered with. */
export function answerButton(opts: { tone: 'success' | 'danger'; label: string; onClick: SchemaProp }): SchemaNode {
  return {
    type: 'we-tooltip',
    props: { content: opts.label },
    children: [
      {
        type: 'we-button',
        props: {
          variant: 'outline',
          size: 'xs',
          square: true,
          r: 'full',
          label: opts.label,
          color: `${opts.tone}-text`,
          // The fill on hover, not a tint of it: `on-${tone}` answers for the contrast once the
          // background stops being the card's, and a tint reads as acknowledging the pointer.
          hoverProps: { bg: opts.tone, color: `on-${opts.tone}`, borderColor: opts.tone },
          onClick: opts.onClick,
        },
        children: [{ type: 'we-icon', props: { name: opts.tone === 'success' ? 'check' : 'x', weight: 'bold' } }],
      },
    ],
  };
}

export interface SuggestedChangesOptions {
  /** Expression for the agreed record the changes are to — a context key like `card`. */
  record: string;
  /**
   * How many changes are listed before they fold behind a count. Default 2: a board shows a line or
   * two on the card itself, and a pass that rewrote five fields asks for one press first.
   */
  collapseAfter?: number;
}

/**
 * The changes a pass suggested to one agreed record: each as old → new, applied or dismissed alone.
 *
 * Nothing at all where there are none, so a surface can place it unconditionally. Per field because a
 * suggestion is often half right; "Accept all" and "Reject all" appear once there is more than one,
 * and are also what clears a suggestion whose remaining values change nothing visible.
 */
export function suggestedChanges(opts: SuggestedChangesOptions): SchemaNode {
  const changes = changesOf(opts.record);
  const limit = opts.collapseAfter ?? 2;
  const open = `count(${changes}) <= ${limit} || local.changesOpen`;
  const countLabel: SchemaNode = {
    type: 'we-text',
    props: {
      fontSize: '200',
      fontWeight: 'semibold',
      color: 'warning-text',
      text: { $: `\`\${count(${changes})} pending \${plural(count(${changes}), 'change', 'changes')}\`` },
    },
  };

  const line: SchemaNode = {
    type: 'Row',
    props: { gap: '200', ay: 'center', width: '100%' },
    children: [
      { type: 'we-icon', props: { name: 'pencil-simple-line', size: 'xs', color: 'warning-text', flexShrink: '0' } },
      {
        type: 'we-text',
        props: {
          fontSize: '200',
          flex: '1 1 auto',
          minWidth: '0',
          text: {
            $:
              '`${change.label}: ${' +
              readable('change.name', `(${opts.record}[change.name] ?? '—')`) +
              '} → ${' +
              readable('change.name', 'change.value') +
              '}`',
          },
        },
      },
      answerButton({
        tone: 'success',
        label: 'Accept this change',
        onClick: {
          $action: 'modules.transcribe.applyChange',
          args: [{ $: `${opts.record}.id` }, { $: 'change.name' }],
        },
      }),
      answerButton({
        tone: 'danger',
        label: 'Reject this change — keeps the current value',
        onClick: {
          $action: 'modules.transcribe.dismissChange',
          args: [{ $: `${opts.record}.id` }, { $: 'change.name' }],
        },
      }),
    ],
  };

  return {
    type: '$if',
    props: {
      condition: { $: `count(${changes})` },
      then: {
        type: 'Column',
        $localState: { changesOpen: { type: 'boolean', initial: false } },
        // A rule above it, so the changes read as something said *about* the card rather than as
        // more of its fields.
        props: { gap: '100', width: '100%', pt: '200', borderTop: '1px solid border' },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center', width: '100%' },
            children: [
              /*
                The count, which opens the list once there is more of it than fits on a card — and
                is only words below that, since a control that does nothing is worse than a label.
              */
              {
                type: '$if',
                props: {
                  condition: { $: `count(${changes}) > ${limit}` },
                  then: {
                    type: 'we-button',
                    props: {
                      variant: 'bare',
                      gap: '100',
                      color: 'warning-text',
                      onClick: { $toggleLocal: 'changesOpen' },
                    },
                    children: [
                      countLabel,
                      {
                        type: 'we-icon',
                        props: { size: 'xs', name: { $: "local.changesOpen ? 'caret-up' : 'caret-down'" } },
                      },
                    ],
                  },
                  else: countLabel,
                },
              },
              {
                type: '$if',
                props: {
                  condition: { $: `count(${changes}) > 1` },
                  then: {
                    type: 'Row',
                    props: { ml: 'auto', gap: '100', ay: 'center' },
                    children: [
                      {
                        type: 'we-button',
                        props: {
                          variant: 'ghost',
                          size: 'xs',
                          onClick: { $action: 'modules.transcribe.acceptProposal', args: [{ $: `${opts.record}.id` }] },
                        },
                        children: ['Accept all'],
                      },
                      {
                        type: 'we-button',
                        props: {
                          variant: 'ghost',
                          size: 'xs',
                          onClick: { $action: 'modules.transcribe.rejectProposal', args: [{ $: `${opts.record}.id` }] },
                        },
                        children: ['Reject all'],
                      },
                    ],
                  },
                },
              },
            ],
          },
          {
            type: '$if',
            props: {
              condition: { $: open },
              then: {
                type: 'Column',
                props: { gap: '100', width: '100%' },
                children: [{ type: '$each', props: { items: { $: changes }, as: 'change' }, children: [line] }],
              },
            },
          },
        ],
      },
    },
  };
}

export interface SuggestionsToggleOptions {
  /** Expression for how many unconfirmed records this surface holds, hidden or not. */
  count: string;
  /**
   * Name the switch in words, before it. Default on — in a header of controls a bare switch reads as
   * belonging to whatever sits before it. Off where a heading already names it, as in the canvas's key.
   */
  labelled?: boolean;
}

/**
 * Show or hide what extraction made that nobody has accepted — its name, how many, and a switch.
 *
 * Present while there is anything to hide, and while hiding: turning it back on must stay reachable
 * even when the count reads nothing because the surface's own query came back empty.
 *
 * The name comes first so it reads as the switch's, and the count sits between them. While hidden the
 * count says "3 hidden" in the warning tone rather than a plain number — hiding work with nothing on
 * screen to say so is how a person comes to believe it vanished. The name does not change with the
 * state; the switch shows the state, and a label that flips leaves a reader unsure whether it says
 * what is true or what pressing will do.
 */
export function suggestionsToggle(opts: SuggestionsToggleOptions): SchemaNode {
  const labelled = opts.labelled ?? true;
  return {
    type: '$if',
    props: {
      condition: { $: `(${opts.count}) > 0 || ${SUGGESTIONS_HIDDEN}` },
      /*
        The tooltip around the whole control — icon, name, count and switch — as `labelledSwitch` does,
        so it answers wherever the pointer lands on it. Its name and nothing more: what the setting does
        is the key's help, and a sentence here covered the header it was naming.
      */
      then: {
        type: 'we-tooltip',
        props: { content: 'Pending acceptance' },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center' },
            children: [
              /*
                An hourglass for waiting on a decision, and the name where there is room — see
                `headerLabel`. Not the sparkle a card's extracted mark uses: that means "extracted", which
                an accepted record still is.
              */
              ...(labelled
                ? [
                    {
                      type: 'Row',
                      props: { gap: '0', ay: 'center' },
                      children: [
                        { type: 'we-icon', props: { name: 'hourglass-medium', size: 'sm', color: 'text-muted' } },
                        headerLabel('Pending acceptance'),
                      ],
                    } as SchemaNode,
                  ]
                : []),
              {
                type: '$if',
                props: {
                  condition: { $: SUGGESTIONS_HIDDEN },
                  then: {
                    type: 'we-badge',
                    props: { size: 'xs', variant: 'warning' },
                    children: [{ $: `\`\${${opts.count}} hidden\`` }],
                  },
                  else: { type: 'we-badge', props: { size: 'xs', variant: 'neutral' }, children: [{ $: opts.count }] },
                },
              },
              {
                type: 'we-switch',
                props: {
                  size: 'sm',
                  label: 'Pending acceptance',
                  checked: { $: `!(${SUGGESTIONS_HIDDEN})` },
                  onChange: {
                    $action: 'routeStore.setParam',
                    args: [SUGGESTIONS_PARAM, { $: "event.detail ? null : 'hide'" }],
                  },
                },
              },
            ],
          },
        ],
      },
    },
  };
}
