/**
 * The transcription panel — live feedback while transcribing, and nothing when not.
 *
 * Keyed on `open`, not on whether we are recording. Those were one flag to begin with, which meant
 * the transcript disappeared the instant you stopped recording — exactly when you want to read it —
 * and left no way to check what had been captured without starting again.
 *
 * So: the call bar's button records, this panel shows, and either can be true without the other.
 * Recording does open the panel once, because starting something invisible and saying nothing about
 * it is how a feature comes to look broken.
 *
 * In its own `.schema.ts` file so `pnpm --filter @we/schema-shared validate` checks it. The validator
 * walks files by that name, and module fragments declared inline in an `index.ts` were invisible to
 * it — which is how a module could ship a typo'd prop that only appears as a component silently not
 * rendering. The other three modules still declare their fragments inline; this is the shape they
 * should move to.
 */
import { type SchemaNode } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

import { extractionActivity } from './ExtractionStatus.schema';

/**
 * A message shown for exactly one status.
 *
 * Every reason this module can produce nothing gets its own line, because from the user's side they
 * are indistinguishable — an empty panel means "nobody is speaking", "no model is installed" and
 * "this backend cannot transcribe" equally well, and only one of those is worth acting on.
 */
function note(status: string, icon: string, text: string, action?: SchemaNode): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: expr`modules.transcribe.status == ${status}`,
      then: {
        type: 'Column',
        props: { gap: '200', ay: 'start' },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'start' },
            children: [
              { type: 'we-icon', props: { name: icon, color: 'text-faint' } },
              { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [text] },
            ],
          },
          ...(action ? [action] : []),
        ],
      },
    },
  };
}

/**
 * The microphone level, with the line speech has to cross drawn on it.
 *
 * The threshold marker is the point. A bare level bar answers "is audio arriving", which was never
 * really in doubt; what a user actually needs when nothing is being transcribed is "am I loud
 * enough", and that is only answerable against the number the VAD compares to. Both come from the
 * same measurement in the worklet, so the bar and the decision cannot disagree.
 *
 * Both widths arrive from the store as CSS percentages — the scale factor is a property of how loud
 * speech is, and belongs next to the numbers rather than in a template.
 *
 * ## Why this is named
 *
 * Named as a part because a template that supplies its own transcript panel — the workshop
 * template does, since its panels are about the call in the *path* rather than the one being
 * recorded into — otherwise loses the answer to "is it hearing me". That is the one question a
 * transcript cannot answer for itself: an utterance takes seconds to buffer, transcribe and write,
 * so a panel showing only saved lines is indistinguishable from a broken microphone for the whole
 * of that delay.
 *
 * No `subject`. Unlike the feed, this is about the microphone *this agent* is running right now,
 * which is a property of the session and not of any call record — pointing it at another call
 * would be pointing a live meter at something that is not being measured.
 */
export const captureMeter: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.transcribe.enabled' },
    then: {
      type: 'Column',
      props: { gap: '150' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: ['Microphone'],
            },
            {
              // Says which side of the threshold we are on, for anyone who cannot read the bar.
              type: 'we-text',
              props: {
                variant: 'footnote',
                color: { $: "modules.transcribe.speaking ? 'success-text' : 'text-faint'" },
              },
              children: [{ $: "modules.transcribe.speaking ? 'hearing you' : 'quiet'" }],
            },
          ],
        },
        {
          type: 'Row',
          props: {
            position: 'relative',
            height: '8px',
            width: '100%',
            bg: 'surface-sunken',
            r: 'pill',
            overflow: 'hidden',
          },
          children: [
            {
              type: 'Row',
              props: {
                height: '100%',
                r: 'pill',
                // The `success` FILL, not `success-500`: a scale position is one theme's idea of a
                // green and cannot follow a theme that pins the role. It also hid from `role-audit`,
                // which until now only read colours written as plain strings and not ones inside an
                // expression.
                bg: { $: "modules.transcribe.speaking ? 'success' : 'surface-active'" },
                // `styles` rather than `width`, because the value is computed per frame and a DS prop
                // takes a token. This is the escape hatch working as intended.
                styles: {
                  width: { $: 'modules.transcribe.levelPercent' },
                  transition: 'width 80ms linear',
                  'max-width': '100%',
                },
              },
            },
            {
              // The onset threshold, read from the store so it cannot drift from the VAD's own value.
              type: 'Row',
              props: {
                position: 'absolute',
                top: '0px',
                height: '100%',
                width: '2px',
                bg: 'border-strong',
                styles: { left: { $: 'modules.transcribe.thresholdPercent' } },
              },
            },
          ],
        },
      ],
    },
  },
};

/**
 * How much of this call is actually being written down.
 *
 * The one number a transcript most needs to admit, and until now it was computed and shown nowhere.
 * Transcription is per microphone: every agent records their own and appends to one shared record,
 * so a call where two of five people are transcribing produces a transcript **of two people** that
 * reads exactly like a transcript of the call. Nothing downstream can tell the difference — the
 * extraction pass proposes tasks and events from one side of a conversation as readily as from all
 * of it — and neither can whoever opens the record next week.
 *
 * Here rather than only on the finished record because here it is still actionable. The calls list
 * pairs the faces with an utterance count for the same reason, but it says so afterwards, when the
 * only remaining response is to distrust what you are reading. This says it while the meeting is
 * happening and somebody can still press record.
 *
 * Modelled on the meter above it — a label, and the state on the right — so the panel reads as one
 * set of readouts rather than a meter and then a warning. It states the count either way and only
 * changes *colour* when there is a gap: a number that appears when something is wrong is a number
 * nobody learns to read, and "4 of 4" is worth seeing precisely because it means the record is whole.
 *
 * Absent outside a call, where `callAgents` is empty. There is no coverage question about a
 * transcript with no other participants, and "1 of 1" would be noise on every solo recording.
 *
 * Named as a part so an interface that arranges this module's pieces itself can place it. Whether
 * to show it is a design decision an interface is entitled to make; being unable to make it is not.
 * No `subject`: coverage is about the call being recorded right now, which is the only call anyone
 * can still act on.
 */
export const coverage: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'count(modules.transcribe.callAgents)' },
    then: {
      type: 'Column',
      props: { gap: '150' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center', gap: '300' },
          children: [
            { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['Coverage'] },
            {
              type: 'we-text',
              props: {
                variant: 'footnote',
                color: { $: "modules.transcribe.partialCoverage ? 'warning-text' : 'success-text'" },
              },
              children: [
                {
                  $: '`${count(modules.transcribe.transcribers)} of ${count(modules.transcribe.callAgents)} transcribing`',
                },
              ],
            },
          ],
        },
        {
          /*
            What the gap means, in the words somebody would need to act on it.

            Only when there is a gap — the whole-coverage case is already fully said by the count, and
            a permanent second line explaining a number that is currently fine is the kind of chrome
            people stop reading before the day it matters.
          */
          type: '$if',
          props: {
            condition: { $: 'modules.transcribe.partialCoverage' },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: ['Only what those microphones hear reaches this record.'],
            },
          },
        },
      ],
    },
  },
};

/**
 * Suggestions the backend staged instead of writing, and the two buttons that resolve them.
 *
 * Only appears when there are any, which is *not* the common case: a value is staged only where a
 * human already owns one, so a first pass over a fresh transcript stages nothing and this stays
 * invisible. That is the right default — a permanently empty "0 pending" box teaches people to stop
 * looking at the place their attention is eventually needed.
 *
 * Accept and reject rather than an edit affordance. Editing a suggestion is authoring, and it
 * belongs to whatever normally edits that record; the decision this list exists for is only whether
 * the model's version survives contact with the person who owns the value.
 */
const proposals: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'count(modules.transcribe.proposals)' },
    then: {
      type: 'Column',
      props: { gap: '200' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted', uppercase: true },
          children: ['Awaiting your call'],
        },
        {
          type: '$each',
          props: { items: { $: 'modules.transcribe.proposals' }, as: 'proposal' },
          children: [
            /*
              An alert, not a tinted box drawn by hand — a proposal waiting on a decision is exactly
              what `role="alert"` and a warning glyph are for, and the icon is what makes the status
              readable to someone who cannot tell the colours apart.

              `accent` rather than the tint it replaces: these arrive as a *column*, and a run of
              filled warning panels is a stack of competing rectangles that in a dark theme reads as
              brown before it reads as a warning. The edge says the same thing at the volume a list
              can carry.
            */
            {
              type: 'we-alert',
              props: { variant: 'warning', appearance: 'accent', r: '300', px: '300', py: '300', gap: '300' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    { type: 'we-text', props: { variant: 'footnote' }, children: [{ $: 'proposal.summary' }] },
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            size: 'xs',
                            variant: 'secondary',
                            onClick: { $action: 'modules.transcribe.acceptProposal', args: [{ $: 'proposal.id' }] },
                          },
                          children: ['Keep'],
                        },
                        {
                          type: 'we-button',
                          props: {
                            size: 'xs',
                            variant: 'ghost',
                            onClick: { $action: 'modules.transcribe.rejectProposal', args: [{ $: 'proposal.id' }] },
                          },
                          children: ['Discard'],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

/**
 * What a pass will look for, and the switch for each — the models, not a fixed sentence.
 *
 * It read "Find the tasks and events in what was said", which was true while those two classes were
 * compiled into this module and is a lie in a space that defined its own. These chips both say what
 * will be looked for and let a call narrow it, so the sentence becomes a lead-in rather than
 * something to rewrite every time a community adopts a model.
 *
 * ## One list, not two
 *
 * `extractionTargets` is already the union: every model this space may extract, each flagged with
 * whether this call is looking for it. So "what is on" and "what could be added" are one row of
 * chips rather than a list of pills and a search behind a button — which would be two surfaces that
 * have to agree, over a set that is a handful of entries.
 *
 * ## The state is said in colour, not in opacity
 *
 * An off chip is muted; it is not faded. Reduced opacity is what a *disabled* control looks like,
 * and these are the opposite of disabled — an unselected chip is the one thing on the row you are
 * most likely to want to press. The same confusion had the card's own action buttons fading with
 * the card they sat on.
 *
 * ## What a press actually changes
 *
 * A **group** decision recorded beside the call, not a private preference: the standing watch is one
 * registration the whole neighbourhood shares, so per-agent lists would have peers overwriting each
 * other's in a loop. It does not touch the space's own default, which is a community setting with
 * its own screen. And it applies to what is said from *here on*, because a watch keeps a
 * processed-turn cursor — which is why the note under the Extract button says pressing it is how the
 * rest of the conversation gets swept.
 *
 * ## Why this is named
 *
 * An interface that supplies its own extraction panel otherwise has no way to say what is being
 * extracted or to change it — the workshop template had exactly that gap. Registered so placing it
 * is naming it. No `subject`: what a call extracts is a fact about the call being recorded.
 */
export const extractionTargets: SchemaNode = {
  type: 'Column',
  props: { gap: '200' },
  children: [
    /*
      What this press will look for — the models, not a fixed sentence.

      It read "Find the tasks and events in what was said", which was true while those
      two classes were compiled into this module and is a lie in a space that defined
      its own. The chips below both say what will be looked for and let this agent
      narrow it; the sentence would have to be rewritten every time a community adopts
      a model, so it becomes a lead-in instead.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'count(modules.transcribe.extractionTargets)' },
        /*
          Which list this is, said out loud, because it is two lists.

          Outside a call there is no conversation to narrow, so what is shown is the space's own
          default — the one every call here starts from. Inside one it is that call's list. They look
          identical and a press on them means very different things, so the heading is the only thing
          that can tell them apart.
        */
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: [
            {
              $: "modules.transcribe.canChooseTargets ? 'Look through what was said for:' : \"This space's calls look for:\"",
            },
          ],
        },
        /*
          Not a failure, and phrased as the one thing a person can act on.

          Every other reason extraction is unavailable is about this node — no model
          configured, an executor that cannot interpret — and none of them can be fixed
          from here. This one can: it is a decision the community has not made yet, and
          the place to make it is the space's own models.
        */
        else: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: ['No models are set up for AI extraction here. A space chooses its own in its settings.'],
        },
      },
    },
    /*
      Why the chips below cannot be pressed, when they cannot.

      A choice is recorded against the call's own record, so outside a call there is nothing to
      record it on — and a host with no way to store one cannot either. Both used to be a guard in
      the store that returned without a word, so the chips took the click and did nothing, which
      reads as broken rather than as unavailable. They are disabled now, and this says which.
    */
    /*
      Why the chips cannot be pressed, in the one case where they cannot.

      A member who may not change the space's defaults, and who is not in a call, has neither list to
      write to. That was a guard in the store returning without a word, so the chips took the click
      and did nothing — which reads as broken rather than as somebody else's decision.
    */
    /*
      Where the list on screen comes from, when it is not a call's.

      Outside a call the chips are the space's default and cannot be pressed, which without a word is
      the state that reads as broken. Two sentences: what this is, and where it is changed — and the
      second is a control rather than an instruction, because "in the space's settings" is a place
      somebody then has to find.

      The tab is named, so the panel opens where the setting actually is instead of on About.
    */
    {
      type: '$if',
      props: {
        condition: {
          $: 'count(modules.transcribe.extractionTargets) && !modules.transcribe.canChooseTargets',
        },
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint', italic: true },
              children: ['Join a call to narrow it for that conversation.'],
            },
            {
              type: 'we-button',
              props: {
                size: 'xs',
                variant: 'bare',
                textDecoration: 'underline',
                color: 'accent-text',
                onClick: { $action: 'shellStore.openSpaceSettings', args: ['features'] },
              },
              children: ['Change the default'],
            },
          ],
        },
      },
    },
    /*
      One chip per model, ticked when this call is looking for it.

      A group decision rather than a private one, and it has to be: the same list drives
      the standing watch, whose registration is one row every peer shares. Two members
      holding different lists would each remove-then-add over the other's in a loop.

      Changing it applies from here on, because a watch keeps a processed-turn cursor —
      the note under the button says so, since the answer for the rest of the
      conversation is the button itself.
    */
    {
      type: 'Row',
      props: { gap: '100', wrap: true },
      children: [
        {
          type: '$each',
          props: { items: { $: 'modules.transcribe.extractionTargets' }, as: 'target' },
          children: [
            {
              type: 'we-button',
              props: {
                size: 'xs',
                gap: '100',
                /*
                  On is filled, off is an outline — the state is in the *weight* of the chip.

                  Deliberately not opacity. A faded control is what a disabled one looks like, and an
                  unselected chip is the opposite of disabled: it is the thing on this row somebody
                  is most likely to want to press. The same confusion had a card's action buttons
                  fading along with the card they were anchored to.
                */
                variant: { $: "target.selected ? 'secondary' : 'outline'" },
                // Only where neither list is this agent's to change. Refused visibly rather than in
                // the store, where it was refused in silence.
                // Outside a call there is no conversation to narrow, so these state the space's
                // default rather than offering a change to it. The link below leads to the change.
                disabled: { $: '!modules.transcribe.canChooseTargets' },
                /*
                  One meaning: this call's list, and only this call's.

                  It briefly did two — the call's in a call, the space's default outside one, on the
                  reasoning that editing what you are looking at is what a chip is for. That is one
                  control with two blast radii, told apart by a heading: narrowing this afternoon's
                  meeting and changing what every future call in the community starts from, behind
                  the same press. In a personal space, where every member administers, the heavier of
                  the two was also the default. A link to where the default lives is the honest
                  version, and it is two clicks rather than one.
                */
                onClick: {
                  $action: 'modules.transcribe.toggleExtractionTarget',
                  args: [{ $: 'target.entity' }],
                },
              },
              children: [
                /*
                  The model's own icon, joined from its declaration.

                  Not carried on the target itself, and it should not be: the port answers with an
                  entity name and whether it is on, which is what extraction knows. How a model is
                  *shown* is the record layer's, and `recordStore.displays` is where every other
                  surface reads it — so a space that gives its own model an icon gets it here for
                  nothing, and a model with none renders no glyph rather than a placeholder.
                */
                {
                  type: '$if',
                  props: {
                    condition: { $: 'recordStore.displays[target.entity].icon' },
                    then: {
                      type: 'we-icon',
                      props: { name: { $: 'recordStore.displays[target.entity].icon' } },
                    },
                  },
                },
                { type: 'we-text', props: { variant: 'footnote' }, children: [{ $: 'target.label' }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Turning what was heard into tasks and events.
 *
 * Sits below the transcript rather than in the header, because it is a thing you do *to* what is
 * there — and it should not be reachable before there is anything to do it to. The whole block is
 * absent on a node that cannot interpret: unlike a missing transcription model, there is nothing a
 * user can install to fix it from here, so a disabled button explaining itself would be furniture.
 *
 * One press, one pass, and a count afterwards. An LLM call takes seconds, and the gap between press
 * and result is exactly where a feature stops looking like it is working — so `running` says so, and
 * `done` keeps its number until the next press rather than reverting to a blank button.
 */
const extract: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.transcribe.extractable' },
    then: {
      type: 'Column',
      props: { gap: '200', bg: 'surface-sunken', r: '300', p: '300' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center', gap: '300' },
          children: [
            {
              type: 'Column',
              props: { gap: '050' },
              children: [
                { type: 'we-text', props: { variant: 'footnote', fontWeight: '600' }, children: ['Extract'] },
                { type: '$part', props: { id: 'transcribe.extractionTargets' } },
              ],
            },
            {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: 'secondary',
                // Disabled rather than hidden once the panel is showing the section: the reason is
                // "nothing has been said yet", which resolves on its own and is worth waiting for.
                disabled: { $: "!modules.transcribe.canExtract || modules.transcribe.extractStatus == 'running'" },
                onClick: { $action: 'modules.transcribe.extract' },
              },
              children: [{ $: "modules.transcribe.extractStatus == 'running' ? 'Reading…' : 'Extract'" }],
            },
          ],
        },
        /*
          The one thing about mid-call changes that is not guessable.

          A standing watch keeps a processed-turn cursor, so a model switched on part-way through is
          applied to what is said next and not to what was said before it. The one-shot pass carries
          no cursor — it hands the executor the whole transcript — so pressing Extract is the
          backfill, and the executor's dedup means what was already found returns as updates rather
          than as second copies.

          Shown only where it applies: a call nobody has changed the list for has nothing to backfill.
        */
        {
          type: '$if',
          props: {
            condition: { $: 'count(modules.transcribe.extractionTargets)' },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: [
                'A model switched on mid-call applies from here — press Extract to sweep what was said before.',
              ],
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: { $: "modules.transcribe.extractStatus == 'running'" },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-spinner', props: { size: 'sm' } },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted' },
                  children: ['Reading the transcript…'],
                },
              ],
            },
          },
        },
        /*
          Why nothing is being extracted on its own.

          Reported here rather than nowhere, which is where it went before: the standing watch is
          registered without anyone asking, so a failure had nothing on screen waiting on it and
          read as a call in which nobody said anything worth extracting.

          Phrased as a statement about the automatic pass, immediately above a button that still
          works — because that is the actual situation, and "extraction is broken" would be wrong.
        */
        {
          type: '$if',
          props: {
            condition: { $: 'modules.transcribe.watchProblem' },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'info', color: 'text-faint' } },
                {
                  /*
                    The reason, not a guess at it.

                    This was one fixed sentence — "not running on this node" — while `watchProblem`
                    held the actual cause, composed for exactly this. So a space that had simply
                    switched automatic extraction off was told its node could not do it: untrue, and
                    unactionable, and the setting is two clicks away.

                    The store owns the wording because it is the only thing that knows which of four
                    cases happened; this adds the clause that is true in all of them.
                  */
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted' },
                  children: [{ $: '`${modules.transcribe.watchProblem} Press Extract instead.`' }],
                },
              ],
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: { $: "modules.transcribe.extractStatus == 'done'" },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'check', color: 'success-text' } },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted' },
                  children: [
                    // Zero is a real and common answer — a conversation with no commitments in it —
                    // and saying so is the difference between "it worked, there was nothing" and
                    // "it silently failed".
                    { $: "modules.transcribe.extractCount ? modules.transcribe.extractCount : 'No'" },
                    ' records written. Open the graph to see them.',
                  ],
                },
              ],
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: { $: "modules.transcribe.extractStatus == 'error'" },
            then: {
              type: 'we-alert',
              props: { variant: 'warning' },
              children: [{ $: 'modules.transcribe.extractError' }],
            },
          },
        },
        proposals,

        /*
          What the passes did, in full.

          This used to be the whole of the call bar's readout, and it moved the call's furniture
          every time somebody opened a row — see `extractionActivity`. It belongs here: this panel is
          already the surface about extraction, opening something in it costs the call nothing, and
          there is room for a prompt pane without a floating strip growing to 520px over the controls
          somebody is reaching for.

          A one-line signal stays in the call chrome so the four people in five who did not start a
          pass can still see one is running without opening anything.
        */
        extractionActivity,
      ],
    },
  },
};

/**
 * The transcript itself — the utterances, read from the record rather than from this session.
 *
 * It used to render a session-local buffer of the last twenty blocks *this* agent wrote, on the
 * reasoning that a panel for watching a transcript being made is a different thing from one for
 * reading it. People who used it disagreed on every count: they wanted everyone's utterances, and
 * they wanted them still there after the call restarted.
 *
 * All three complaints were one cause. The shared record already holds every agent's lines, each
 * carrying its author and the moment it was said, and it already outlives the session —
 * `spaceStore.exportCallTranscript` has been reading exactly this to write a text file with real
 * names in it. The panel was the only thing not looking at it.
 *
 * Drilled down from the collection rather than hydrated with `include`, because
 * `CollectionBlock.children` is an untyped to-many: the ids arrive but cannot render themselves.
 * The same query the calls list already uses for a finished meeting. See
 * `docs/architecture/transcripts.md`.
 *
 * ## The rows, without the box they scroll in
 *
 * This is the utterances alone. `transcriptFeed` below is these plus the unsaved line, inside a
 * scroll area that follows the tail — the arrangement almost everything wants, and the one the
 * panel places.
 *
 * They are separate because *where the unsaved line goes* is a decision only the placer can make.
 * It belongs immediately after the last saved row, inside the same scroll region — anywhere else
 * and it is separated from the words it is about to become by however much empty panel there
 * happens to be. But an interface showing a **past** call has to leave it out: the buffer is this
 * agent's live microphone, and appending it to last month's transcript would be showing one
 * meeting's words under another meeting's heading. Owning the scroll area is what lets such an
 * interface put the line in the right place *and* omit it on the wrong call, which is exactly what
 * the workshop template does.
 */
export const transcriptLines: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'modules.transcribe.collectionId' },
        then: {
          type: '$each',
          props: {
            items: {
              $query: {
                entity: 'TextBlock',
                scope: {
                  anchor: 'CollectionBlock',
                  via: 'children',
                  anchorId: { $: 'modules.transcribe.collectionId' },
                },
                // Oldest first, because a transcript read backwards is not a transcript.
                order: { createdAt: 'asc' },
              },
            },
            as: 'utterance',
          },
          children: [
            /*
                  Attribution needs no diarization: each agent transcribes only their own
                  microphone, so the block's author *is* the speaker. `$agent` turns that DID
                  into a profile and demand-fetches it, so a peer gets a real name and face
                  rather than a generated blob — and it reaches anyone, not only this space's
                  members.
                */
            {
              type: '$agent',
              props: { did: { $: 'utterance.author' }, as: 'speaker' },
              children: [
                {
                  type: 'Column',
                  props: { bg: 'surface-sunken', r: '300', p: '300', gap: '100' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        {
                          type: 'we-avatar',
                          props: {
                            size: 'xxs',
                            image: { $: 'speaker.avatar' },
                            // Always alongside `image`, never instead of it: a stable
                            // generated avatar keeps somebody whose profile has not
                            // arrived visually distinct from everybody else whose
                            // profile has not arrived.
                            hash: { $: 'utterance.author' },
                          },
                        },
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-muted', truncate: true },
                          children: [{ $: 'speaker.name' }],
                        },
                        {
                          type: 'we-timestamp',
                          props: {
                            value: { $: 'utterance.createdAt' },
                            relative: true,
                            fontSize: '100',
                            color: 'text-faint',
                          },
                        },
                      ],
                    },
                    { type: 'we-text', props: { color: 'text' }, children: [{ $: 'utterance.text' }] },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  ],
};

/**
 * Why nothing is happening, when nothing is.
 *
 * Every reason this module can produce no text, in one place: still starting, nothing to listen to,
 * a backend with no speech-to-text, no model installed — and the error alert when it failed outright.
 * From the reader's side an empty panel means all of those equally well, and only some of them are
 * worth acting on, so each one says which it is and the fixable one carries the button that fixes it.
 *
 * ## Why this is named
 *
 * It is the difference between "this isn't working" and "this can't work here, and here is why".
 * An interface arranging the module's pieces itself gets the transcript, the meter and the unsaved
 * line — all of which look normal-and-idle on a node with no transcription model at all — so
 * without this the one state that needs a person to do something is the one state with nothing on
 * screen. Placing it is a choice; not having it available was not.
 *
 * One part rather than five, because they are one sentence answered five ways and no interface has
 * a reason to take the missing-model case and refuse the no-audio one. The `Column` is the panel's
 * own gap made explicit, so this reads identically whether placed here or somewhere else.
 *
 * No `subject`: these are facts about this agent's session and this node, not about a call record.
 */
export const captureStatus: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: "modules.transcribe.status == 'starting'" },
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-spinner', props: { size: 'sm' } },
            { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['Starting…'] },
          ],
        },
      },
    },
    {
      // The panel opened, nothing recorded yet, nothing wrong. Without this the box is empty and
      // reads as broken rather than as waiting.
      //
      // Gated on there being no *record*, not on a session buffer being empty. The buffer was
      // session-local, so re-opening the panel on a call that had already been transcribed
      // offered to start recording as though nothing had ever been said. A collection is created
      // on the first utterance, so its absence is exactly "nothing has been said here".
      type: '$if',
      props: {
        condition: { $: '!modules.transcribe.enabled && !modules.transcribe.collectionId' },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted', italic: true },
          children: [
            {
              $: "modules.transcribe.available ? 'Press record to transcribe what is said into text blocks in this space.' : 'Join a call and press record to transcribe what is said.'",
            },
          ],
        },
      },
    },
    note('no-audio', 'microphone-slash', 'Nothing to listen to. Start or join a call and this will follow it.'),
    note('no-backend', 'plugs', 'This backend cannot transcribe — no speech-to-text is reachable from here.'),
    note(
      'no-model',
      'warning',
      'No transcription model is installed. Add one and transcription will start on its own.',
      {
        // Offered only where the section exists. AI administration is node-scoped, so a guest on
        // somebody else's executor — which includes every web session against a remote host —
        // has no AI settings to open, and a button that opens Settings to nothing is worse than
        // no button. The `else` says who can fix it instead.
        type: '$if',
        props: {
          condition: { $: 'runtimeStore.canManageAi' },
          then: {
            type: 'we-button',
            props: {
              size: 'sm',
              variant: 'secondary',
              // The point of naming the reason is that it can be acted on, so the panel goes
              // there rather than describing where to look.
              onClick: { $action: 'shellStore.openShellView', args: ['settings', '/ai'] },
            },
            children: ['Open AI settings'],
          },
          else: {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-faint' },
            children: ['Models are configured on the node this app is connected to.'],
          },
        },
      },
    ),
    {
      type: '$if',
      props: {
        condition: { $: "modules.transcribe.status == 'error'" },
        then: {
          type: 'we-alert',
          props: { variant: 'warning' },
          children: [{ $: 'modules.transcribe.error' }],
        },
      },
    },
  ],
};

/**
 * What has been heard but not written down yet.
 *
 * The other half of "is this working", and the half the feed structurally cannot show. An utterance
 * is only a record once the speaker has stopped, the audio has gone to the model and the block has
 * been written — several seconds during which a panel showing saved lines alone looks exactly like
 * a panel that has stopped listening. This is that gap, said out loud.
 *
 * `accent-muted` rather than the feed's `surface-sunken`, and labelled: it is deliberately not one
 * of the transcript's rows. What it holds is provisional — the model has not seen it, so the words
 * can change before they land — and a block that looked like the others would be quietly asserting
 * otherwise.
 *
 * ## Why this is named
 *
 * Same reason as `captureMeter`, and it is the more useful of the two: a template placing the feed
 * gets the saved lines and, without this, a several-second silence after every sentence. Placed
 * *below* the feed rather than above it — the feed pins to its own end, so the two together read as
 * one column that keeps filling downward, and the unsaved line sits where the saved one is about to
 * appear.
 *
 * No `subject`, for `captureMeter`'s reason: this is this agent's own buffer, not a property of any
 * call record.
 */
export const pendingUtterance: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.transcribe.pending' },
    then: {
      type: 'Column',
      props: { bg: 'accent-muted', r: '300', p: '300', gap: '200' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted', uppercase: true },
              children: ['Not saved yet'],
            },
            {
              // The buffer flushes on its own; this is for somebody who has stopped talking and
              // wants the line in the record now rather than at the end of the window.
              type: 'we-button',
              props: { variant: 'ghost', size: 'xs', onClick: { $action: 'modules.transcribe.flushNow' } },
              children: ['Save now'],
            },
          ],
        },
        { type: 'we-text', children: [{ $: 'modules.transcribe.pending' }] },
      ],
    },
  },
};

/**
 * The transcript as almost everything wants it: the saved lines and the one being said, scrolling
 * together and following the tail.
 *
 * ## Why the unsaved line is *inside* the scroll area
 *
 * It used to sit outside it, above the feed in this panel and below it in the workshop's, and both
 * were wrong in the same way. The scroll region takes the panel's spare height, so on a transcript
 * with two lines in it the saved words are at one end of a mostly-empty box and the unsaved line is
 * pinned at the other — and the first sentence to be written appears to leap the gap. Put in the
 * flow with the rows, it sits immediately after the last one whether there are two of them or two
 * hundred, and `pin: 'end'` follows it down. The words never move.
 *
 * ## Composed from the part rather than repeating it
 *
 * `$part` inside a part, which the resolver expands recursively — and the subject substitution
 * reaches the inner marker, because it is a whole-token rewrite over this node before the nesting
 * is resolved. So pointing this feed at another call points its rows at that call too, and there is
 * one query in the codebase rather than two that have to agree.
 */
export const transcriptFeed: SchemaNode = {
  type: 'we-scroll-area',
  // Follows the tail while somebody is at the tail, and holds still while they read further
  // up. A live transcript is the case this exists for.
  props: { pin: 'end', flex: '1', minHeight: '0' },
  children: [
    {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: '$part',
          props: { id: 'transcribe.transcriptLines', subject: { $: 'modules.transcribe.collectionId' } },
        },
        pendingUtterance,
      ],
    },
  ],
};

/**
 * Extraction, as a surface of its own.
 *
 * It used to be the lower half of the transcript panel, and the two were one panel because they are
 * one module. They are not one *thing*: a transcript follows this agent's microphone and is read
 * while somebody talks, and extraction follows a pass that may be a peer's, takes minutes, spends
 * tokens and is read afterwards. Bundled, the column was a transcript, a meter, a coverage line,
 * four status notes, an extract control, a chip row and a proposal list — two surfaces wearing one
 * coat, and the reason nobody could find the half they wanted.
 *
 * Opening itself when a pass starts is what makes this safe to separate, and it is the rule
 * recording already follows: starting something invisible and saying nothing about it is how a
 * feature comes to look broken. A pass any member starts opens this for everyone who has the module,
 * which is what the one-line signal in the call bar used to be for.
 */
export const extractionPanel: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'datasetStore.currentDataset && modules.transcribe.extractionOpen' },
    then: {
      type: 'Column',
      props: { width: '100%', height: '100%', p: '400', gap: '400', overflow: 'hidden' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center', gap: '300' },
          children: [
            { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Extraction'] },
            /*
              Whether this conversation is read as it happens, and it is a *call's* switch.

              The space has a standing answer and an administrator sets it; this is the people in the
              room deciding about the room. Disabled where there is no call to record a decision
              against — `canChooseTargets` asks about the same record, which is why it answers for
              both — rather than absorbing a press and looking broken.
            */
            {
              type: 'we-switch',
              props: {
                size: 'sm',
                label: 'As it happens',
                checked: { $: 'modules.transcribe.autoExtract' },
                disabled: { $: '!modules.transcribe.canChooseTargets' },
                onChange: { $action: 'modules.transcribe.toggleAutoExtract' },
              },
            },
          ],
        },
        /*
          Absent outside a call rather than disabled, and the sentence says which.

          Every other reason extraction is unavailable is about the node — no model, an executor that
          cannot interpret — and `extract` says those itself. This one is that there is no
          conversation yet, which is not a fault and not fixable from here.
        */
        {
          type: '$if',
          props: {
            condition: { $: '!modules.transcribe.extractable' },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted', italic: true },
              children: ['Nothing to read yet. What a call produces appears here as it is found.'],
            },
          },
        },
        extract,
      ],
    },
  },
};

export const panel: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'datasetStore.currentDataset && modules.transcribe.open' },
    then: {
      type: 'Column',
      props: {
        /**
         * Fills the box the host gave it. It used to position itself — `fixed`, `right: 48px`, a
         * hardcoded copy of the module rail's width — which meant it overlaid the space rather than
         * making room in it, sat on top of the editor's controls, and stayed put when a docked call
         * panel took the edge out from under it. All three are the host's job; see `docks` below.
         */
        width: '100%',
        height: '100%',
        p: '400',
        gap: '400',
        overflow: 'hidden',
      },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Transcript'] },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'modules.transcribe.listening' },
                    // `solid`: this is the news, not an annotation on it. Soft would paint the dark
                    // tint and a pale label, which reads as a note about recording rather than as
                    // the fact that it is happening.
                    then: {
                      type: 'we-badge',
                      props: { variant: 'danger', appearance: 'solid', size: 'xs' },
                      children: ['REC'],
                    },
                  },
                },
              ],
            },
            {
              type: 'Row',
              props: { gap: '100', ay: 'center' },
              children: [
                {
                  // The panel's own record control. The call bar is the natural place for it during a
                  // call, but the panel has to be self-sufficient: it opens outside a call too, and a
                  // template may place neither the bar nor the rail.
                  type: 'we-button',
                  props: {
                    variant: { $: "modules.transcribe.enabled ? 'secondary' : 'ghost'" },
                    size: 'sm',
                    disabled: { $: '!modules.transcribe.enabled && !modules.transcribe.available' },
                    onClick: { $action: 'modules.transcribe.toggle' },
                    title: { $: "modules.transcribe.enabled ? 'Stop transcribing' : 'Start transcribing'" },
                  },
                  children: [
                    {
                      type: 'we-icon',
                      props: {
                        name: 'record',
                        /*
                          Not `weight: 'fill'` while listening, and not `danger-text` — the two bugs
                          `CallControl.schema.ts` documents fixing on the call bar's own record
                          button, still here on the panel's.

                          Only the `regular` weight of any icon is bundled, so every other weight is
                          a CDN fetch; this one fired at the moment recording started, which on an
                          offline machine made the icon vanish as you pressed it. And `danger-text`
                          is a foreground measured for reading against a page — `danger-700`, which
                          inverts to a pale pink in a dark theme. A record dot is a mark, so it wants
                          the fill.
                        */
                        color: { $: "modules.transcribe.listening ? 'danger' : ''" },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },

        // ── Is it hearing me? ────────────────────────────────────────────────
        captureMeter,

        // ── Is it hearing everyone else? ─────────────────────────────────────
        coverage,

        // ── Why nothing is happening, when nothing is ────────────────────────
        captureStatus,

        // ── What has been heard, and what is still being said ────────────────
        // One node, not two: the unsaved line lives inside the feed's scroll region, immediately
        // after the last saved row. See `transcriptFeed`.
        transcriptFeed,
      ],
    },
  },
};
