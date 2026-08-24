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

/**
 * How big the leading glyph is, whichever glyph it happens to be.
 *
 * Stated once and applied to both, because the spinner and the icon are swapped in place when a
 * pass settles. `we-icon` left unsized falls back to something larger than `we-spinner` resolves
 * for the same token, so the row grew by a few pixels at the exact moment the pass completed — a
 * twitch on every row, in a bar that is meant to be glanceable.
 *
 * `sm` is 24px, which is also what the runner's avatar takes, so the three things in the row's
 * leading cluster line up instead of stepping.
 */
const GLYPH_SIZE = 'sm';

/**
 * Carets are a size below the glyphs they sit beside.
 *
 * A disclosure arrow is punctuation, not content: at the status glyph's 24px it read as another
 * thing to look at rather than as a hint about where the row goes. 16px is the size the prompt's
 * own caret already used and looked right at, so the three carets in the bar now agree.
 */
const CARET_SIZE = 'xs';

/**
 * A spinner while it runs, the outcome's own glyph once it stops.
 *
 * Three outcomes, three colours, and the middle one is the point: `done` is green because something
 * was accomplished, `failed` is red because something broke, and `skipped` stays muted because "the
 * conversation had nothing extractable in it" is an ordinary answer and colouring it would make a
 * quiet meeting look like a problem.
 */
const phaseIcon: SchemaNode = {
  type: '$if',
  props: {
    condition: '$pass.running',
    then: { type: 'we-spinner', props: { size: GLYPH_SIZE } },
    else: {
      type: 'we-icon',
      props: {
        size: GLYPH_SIZE,
        name: {
          $if: {
            condition: { $eq: ['$pass.phase', 'failed'] },
            then: 'warning',
            else: {
              $if: { condition: { $eq: ['$pass.phase', 'skipped'] }, then: 'minus-circle', else: 'check-circle' },
            },
          },
        },
        color: {
          $if: {
            condition: { $eq: ['$pass.phase', 'failed'] },
            then: 'danger-text',
            else: { $if: { condition: { $eq: ['$pass.phase', 'done'] }, then: 'success-text', else: 'text-muted' } },
          },
        },
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
 * The row's contents, laid out by the button that wraps them.
 *
 * These used to sit in a `Row` inside the button, which never stretched: `we-button`'s
 * `[part='base']` is `all: unset`, so it shrink-wraps its content and a child asking for
 * `width: '100%'` resolved that against the shrunken box. The caret ended up immediately after the
 * text rather than at the end of the row.
 *
 * The button lays them out directly instead — it takes the same DS flex props, which is what every
 * other full-width button here does (`width: '100%'` plus an alignment). One box fewer, and the
 * caret lands under the history row's caret where it belongs.
 *
 * The elapsed time renders only while the pass is running — the store returns `''` once it has
 * settled, since a finished pass reports what it did and how long it took stops being the question.
 */
const passRowChildren: SchemaNode[] = [
  phaseIcon,
  runnerFace,
  { type: 'we-text', props: { fontSize: '200', truncate: true, flex: '1' }, children: ['$pass.label'] },
  {
    type: '$if',
    props: {
      condition: '$pass.elapsed',
      then: {
        // Tabular, so the seconds column does not jitter the row every time it ticks.
        type: 'we-text',
        props: { fontSize: '200', color: 'text-faint', styles: { fontVariantNumeric: 'tabular-nums' } },
        children: ['$pass.elapsed'],
      },
    },
  },
];

/**
 * The caret — an indicator, not a control.
 *
 * It was a button, and the whole row is one now, so a button here would nest one inside another:
 * invalid, and the inner one swallows clicks the outer was meant to get. It keeps its position and
 * its job of showing which way the row will move; the click target is the row.
 */
const disclosureCaret: SchemaNode = {
  type: 'we-icon',
  props: {
    size: CARET_SIZE,
    color: { $if: { condition: '$pass.hasDetail', then: 'text-muted', else: 'text-faint' } },
    name: {
      $if: {
        condition: { $in: ['$pass.passId', { $local: 'openPasses' }] },
        then: 'caret-up',
        else: 'caret-down',
      },
    },
  },
};

/** The small caps heading above each pane. */
function paneLabel(label: string): SchemaNode {
  return {
    type: 'we-text',
    props: { fontSize: '200', color: 'text-faint', uppercase: true, letterSpacing: 'wide' },
    children: [label],
  };
}

/**
 * One half of the exchange: a heading that opens it, and the JSON underneath.
 *
 * Both halves are JSON and both are large, so they get the same treatment — the response is what the
 * model said, the prompt is the object `build_interpretation_input` assembled from the transcript,
 * the target shapes and their hints. Rendered as text either one is a single enormous escaped
 * string, which is how the bar came to overflow in the first place.
 *
 * `CodeEditor` rather than `we-code` because folding is what makes a long document navigable, and it
 * is the component the editor's own JSON panels use — one way of reading JSON in the app, not two.
 *
 * The label is the control. It is already the heading, and a separate button beside it would be a
 * second thing to aim at for one behaviour.
 */
function codePane(options: {
  label: string;
  /** The already-indented text, from the store — a schema has no `JSON.stringify`. */
  value: string;
  /** Resolves true while this pane is open. */
  isOpen: SchemaNode | Record<string, unknown>;
  /** The `$localState` array field this pane's toggle writes into. */
  field: string;
}): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: options.value,
      then: {
        type: 'Column',
        props: { gap: '100', width: '100%' },
        children: [
          {
            type: 'we-button',
            props: {
              variant: 'bare',
              width: '100%',
              onClick: { $toggleLocalIn: options.field, value: '$pass.passId' },
            },
            children: [
              {
                type: 'Row',
                props: { ay: 'center', gap: '100', width: '100%' },
                children: [
                  paneLabel(options.label),
                  {
                    type: 'we-icon',
                    props: {
                      size: CARET_SIZE,
                      color: 'text-faint',
                      name: { $if: { condition: options.isOpen, then: 'caret-up', else: 'caret-down' } },
                    },
                  },
                ],
              },
            ],
          },
          {
            type: '$if',
            props: {
              condition: options.isOpen,
              enterTransition: { type: 'reveal', duration: 200 },
              exitTransition: { type: 'reveal', duration: 160 },
              then: {
                type: 'CodeEditor',
                props: {
                  code: options.value,
                  language: 'json',
                  // Nothing here is editable: this is a record of an exchange that already happened,
                  // and a pane accepting keystrokes would imply it could be corrected and re-run.
                  readOnly: true,
                  /*
                    A fixed height, not a maximum.

                    `.cm-editor` is `height: 100%`, and a percentage resolves against `auto` as
                    `auto` — so under `max-height` alone the editor grew to its content, the wrapper
                    grew with it, and nothing scrolled. Given a real height, CodeMirror's own
                    `.cm-scroller` takes over, which is how it is meant to be sized.
                  */
                  styles: { height: '240px', width: '100%' },
                },
              },
            },
          },
        ],
      },
    },
  };
}

/**
 * The prompt, closed until asked for.
 *
 * It is reference material and mostly the shape definitions, which are identical on every pass and
 * dwarf the turns. Opening it alongside the response put the answer below the fold.
 *
 * A disclosure rather than folding the JSON tree on load: folding would still need unfolding to read
 * anything, and it would mean teaching a shared design-system component a new option to serve one
 * panel.
 */
const promptPane: SchemaNode = codePane({
  label: 'Prompt',
  value: '$pass.prompt',
  field: 'openPrompts',
  isOpen: { $in: ['$pass.passId', { $local: 'openPrompts' }] },
});

/**
 * The response, open unless closed.
 *
 * The opposite default to the prompt, and tracked the opposite way round — a set of *closed* ones —
 * because `$localState` cannot seed a per-row value for rows that come from data. The asymmetry in
 * the state mirrors a real asymmetry in the content: this is the answer, and the reason somebody
 * opened the row at all. Making them both start closed would cost two clicks to see anything in the
 * common case.
 */
const responsePane: SchemaNode = codePane({
  label: 'Response',
  value: '$pass.response',
  field: 'closedResponses',
  isOpen: { $not: { $in: ['$pass.passId', { $local: 'closedResponses' }] } },
});

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
        {
          type: '$if',
          props: {
            condition: '$pass.detail',
            then: {
              type: 'we-text',
              props: { fontSize: '200', color: 'danger-text' },
              children: ['$pass.detail'],
            },
          },
        },
      ],
    },
  },
};

/**
 * A row, and what it opens.
 *
 * The whole row is the click target. It was a caret at the far right, which is a small target for a
 * gesture that has a whole line's worth of obvious surface — and the line reads as one thing, so
 * only part of it responding is the sort of detail that makes an interface feel arbitrary.
 *
 * `variant: 'bare'` because this must be a real `<button>` — keyboard-activatable, correctly
 * announced, honouring `disabled` — while looking like nothing at all. A `Row` with an `onClick`
 * would look identical and be none of those things.
 *
 * Disabled where there is nothing to open, with the tooltip saying which of the two reasons applies:
 * somebody else's pass never sent its exchange to this machine, and one's own may not have reached
 * the model yet.
 */
const passEntry: SchemaNode = {
  type: 'Column',
  props: { gap: '0', width: '100%' },
  children: [
    {
      type: 'we-tooltip',
      props: {
        placement: 'bottom',
        /*
          Full width, and this is what was stopping the caret reaching the right edge.

          `we-tooltip` is `display: inline-flex`, so it shrink-wraps its trigger — which meant the
          button's own `width: '100%'` was resolving against an already-shrunken box. The button was
          faithfully filling its parent; the parent was the size of the text.

          Worth remembering as a general trap: a wrapper that only adds behaviour still participates
          in layout, and every full-width thing inside one needs it declared at the outermost box,
          not just the innermost.
        */
        width: '100%',
        title: {
          $if: {
            condition: '$pass.hasDetail',
            then: 'Show the prompt and the response',
            else: {
              $if: {
                condition: '$pass.mine',
                then: 'Nothing sent to the model yet',
                // Names the way out. This is the one moment somebody wants the setting, so it is
                // the one moment worth mentioning that it exists — it lives in space settings, and
                // nobody goes looking there for a control they have never seen.
                else: 'Only the runner sees this — a space can share extraction detail in its settings',
              },
            },
          },
        },
      },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'bare',
            width: '100%',
            // The button is the row. `ax: 'start'` alongside a full width is the pattern every other
            // full-width button here uses, and it is what makes the base part lay its children out
            // across the whole width instead of shrink-wrapping them.
            ax: 'start',
            ay: 'center',
            gap: '200',
            disabled: { $not: '$pass.hasDetail' },
            onClick: { $toggleLocalIn: 'openPasses', value: '$pass.passId' },
          },
          children: [...passRowChildren, disclosureCaret],
        },
      ],
    },
    passDetail,
  ],
};

/** The passes still in flight. Always listed — this is the half somebody is waiting on. */
const runningList: SchemaNode = {
  type: '$each',
  props: { items: { $store: 'modules.transcribe.runningPasses' }, as: 'pass' },
  children: [passEntry],
};

/**
 * Everything already finished, folded behind a count.
 *
 * A long call runs a pass every few minutes, and each one that completed stayed on screen — so the
 * bar grew all conversation, pushing the call's own chrome down to make room for a history nobody
 * had asked to see. Collapsing them keeps the bar the size of what is happening now while leaving
 * the record one click away.
 *
 * Deliberately not auto-dismissed after a delay. A result that vanishes on a timer is a result
 * somebody can miss entirely, and "what did that extract?" is asked minutes later as often as
 * immediately.
 */
const settledSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.transcribe.settledCount' },
    then: {
      type: 'Column',
      props: { gap: '200', width: '100%' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'bare', width: '100%', onClick: { $toggleLocal: 'historyOpen' } },
          children: [
            {
              type: 'Row',
              props: { ay: 'center', gap: '200', width: '100%' },
              children: [
                /*
                  A sparkle, not a tick.

                  A tick here said "these succeeded", which is both wrong — some of them found
                  nothing, some failed — and a repeat of the per-row glyph one level down. The row
                  is about extraction having happened, so the icon names the activity rather than
                  grading it, and the ticks stay where they mean something.
                */
                { type: 'we-icon', props: { size: GLYPH_SIZE, name: 'sparkle', color: 'text-faint' } },
                {
                  type: 'we-text',
                  props: { fontSize: '200', color: 'text-muted', flex: '1', textAlign: 'left' },
                  children: [
                    { $store: 'modules.transcribe.settledCount' },
                    ' ',
                    {
                      $plural: {
                        count: { $store: 'modules.transcribe.settledCount' },
                        one: 'extraction processed',
                        other: 'extractions processed',
                      },
                    },
                  ],
                },
                {
                  type: 'we-icon',
                  props: {
                    size: CARET_SIZE,
                    color: 'text-muted',
                    name: { $if: { condition: { $local: 'historyOpen' }, then: 'caret-up', else: 'caret-down' } },
                  },
                },
              ],
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $local: 'historyOpen' },
            enterTransition: { type: 'reveal', duration: 200 },
            exitTransition: { type: 'reveal', duration: 160 },
            then: {
              type: 'Column',
              props: { gap: '200', width: '100%' },
              children: [
                {
                  type: '$each',
                  props: { items: { $store: 'modules.transcribe.settledPasses' }, as: 'pass' },
                  children: [passEntry],
                },
              ],
            },
          },
        },
      ],
    },
  },
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
        /**
         * Which prompts are open, separately from which rows are.
         *
         * Its own set because the two disclosures answer different questions: opening a row asks
         * "what happened", opening a prompt asks "what exactly was sent". The second is reference
         * material and mostly shape definitions identical on every pass, so it stays closed until
         * somebody asks — otherwise it fills the screen above the response they opened the row for.
         */
        openPrompts: { type: 'array', initial: [] },
        /** Which responses have been closed — see `responsePane` on why this one is inverted. */
        closedResponses: { type: 'array', initial: [] },
        /**
         * Whether the finished-passes history is open.
         *
         * Starts closed, and stays closed as passes complete. Opening it is a deliberate act — the
         * bar's job is to report what is happening, and a history that unfolded itself every time
         * something finished would be the growth this collapse exists to stop.
         */
        historyOpen: { type: 'boolean', initial: false },
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
        /*
          Full width as soon as anything is open, rather than growing with each pane.

          Sized to content, the bar stepped wider every time a disclosure was opened — expand a row
          and it jumps, open the prompt beneath it and it jumps again. Each step moves a floating
          object somebody is reading.

          Taking the cap the moment the first row opens makes it one movement instead of several:
          every pane after that renders into space the bar already has. Closed, it still shrinks to
          whatever the rows need, which is the point of the cap being a maximum in the first place.
        */
        width: {
          $if: {
            condition: { $count: { items: { $local: 'openPasses' } } },
            then: '520px',
            else: 'auto',
          },
        },
      },
      children: [runningList, settledSection],
    },
  },
};
