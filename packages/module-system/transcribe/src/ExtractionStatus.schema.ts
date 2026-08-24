/**
 * The extraction readout, contributed under the call bar.
 *
 * ## Why a bar and not a popup
 *
 * Because a pass runs for minutes. Almost all of that is one LLM call, and on a local model it can
 * be several minutes — so the surface reporting it has to be something you can ignore and glance
 * back at. A modal interrupts once and then sits there being in the way; a strip under the bar
 * appears, says what is happening, and retracts.
 *
 * It also has to belong to the call rather than to the transcript panel. The pass outlives the panel
 * that started it, and the person most likely to want the readout is whoever is looking at the call
 * — including the four people out of five who did *not* start it.
 *
 * ## What it shows to whom
 *
 * Everyone sees every row: who is extracting, what phase, how long. That is deliberate and it is
 * what the host's relay exists to make possible — the peer running a pass is chosen by an election,
 * so which member holds the detailed view is otherwise decided by a coin flip.
 *
 * What only the runner has is the model exchange, because only their machine produced it. So the
 * disclosure is offered to everyone and *disabled* with a reason for a pass that is not theirs,
 * rather than hidden. A control that silently is not there reads as a bug; one that says why reads
 * as an explanation.
 *
 * ## Collapse
 *
 * One pass renders as one row. Two or more collapse behind a count, and each opens from there —
 * which is the shape James asked for, and the right one: a bar that grew a row per concurrent pass
 * would push the whole call's chrome around while somebody was using it.
 */
import { type SchemaNode } from '@we/schema-shared';

/** Must match `CALL_STATUS_ANCHOR` in `@we/module-call`. Deliberately not imported — a shared
 *  constant would be a hard dependency on the module this is meant to work without, exactly as
 *  `CALL_CONTROLS_ANCHOR` explains at greater length. */
export const CALL_STATUS_ANCHOR = 'call-status';

/** The bar's own corners, following the theme the call bar above it follows. See `CallControl.schema`. */
const STATUS_RADIUS = 'var(--we-theme-control-radius, var(--we-radius-400))';

/**
 * Matching the call bar's material exactly.
 *
 * Two floating strips a spacing token apart that disagreed about their surface would read as one
 * piece of chrome and one bug. Restated rather than imported for the reason the anchor is.
 */
const STATUS_SURFACE = { bg: 'page', border: '1px solid border', shadow: 'md' } as const;

/** A spinner while it runs, the outcome's own glyph once it stops. */
const phaseIcon: SchemaNode = {
  type: '$if',
  props: {
    condition: '$pass.running',
    then: { type: 'we-spinner', props: { size: 'xs' } },
    else: {
      type: 'we-icon',
      props: {
        name: {
          $if: {
            condition: { $eq: ['$pass.phase', 'failed'] },
            then: 'warning',
            else: {
              $if: { condition: { $eq: ['$pass.phase', 'skipped'] }, then: 'minus-circle', else: 'check-circle' },
            },
          },
        },
        // A failure is the one outcome worth colouring. "Nothing to extract" is an ordinary answer
        // and painting it amber would make a quiet conversation look like a problem.
        color: { $if: { condition: { $eq: ['$pass.phase', 'failed'] }, then: 'danger-text', else: 'text-muted' } },
      },
    },
  },
};

/**
 * The runner's face and name.
 *
 * `hash` as well as `image`, never instead of it: the hash seeds a generated avatar that is stable
 * per agent, so somebody whose profile has not arrived yet is still distinguishable from everybody
 * else whose profile has not arrived.
 */
const runnerFace: SchemaNode = {
  type: 'we-avatar',
  props: { size: 'xs', image: '$pass.avatar', hash: '$pass.runner' },
};

/**
 * One pass, as a single line.
 *
 * The elapsed time renders only while the pass is running, and the store returns `''` once it has
 * settled — a finished pass reports what it did, and how long it took stops being the question.
 */
const passRow: SchemaNode = {
  type: 'Row',
  props: { ay: 'center', gap: '200', width: '100%' },
  children: [
    phaseIcon,
    runnerFace,
    { type: 'we-text', props: { variant: 'footnote', truncate: true, flex: '1' }, children: ['$pass.label'] },
    {
      type: '$if',
      props: {
        condition: '$pass.elapsed',
        then: {
          // Tabular, so the seconds column does not jitter the row every time it ticks.
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint', styles: { fontVariantNumeric: 'tabular-nums' } },
          children: ['$pass.elapsed'],
        },
      },
    },
  ],
};

/**
 * The disclosure control.
 *
 * Present for every row and disabled where there is nothing behind it, with a tooltip that says
 * which of the two reasons applies. A pass of somebody else's has no exchange on this machine at
 * all; a pass of this agent's might simply not have reached the model yet.
 */
const detailToggle: SchemaNode = {
  type: 'we-tooltip',
  props: {
    placement: 'bottom',
    title: {
      $if: {
        condition: '$pass.hasDetail',
        then: 'Show what the model was asked',
        else: {
          $if: {
            condition: '$pass.mine',
            then: 'Nothing sent to the model yet',
            else: 'Only the person running a pass sees what it sent',
          },
        },
      },
    },
  },
  children: [
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        size: 'xs',
        square: true,
        disabled: { $not: '$pass.hasDetail' },
        onClick: { $toggleLocalIn: 'openPasses', value: '$pass.passId' },
      },
      children: [
        {
          type: 'we-icon',
          props: {
            name: {
              $if: {
                condition: { $in: ['$pass.passId', { $local: 'openPasses' }] },
                then: 'caret-up',
                else: 'caret-down',
              },
            },
          },
        },
      ],
    },
  ],
};

/** The small caps heading above each pane. */
function paneLabel(label: string): SchemaNode {
  return {
    type: 'we-text',
    props: { variant: 'footnote', color: 'text-faint', uppercase: true, letterSpacing: 'wide' },
    children: [label],
  };
}

/**
 * The prompt — prose, so rendered as prose.
 *
 * It was a `we-code` block, which was wrong twice over. A prompt is not code, and `we-code[block]`
 * sets `white-space: pre` with `overflow-x: auto` on `[part=base]` — so it never wrapped, and
 * because a primitive's `:host` overflow is not DS-managed, the unwrapped line escaped the bar
 * entirely and ran off the screen until a hover reflowed it.
 *
 * `pre-wrap` keeps the prompt's own line breaks, which carry its structure, while allowing long
 * lines to wrap. `break-word` handles the URIs, which are long and have nowhere natural to break.
 */
const promptPane: SchemaNode = {
  type: '$if',
  props: {
    condition: '$pass.prompt',
    then: {
      type: 'Column',
      props: { gap: '100', width: '100%' },
      children: [
        paneLabel('Prompt'),
        {
          // Capped and scrolled rather than clipped: a prompt runs to thousands of words and the
          // point of showing it is that somebody can read all of it.
          type: 'we-scroll-area',
          props: { maxHeight: '200px', width: '100%' },
          children: [
            {
              type: 'we-text',
              props: {
                variant: 'footnote',
                width: '100%',
                styles: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--we-font-mono)' },
              },
              children: ['$pass.prompt'],
            },
          ],
        },
      ],
    },
  },
};

/**
 * The response — JSON, so rendered as JSON.
 *
 * An interpretation response is a structured document that arrives as one unbroken line. The store
 * indents it (a schema cannot); this gives it syntax colouring and fold arrows, so a reader can
 * collapse the instances they are not interested in rather than scrolling past them.
 *
 * `CodeEditor` rather than `we-code` because folding is the thing that makes a long response
 * navigable, and it is the same component the editor's own JSON panels use — one way of reading
 * JSON in the app, not two.
 */
const responsePane: SchemaNode = {
  type: '$if',
  props: {
    condition: '$pass.response',
    then: {
      type: 'Column',
      props: { gap: '100', width: '100%' },
      children: [
        paneLabel('Response'),
        {
          type: 'CodeEditor',
          props: {
            code: '$pass.response',
            language: 'json',
            // Nothing here is editable: this is a record of what a model said, and a pane that
            // accepted keystrokes would imply the text could be corrected and re-run.
            readOnly: true,
            styles: { maxHeight: '240px', overflow: 'auto', width: '100%' },
          },
        },
      ],
    },
  },
};

/**
 * "Let the space see this too."
 *
 * Offered here, beneath somebody's own prompt, rather than in settings — because this is the moment
 * the question arises. You are reading what the model was asked; the four other people in the call
 * are looking at a row that says the same thing happened and cannot open it.
 *
 * Only on a pass of this agent's, since it governs what *this* machine broadcasts and would be
 * meaningless attached to somebody else's row. It applies to every pass this agent runs, not just
 * the one it is under, which the caption says outright: a switch that looked per-row would be a
 * promise the store cannot keep.
 */
const shareToggle: SchemaNode = {
  type: '$if',
  props: {
    condition: '$pass.mine',
    then: {
      type: 'Row',
      props: { ay: 'center', ax: 'between', gap: '300', width: '100%', pt: '100' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: ['Share your prompts with this space'],
        },
        {
          type: 'we-switch',
          props: {
            size: 'sm',
            checked: { $store: 'modules.transcribe.shareDetail' },
            // `$event.detail` passed bare. Wrapping it in an operator would resolve at render time
            // and send a constant — the trap `setModuleVisible` documents for the same reason.
            onChange: { $action: 'modules.transcribe.setShareDetail', args: ['$event.detail'] },
          },
        },
      ],
    },
  },
};

/**
 * What opening a row shows.
 *
 * `$if`, so a closed row holds nothing. That is a reversal: this was `$animate` precisely so the
 * panes stayed mounted and a scroll position survived closing and reopening. Then the response pane
 * became a CodeMirror instance, and keeping one alive per row — for every pass in the bar, open or
 * not — costs far more than the scroll position is worth.
 *
 * The reveal still runs both ways, so the row opens and closes the same as it did.
 */
const passDetail: SchemaNode = {
  type: '$if',
  props: {
    condition: { $in: ['$pass.passId', { $local: 'openPasses' }] },
    enterTransition: { type: 'reveal', duration: 200 },
    exitTransition: { type: 'reveal', duration: 160 },
    then: {
      type: 'Column',
      props: { gap: '300', width: '100%', pt: '200' },
      children: [
        promptPane,
        responsePane,
        shareToggle,
        {
          type: '$if',
          props: {
            condition: '$pass.detail',
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'danger-text' },
              children: ['$pass.detail'],
            },
          },
        },
      ],
    },
  },
};

/** A row, its disclosure, and what the disclosure opens. */
const passEntry: SchemaNode = {
  type: 'Column',
  props: { gap: '0', width: '100%' },
  children: [
    {
      type: 'Row',
      props: { ay: 'center', gap: '200', width: '100%' },
      children: [passRow, detailToggle],
    },
    passDetail,
  ],
};

/**
 * The collapsed summary, shown only when more than one pass is in flight.
 *
 * A count rather than a stack, because concurrent passes are the case where a growing bar would
 * shove the call's controls around while somebody was aiming at them. Clicking it opens the list;
 * the rows are the same ones a single pass shows.
 */
const collapsedSummary: SchemaNode = {
  type: 'we-button',
  props: { variant: 'bare', width: '100%', onClick: { $toggleLocal: 'listOpen' } },
  children: [
    {
      type: 'Row',
      props: { ay: 'center', gap: '200', width: '100%' },
      children: [
        { type: 'we-spinner', props: { size: 'xs' } },
        {
          type: 'we-text',
          props: { variant: 'footnote', flex: '1', textAlign: 'left' },
          children: [
            { $store: 'modules.transcribe.activityCount' },
            ' ',
            {
              $plural: {
                count: { $store: 'modules.transcribe.activityCount' },
                one: 'extraction running',
                other: 'extractions running',
              },
            },
          ],
        },
        {
          type: 'we-icon',
          props: { name: { $if: { condition: { $local: 'listOpen' }, then: 'caret-up', else: 'caret-down' } } },
        },
      ],
    },
  ],
};

/** Every row, in the store's order — running first, then most recent. */
const passList: SchemaNode = {
  type: '$each',
  props: { items: { $store: 'modules.transcribe.activity' }, as: 'pass' },
  children: [passEntry],
};

/**
 * The bar itself.
 *
 * Absent entirely when nothing is happening — not empty, absent. A permanently reserved strip under
 * the call bar would be a piece of chrome whose only job is to report, sitting there reporting
 * nothing, and it would push the rest of the call's furniture down to do it.
 */
export const extractionStatus: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.transcribe.hasActivity' },
    // Slides down from behind the bar rather than appearing. The bar is a fixed object somebody is
    // already looking at, and something materialising a few pixels under it reads as a glitch.
    enterTransition: [
      { type: 'reveal', duration: 220 },
      { type: 'fade', duration: 160 },
    ],
    then: {
      type: 'Column',
      $localState: {
        /**
         * Which rows are open, as a set of pass ids.
         *
         * An array rather than a boolean each, because the rows come from data: `$localState` names
         * are fixed when the template is written, and there is no name to give a row that does not
         * exist yet. `$toggleLocalIn` writes it and `$in` reads it back.
         */
        openPasses: { type: 'array', initial: [] },
        /** Whether the collapsed multi-pass summary has been expanded into its list. */
        listOpen: { type: 'boolean', initial: false },
      },
      props: {
        ...STATUS_SURFACE,
        r: STATUS_RADIUS,
        px: '300',
        py: '200',
        gap: '200',
        // Wide enough for a name and a clause, capped so a long failure message wraps rather than
        // stretching the bar past the one above it.
        minWidth: '260px',
        maxWidth: '520px',
      },
      children: [
        {
          type: '$if',
          props: {
            // One pass is its own row; several collapse to a count that opens.
            condition: { $gt: [{ $store: 'modules.transcribe.activityCount' }, 1] },
            then: {
              type: 'Column',
              props: { gap: '200', width: '100%' },
              children: [
                collapsedSummary,
                {
                  type: '$animate',
                  props: {
                    condition: { $local: 'listOpen' },
                    enterTransition: { type: 'reveal', duration: 200 },
                  },
                  children: [{ type: 'Column', props: { gap: '300', width: '100%' }, children: [passList] }],
                },
              ],
            },
            else: passList,
          },
        },
      ],
    },
  },
};
