/**
 * The transcription panel — live feedback while transcribing, and nothing when not.
 *
 * Shown while the store's `open` says so, not while we are recording. Those were one flag to begin
 * with, which meant the transcript disappeared the instant you stopped recording — exactly when you
 * want to read it — and left no way to check what had been captured without starting again.
 *
 * So: the call bar's button records, this panel shows, and either can be true without the other.
 * Recording does open the panel once, because starting something invisible and saying nothing about
 * it is how a feature comes to look broken — which is also why the module owns the flag rather than
 * leaving it to the host; see `panels` in `index.ts`.
 *
 * In its own `.schema.ts` file so `pnpm --filter @we/schema-shared validate` checks it. The validator
 * walks files by that name, and module fragments declared inline in an `index.ts` were invisible to
 * it — which is how a module could ship a typo'd prop that only appears as a component silently not
 * rendering. The other three modules still declare their fragments inline; this is the shape they
 * should move to.
 */
import { emptyState, panelScroll, panelShell, sectionLabel } from '@we/schema-kit';
import { type SchemaNode, type SchemaProp } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

import { CARET_SIZE, codePane, extractionActivity } from './ExtractionStatus.schema';
import { SUBJECT_EXPR as SHARED_SUBJECT_EXPR, VIEWING_LIVE_EXPR } from './subject';

/**
 * Which call this panel is about — the one named in the address, or the one being recorded.
 *
 * A transcript surface has always had two possible subjects and only ever admitted to one. The
 * workshop template noticed first and answered it by supplying a whole panel body of its own, which
 * bought route-awareness at the price of a second copy of the header, the feed and the gating — and
 * the copy promptly drifted: it never gained `coverage` or `captureStatus`, and the first fix to
 * land on the scroll area landed on one of the two.
 *
 * It is not template knowledge. "Show the call the address names, else the live one" is what any
 * transcript panel should do, so it lives here and every interface gets it by placing the panel.
 *
 * `collectionId` rather than the call module's record id: the collection is created on the first
 * utterance, so its absence is exactly "nothing has been said here", which is the question
 * `captureStatus` is already answering. A call with a record and no words is not a transcript.
 */
export const SUBJECT_EXPR = SHARED_SUBJECT_EXPR;
const SUBJECT = { $: SUBJECT_EXPR };

/**
 * Whether the call on screen is the one being recorded, as opposed to one being looked back at.
 *
 * Everything about *this agent's microphone* is gated on it — the meter, the coverage readout, the
 * status notes, the unsaved line and the record button. A bar moving beside last month's meeting
 * would be measuring the wrong thing and saying so confidently.
 *
 * ## Naming a call is not the same as reading one back
 *
 * This used to be "the address names a call", and the two coincided for as long as the only way to
 * pick a call up was a button that cleared the parameter as it went. The module rail can now
 * continue the call on screen, which leaves the address naming it — so the panel called a meeting
 * in progress a past one, and hid the level meter, the coverage readout, the unsaved line and the
 * REC badge for the rest of it.
 *
 * The honest question is whether the call named is the one being recorded, and this module can
 * answer it without naming another: `callId` is what it is about, falling back to the live call's
 * own record, so it is set from the moment a call is joined rather than from the first thing said.
 *
 * Read from the address rather than derived from `SUBJECT`, because whole-token substitution cannot
 * rewrite an expression that merely mentions the subject: a `$part` pointed at another call is
 * expected to be on a route that names it, which is what `SUBJECT_EXPR` already assumes.
 */
const VIEWING_LIVE = { $: VIEWING_LIVE_EXPR };

/**
 * The words for an empty transcript, and why they read this module's own store.
 *
 * Three sentences for three situations: already in a call (nothing to offer), somebody is in the
 * call on screen (join them), nobody is (continue it). Both facts used to be read off the call
 * module — `modules.call.active`, `modules.call.liveCalls` — which was the one place this module
 * named that one, against the rule that capabilities meet in a medium and never in each other. They
 * are read off presence now, through this module's own `inCall` and `callOnScreenLive`.
 *
 * `modules.call` as a bare condition is the one permitted reference: it asks whether the module is
 * installed at all, which is the documented way to depend on an optional module, and without it the
 * offer to join or continue would be made in a deployment with nothing to make it with.
 */
const IN_A_CALL = 'modules.transcribe.inCall';
const CALL_ON_SCREEN_LIVE = 'modules.transcribe.callOnScreenLive';

/**
 * Which call the *extraction* surface is about.
 *
 * The same shape as `SUBJECT_EXPR`, and a different fallback for a reason worth writing down.
 * `collectionId` is what the transcriber is writing into and is null until somebody speaks, which is
 * the honest answer for a transcript — no collection, nothing said. Extraction is asked earlier than
 * that: choosing what a meeting will look for, before the meeting, is exactly when somebody wants
 * to, and the call's own record exists from its first second. `callId` is that record.
 */
export const EXTRACTION_SUBJECT_EXPR = 'routeStore.params.call ? routeStore.params.call : modules.transcribe.callId';
const EXTRACTION_SUBJECT = { $: EXTRACTION_SUBJECT_EXPR };

/**
 * What is staged on the call this panel is showing, waiting on somebody.
 *
 * Keyed on the subject rather than read as "the live call's", which is what it used to be. Two
 * things were wrong with that and only one was visible: a panel opened on a *past* call listed
 * whatever the live one had staged, and — the reported symptom — reopening any call after a restart
 * listed nothing at all, because the flat list was only ever filled by a pass settling or by the
 * transcriber adopting a record, and neither happens on a fresh boot. Reading a key fetches it.
 */
const PROPOSALS = `modules.transcribe.proposalsFor[${EXTRACTION_SUBJECT_EXPR}]`;

/**
 * The two kinds of suggestion, which are two different questions.
 *
 * A `create` is a record a pass made: "should this exist?", answered Keep or Discard. An `update` is a
 * change a pass suggested to a record somebody already owns: "should this value change?", answered
 * per field with Accept or Reject, and read as old → new. One list drew both as the first, so a
 * change to an agreed task looked like a draft of it. Anything that is not an update is treated as
 * new, since that is the question every older proposal was being asked.
 */
const NEW_PROPOSALS = `${PROPOSALS}.filter(p, p.kind != 'update')`;
const CHANGE_PROPOSALS = `${PROPOSALS}.filter(p, p.kind == 'update')`;

/**
 * Everything the passes wrote here, newest first — one subscription, whatever the types.
 *
 * Read through `CollectionBlock.extracted` rather than through `children`, which is the difference
 * between a question the graph can answer and one it cannot. `children` holds the transcript too and
 * an untyped include carries no class constraint, so "what did this call produce" through it means
 * fetching every utterance and sorting them out afterwards. The provenance link *is* the answer, so
 * an include over it comes back as exactly the records a model wrote, each hydrated as its own class.
 *
 * The staged suggestions are dropped here rather than by the query: whether a record is still
 * awaiting a decision is not a property of it, and there is nothing in the graph to ask. The list of
 * pending ids is in hand and is a handful.
 */
const EXTRACTED_ROWS = 'first(local.extractedFrom).extracted.filter(r, !(r.id in modules.transcribe.unconfirmedIds))';

/** How many of them, for the badge beside the heading. The list is small by construction. */
const EXTRACTED_COUNT = `count(${EXTRACTED_ROWS})`;

/**
 * The changes to already-agreed records that somebody kept — the fourth quadrant of this panel.
 *
 * Three of the four were always answerable: a suggestion waiting, a change waiting, and a record
 * kept. The fourth had nothing behind it, because applying a change resolved its overlay and wrote
 * nothing down — so a task the conversation moved from "todo" to "done" left the panel with no
 * account of it at all, and the record itself with a new value and no provenance.
 *
 * `ExtractionAmendment` is that account, and this is the list of them. No filter, unlike
 * {@link EXTRACTED_ROWS}: an amendment exists only because somebody accepted one, so there is no
 * unconfirmed state to take back out.
 */
const AMENDMENT_ROWS = 'first(local.extractedFrom).amendments';
const AMENDMENT_COUNT = `count(${AMENDMENT_ROWS})`;

/** What the store says can be extracted from that call — see `extractionFor` on the store. */
const forSubject = (field: 'targets' | 'canChoose' | 'canExtract') => ({
  $: `modules.transcribe.extractionFor[${EXTRACTION_SUBJECT_EXPR}].${field}`,
});

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
 * Named as a part because a template that supplies its own transcript panel otherwise loses the
 * answer to "is it hearing me". That is the one question a transcript cannot answer for itself: an
 * utterance takes seconds to buffer, transcribe and write, so a panel showing only saved lines is
 * indistinguishable from a broken microphone for the whole of that delay.
 *
 * The workshop template used to be that consumer, and its copy of the panel never placed this — so
 * the interface built around recording a meeting said *less* about a failing microphone than the
 * default one did. It places the whole panel now, which is the better answer to a shared piece; the
 * part stays for the interface that genuinely wants a different arrangement.
 *
 * No `subject`. Unlike the feed, this is about the microphone *this agent* is running right now,
 * which is a property of the session and not of any call record — pointing it at another call
 * would be pointing a live meter at something that is not being measured.
 */
/**
 * How everything about the microphone arrives and leaves: a fade, and deliberately never a reveal.
 *
 * A fade changes only opacity, so the element holds its box throughout — which is the whole point in
 * both directions. Reveal animates the height instead, and the height is the thing that must not
 * move while anything else is on screen changing.
 *
 * ## Leaving
 *
 * Leaving a call takes the meter, the coverage readout and the section around them away at once, and
 * the placeholder underneath is mid-fade at that moment: the renderer keeps an outgoing branch
 * mounted for the length of its exit, so the sentence was still painted when the space above it
 * vanished, and slid up the panel while transparent. This is longer than the placeholder's own exit,
 * so the order is the sentence finishing, then the height going, with nothing visible left to move.
 *
 * ## Arriving
 *
 * The same string, for symmetry and for a real reason. Without an explicit `enterTransition` the
 * renderer sets opacity straight to 1 in the effect, with no painted start value to interpolate
 * from — so whether anything actually faded depended on whether this box had been shown before,
 * which is not a difference anybody chose. Declared, it always fades.
 *
 * Nothing about the reflow changes either way: the box claims its space the moment it renders,
 * transparent or not, so what this decides is only whether the contents appear or resolve.
 *
 * All three levels carry it. The section's own fade holds nothing if the meter and the readout have
 * already unmounted from inside it, and those two answer to different facts — the readout to a
 * microphone existing, the meter to recording — so each has to hold its own height.
 */
const MIC_FADE = { type: 'fade', duration: 300 };

export const captureMeter: SchemaNode = {
  type: '$if',
  props: {
    /*
      A microphone to speak into, whether or not it is being listened to.

      This asked `enabled`, so pressing stop mid-call took the whole meter out and everything below
      it jumped up the panel — worst where there is most to lose, a long transcript, since the rows
      move under the eye that is reading them. Holding the box and reporting that it is off costs the
      same space and moves nothing.

      Which makes it the same question the section around it asks, and that is deliberate: the meter
      is the section's whole reason to exist, so a state where one is up and the other is not would
      be a gap where a readout should be. Kept as a condition rather than dropped, because this is a
      part an interface can place on its own, and placed outside a call it should render nothing.
    */
    condition: { $: 'modules.transcribe.enabled || modules.transcribe.available' },
    enterTransition: MIC_FADE,
    exitTransition: MIC_FADE,
    then: {
      type: 'Column',
      props: { gap: '100' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center' },
          children: [
            {
              type: 'Row',
              props: { ay: 'center', gap: '200' },
              children: [
                {
                  /*
                    The glyph carries the off state, and it is present in both so the row cannot
                    change height between them.

                    That is the whole point of this arrangement: an icon that appears only when
                    switched off would put the height back at the mercy of whether a 16px glyph fits
                    inside a footnote's line box, which is the thing being avoided. Swapping the mark
                    leaves the geometry identical by construction.
                  */
                  type: 'we-icon',
                  props: {
                    size: 'sm',
                    name: { $: "modules.transcribe.enabled ? 'microphone' : 'microphone-slash'" },
                    color: { $: "modules.transcribe.enabled ? 'text-muted' : 'text-faint'" },
                  },
                },
                {
                  type: 'we-text',
                  props: {
                    variant: 'footnote',
                    color: { $: "modules.transcribe.enabled ? 'text-muted' : 'text-faint'" },
                  },
                  children: ['Microphone'],
                },
              ],
            },
            {
              /*
                Says which side of the threshold we are on, for anyone who cannot read the bar — and
                says "off" where there is no threshold to be on a side of.

                Three words, and no fourth for the moment the audio graph is opening. That moment had
                a row of its own once — a spinner and "Starting…" under the meter, which moved
                everything below it as it came and went — and then, briefly, this label, which was
                cheaper but still a word nobody could read changing to another. "quiet" is already
                true while a stream is coming up: the bar is at zero because nothing has been heard
                yet, which is the same thing it means a second later. A meter that says one stable
                thing is worth more than one that narrates its own setup.
              */
              type: 'we-text',
              props: {
                variant: 'footnote',
                color: { $: "modules.transcribe.speaking ? 'success-text' : 'text-faint'" },
              },
              children: [
                {
                  $: "!modules.transcribe.enabled ? 'off' : " + "modules.transcribe.speaking ? 'hearing you' : 'quiet'",
                },
              ],
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
                  /*
                    Empty while switched off, rather than frozen at whatever was last heard.

                    `levelPercent` is a live reading, and the audio graph is torn down on stop — so
                    the last value before it went is a number about a moment that has passed, and
                    leaving it painted is a bar reporting sound nobody is listening to. Zero is what
                    an idle meter shows.
                  */
                  width: { $: "modules.transcribe.enabled ? modules.transcribe.levelPercent : '0%'" },
                  transition: 'width 80ms linear',
                  'max-width': '100%',
                },
              },
            },
            {
              /*
                The onset threshold, read from the store so it cannot drift from the VAD's own value.

                Faint while switched off. It marks the point a sound has to cross to be heard, and
                nothing is being heard — a mark at full strength on an empty trough reads as a
                measurement rather than as the furniture of one.
              */
              type: 'Row',
              props: {
                position: 'absolute',
                top: '0px',
                height: '100%',
                width: '2px',
                bg: { $: "modules.transcribe.enabled ? 'border-strong' : 'border'" },
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
 * happening and somebody can still press Transcribe.
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
    /*
      Somebody to count, **and** a microphone to count them against.

      Joining a call is a second in which every part of this is true and wrong: you are in the call,
      your own microphone is not up yet, so it read "0 of 1 transcribing" in warning orange with the
      line below about only those microphones reaching the record. Both resolved before anybody
      could read them, and the line arriving and then leaving moved everything under it twice.

      A delayed fade was tried first and made it worse. `$animate` keeps its child mounted and a
      fade only touches opacity, so the readout reserved its full height while invisible: the panel
      opened a hole, sat on it, and then filled it in. Nothing about *when it is drawn* can fix a
      readout that should not be there at all.

      `available` is the honest test, because it separates the two states that look alike. No audio
      means the session is still coming up, and there is nothing to report yet. Audio with no
      recording is a decision — somebody pressed stop, or auto-join is off — and that is exactly
      when a coverage gap is worth stating. So this is dark through the join and lit the moment the
      microphone exists, which is the same moment the meter above it appears.

      ## The count, and nothing under it

      There was a second line while the count was short: "Only what those microphones hear reaches
      this record." It was wrong as well as wordy. This panel has a composer, and a typed line is in
      the record without any microphone hearing it — so the sentence overstated the gap it was
      warning about, in a panel that offers the very thing it forgot.

      The count already carries the warning. It turns from `success-text` to `warning-text` when
      somebody is not being transcribed, which is the whole signal; a sentence appearing underneath
      to explain a number is the kind of chrome people stop reading before the day it matters. That
      argument was already in the note it replaced, one level up.
    */
    condition: { $: 'count(modules.transcribe.callAgents) && modules.transcribe.available' },
    // Holds its height in both directions — see `MIC_FADE`. Its own `available` empties before the
    // section's condition does, so without this the box above the transcript loses this much of its
    // height early, while the placeholder below is still fading.
    enterTransition: MIC_FADE,
    exitTransition: MIC_FADE,
    then: {
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
  },
};

/** What the card knows about the model it is a suggestion of — see `recordStore.displays`. */
const DISPLAY = 'recordStore.displays[proposal.entity]';

/**
 * The glyph that stands in for a field's caption, or empty when nothing sensible does.
 *
 * Derived from what the model declares rather than from a table of field names this panel happens to
 * know. A relation takes the **target model's own icon**, which is the general form of the answer: a
 * place shows a pin because `LocationBlock` says its icon is a pin, and a community's own model shows
 * whatever icon that community chose, with nothing written here for either.
 *
 * Empty is a real answer — a plain string field has no honest glyph, and the row keeps its caption.
 * Guessing one from the property name would be right for the handful we thought of and quietly wrong
 * for everything a community defines.
 */
const FIELD_ICON =
  `field.kind == 'relation' ? recordStore.displays[field.target].icon ` +
  `: field.kind == 'datetime' ? 'clock' ` +
  `: field.kind == 'date' ? 'calendar' ` +
  `: field.kind == 'url' ? 'link' ` +
  `: field.kind == 'number' ? 'hash' : ''`;

/**
 * A moment, with the time shown only when there is one.
 *
 * An all-day event is stored as `T00:00`, so a midnight time is the signal that no time was said —
 * and printing "00:00" under a trip to Bristol is both noise and a small lie. Read off the value
 * rather than off a sibling `allDay` field, because a generic renderer cannot know that one property
 * governs another; the declaration says nothing about the pair, and the midnight test needs nothing
 * from it. An event genuinely at midnight loses its time, which is rare and costs a reader nothing.
 */
const timestamp = (withTime: boolean, value: string): SchemaNode => ({
  type: 'we-timestamp',
  props: {
    value: { $: value },
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
    fontSize: '100',
  },
});

/**
 * How a card reads one property off the row it is drawn for.
 *
 * The two lists this panel shows are the same cards over different shapes. A *suggestion* is an
 * overlay the backend has not committed — its values arrive as a list of `{ name, value }` pairs,
 * because nothing has been written yet and there is no record to read. An *extracted record* is an
 * ordinary record with ordinary properties.
 *
 * So the card is written against this pair rather than against either, which is what lets one
 * definition draw both. Everything else on a card — the kind, the title, which fields count as
 * detail — comes from `recordStore.displays`, and that is the same lookup for both.
 */
interface CardShape {
  /** The display descriptor for this row's model. */
  display: string;
  /** Given an expression naming a property, the expression reading its value. */
  value: (name: string) => string;
  /**
   * Whether this row has anything to show for a field — `field` is the expression naming it.
   *
   * Separate from `value` because "empty" is not the same question for the two shapes, and getting
   * it wrong is visible: a card listed Comments, Signals, Participants, Calls and Mentions under
   * every extracted task, each with a caption and nothing after it.
   */
  present: (field: string) => string;
}

/**
 * A suggestion: values in a `fields` list, since no record exists to read them off yet.
 *
 * A field the pass did not propose is simply absent from the list, so a plain truthiness test is the
 * whole of emptiness here — which is why this card never had the problem the record one did.
 */
const PROPOSAL_SHAPE: CardShape = {
  display: DISPLAY,
  value: (name) => `find(proposal.fields, { name: ${name} }).value`,
  present: (field) => `find(proposal.fields, { name: ${field}.name }).value`,
};

/**
 * An extracted record: ordinary properties, indexed by whichever name the declaration gives.
 *
 * Emptiness needs the `many` flag. Every declared relation becomes a detail field, and a record
 * carries its to-many relations as *lists* — an empty one is an empty array, which is truthy, so a
 * plain truthiness test kept every one of them. That is where "Comments / Signals / Participants /
 * Calls / Mentions" came from on a task that had none of any: `WeNode` declares all five, so every
 * model in the space inherits them, and a card built from the declaration showed all five captions
 * over nothing.
 *
 * `count` answers for a list and gives 0 for anything else, so it cannot stand in for the scalar
 * test — hence the branch rather than one expression for both.
 */
const RECORD_SHAPE: CardShape = {
  /*
    Keyed on the class the row turned out to be, not on a name the list was built from.

    A polymorphic read stamps every member with its concrete entity under `__subjectClass` — the
    wire contract for exactly this, so a consumer can pick a display per row rather than assuming
    one. It replaces the old `target`, which existed because the list was one query per model and
    each group therefore knew its own type in advance. One list has no such name.

    Not `item.type`: `CollectionBlock` has a real `type` property of its own, so that spelling means
    something else on half the rows a call can hold.
  */
  display: 'recordStore.displays[item.__subjectClass]',
  value: (name) => `item[${name}]`,
  present: (field) => `(${field}.many ? count(item[${field}.name]) : item[${field}.name])`,
};

/**
 * One field of the model, as the card shows it.
 *
 * Driven by the **declaration** rather than by what the pass happened to propose. That is the whole
 * difference between this and what it replaced: reading the proposal's own keys put `occurrence` — a
 * dedup key whose docblock says it is "not a display value" — on every event card, in the order the
 * value map happened to be built.
 *
 * `detail` role only. The title and the summary are drawn large above, and a field repeated under
 * its own heading reads as a mistake.
 */
const detailRows = (shape: CardShape): SchemaNode => ({
  type: '$each',
  props: {
    items: { $: `${shape.display}.fields.filter(f, f.role == 'detail' && ${shape.present('f')})` },
    as: 'field',
  },
  children: [
    {
      type: 'Row',
      props: { gap: '100', ay: 'center', wrap: true },
      children: [
        {
          /*
            The glyph, or the caption — never both, and never neither.

            A tooltip carries the caption wherever the glyph replaces it, so the field stays
            identifiable to somebody who cannot guess a pin and to a screen reader, which would
            otherwise read a value with nothing saying what it is.
          */
          type: '$if',
          props: {
            condition: { $: FIELD_ICON },
            then: {
              type: 'we-tooltip',
              props: { content: { $: 'field.label' } },
              children: [{ type: 'we-icon', props: { size: 'xs', name: { $: FIELD_ICON }, color: 'text-faint' } }],
            },
            else: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: [{ $: 'field.label' }],
            },
          },
        },
        {
          /*
            How the value is drawn, by kind — a formatted moment for a date, the related record's own
            name for a relation, and the text for everything else.

            None of this names a model. A community shape's own dates get the formatting, and its own
            relations resolve through the same lookup.

            ## A closed vocabulary is not a badge here

            It was: a status or a priority came out as a coloured chip, on the reasoning that a value
            from a closed set is a state rather than a phrase. True, and it made two fields on the
            card louder than the rest — a date sits as plain text on the same row, and a task's
            status is not more worth reading than an event's start. These are the *details* of a
            suggestion nobody has agreed to yet, and drawing two of them as chips gave a card two
            focal points besides its own headline.

            The board is where a status earns its colour, because there a column *is* the status and
            the colour is the community's own. Here it is one line among several.
          */
          type: '$if',
          props: {
            condition: { $: "field.kind == 'date' || field.kind == 'datetime'" },
            then: {
              type: '$if',
              props: {
                condition: { $: `endsWith(${shape.value('field.name')}, 'T00:00')` },
                then: timestamp(false, shape.value('field.name')),
                else: timestamp(true, shape.value('field.name')),
              },
            },
            else: {
              type: '$if',
              props: {
                condition: { $: "field.kind == 'relation'" },
                /*
                      A relation's value is the target's id, which is not worth showing anybody. The
                      record it names is fetched and drawn by whichever property that model calls its
                      title — the same `displays` lookup the card itself is built from, one level in.
                    */
                then: {
                  type: '$single',
                  props: {
                    item: {
                      $query: {
                        entity: { $: 'field.target' },
                        where: { id: { $: shape.value('field.name') } },
                        limit: 1,
                      },
                    },
                    as: 'related',
                  },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', truncate: true },
                      children: [{ $: 'related[recordStore.displays[field.target].title]' }],
                    },
                  ],
                },
                else: {
                  type: 'we-text',
                  props: { variant: 'footnote', truncate: true },
                  children: [{ $: shape.value('field.name') }],
                },
              },
            },
          },
        },
      ],
    },
  ],
});

/**
 * What kind of thing a card is about, in the model's own icon and word.
 *
 * Absent where the model is unknown — an executor predating `subjectClassesOf` classifies nothing,
 * and a suggestion it could not name falls back to its flat summary rather than to a blank line.
 */
const cardKind = (shape: CardShape): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: `${shape.display}.label` },
    then: {
      type: 'Row',
      props: { gap: '100', ay: 'center', minWidth: '0' },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: `${shape.display}.icon` },
            /*
              `sm`, a step up from the caption beside it.

              At `xs` it matched the uppercase footnote it sits with, so the pair read as one run of
              small grey furniture. The glyph is the fastest way to tell a task card from an event
              card in a grid of them, which makes it the half of that pair worth seeing first.
            */
            then: {
              type: 'we-icon',
              props: { size: 'sm', name: { $: `${shape.display}.icon` }, color: 'text-muted' },
            },
          },
        },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted', uppercase: true, truncate: true },
          children: [{ $: `${shape.display}.label` }],
        },
      ],
    },
  },
});

/**
 * The headline and the line under it, drawn from whichever properties play those roles.
 *
 * `label` rather than `footnote`, which is one step up the scale: everything on this card was the
 * same size once, so the bold on the headline was the only thing marking it as one — and bold at the
 * size of its own metadata reads as emphasis inside a paragraph rather than as a title above one.
 *
 * `fallback` is for a row whose model is unknown, which only a suggestion can be. An extracted
 * record is queried *by* its entity, so there is always a declaration to ask.
 */
const cardTitle = (shape: CardShape, fallback?: SchemaProp): SchemaNode => ({
  type: 'Column',
  props: { gap: '100' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: `${shape.display}.title` },
        then: {
          type: 'we-text',
          props: { variant: 'label', fontWeight: '600' },
          children: [{ $: shape.value(`${shape.display}.title`) }],
        },
        // The fallback plays the same role, so it takes the same size — bold is what it lacks, not
        // prominence.
        ...(fallback ? { else: { type: 'we-text', props: { variant: 'label' }, children: [fallback] } } : {}),
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: `${shape.display}.summary && ${shape.value(`${shape.display}.summary`)}` },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: [{ $: shape.value(`${shape.display}.summary`) }],
        },
      },
    },
  ],
});

/**
 * The model's own fields, as controls over the store's draft.
 *
 * Declaration-driven for the same reason the read view is, and with one deliberate narrowing: a
 * relation is left out. Editing one means picking a different record, which is a picker over
 * instances rather than a value in a text box — and the store's draft holds strings. Better absent
 * than present and unable to write what somebody chose.
 */
const proposalEditor: SchemaNode = {
  type: '$each',
  props: {
    items: { $: `${DISPLAY}.fields.filter(f, f.kind != 'relation' && find(proposal.fields, { name: f.name }).value)` },
    as: 'field',
  },
  children: [
    {
      type: 'we-form-field',
      props: { size: 'xs', label: { $: 'field.label' } },
      children: [
        {
          /*
            A control per kind: a calendar for a moment, a picker where the model closes the set, a
            box where it does not.

            The date branch is the one a generic editor most needs and is least likely to get. A
            moment is stored as an ISO string, so a text input renders it raw and asks somebody to
            edit `2026-09-14T15:30` by hand — every keystroke of which is a chance to write a string
            the parser will refuse. `we-date-picker` reads and writes the same string and is the
            control the host's own record form uses for this kind.

            `showTime` on `datetime` and not on `date`, which is the distinction the kind already
            draws — an all-day event has no time to pick and offering one invites a false precision
            the record cannot carry.

            The closed-set branch answers the way in for what the details no longer draw as a chip: a
            text box over `status` invites "pending" into a field whose model only knows three words,
            and the record then renders an unrecognised state everywhere it appears.
          */
          type: '$if',
          props: {
            condition: { $: "field.kind == 'date' || field.kind == 'datetime'" },
            then: {
              type: 'we-date-picker',
              props: {
                size: 'xs',
                showTime: { $: "field.kind == 'datetime'" },
                value: { $: 'modules.transcribe.proposalDraft[field.name]' },
                onChange: {
                  $action: 'modules.transcribe.setProposalField',
                  args: [{ $: 'field.name' }, { $: 'event.detail' }],
                },
              },
            },
            else: {
              type: '$if',
              props: {
                condition: { $: 'count(field.options)' },
                then: {
                  type: 'we-select',
                  props: {
                    size: 'xs',
                    value: { $: 'modules.transcribe.proposalDraft[field.name]' },
                    options: { $: 'field.options.map(o, { label: o, value: o })' },
                    onChange: {
                      $action: 'modules.transcribe.setProposalField',
                      args: [{ $: 'field.name' }, { $: 'event.detail' }],
                    },
                  },
                },
                else: {
                  type: 'we-input',
                  props: {
                    size: 'xs',
                    value: { $: 'modules.transcribe.proposalDraft[field.name]' },
                    onInput: {
                      $action: 'modules.transcribe.setProposalField',
                      args: [{ $: 'field.name' }, { $: 'event.detail' }],
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  ],
};

/**
 * Suggestions the backend staged instead of writing, and the controls that resolve them.
 *
 * Only appears when there are any, which is *not* always: a value is staged rather than written only
 * where a human already owns one, so a pass that only *creates* records leaves this empty. That is
 * the right default — a permanently empty "0 pending" box teaches people to stop looking at the
 * place their attention is eventually needed.
 *
 * ## Why it scrolls, and why that is not a `maxHeight`
 *
 * It used to be a plain column beside the panel's one scroll area, and a long call filled the panel
 * with it: a `Column` cannot shrink below its content unless it is told it may, so flexbox took the
 * whole deficit out of the results list underneath — which collapsed to nothing while the review
 * list ran off the bottom. `minHeight: '0'` is what makes this section shrinkable at all; the scroll
 * area inside it is then what the shrinking does. A pixel cap would have been a guess about a panel
 * whose height is the reader's to choose.
 *
 * ## A grid, because a card is not a paragraph
 *
 * `minChildWidth` rather than a column: widening the panel used to stretch each card to the full
 * width, which for four fields of a task is a strip of text with a button at the end of it. The
 * cards reflow into two and three abreast as the lane grows, and back to one in a narrow dock, with
 * no breakpoint to get wrong.
 *
 * ## Still `we-alert`
 *
 * The look is unchanged and deliberately so — `appearance: 'accent'` is a plain surface with a thick
 * status edge, which is what stops a run of these reading as a stack of brown rectangles in a dark
 * theme. It also keeps the warning glyph, which is what makes the state readable to somebody who
 * cannot tell the colours apart. What changed is only what is *inside* it.
 *
 * ## Editing, which this used to refuse
 *
 * The old note here said editing a suggestion is authoring and belongs to whatever normally edits
 * that record. That was true when the only thing staged was a single field of a record somebody
 * already owned. It stopped being true when a pass began proposing whole records: the reviewer is
 * then looking at the only surface that will ever show it *as a suggestion*, and sending them
 * somewhere else to fix a wrong title means keeping something known to be wrong, or discarding a
 * record that was mostly right.
 */
/**
 * A section's name, the size of what is under it, and the control that folds it — one row.
 *
 * The lists here can each run to a screenful and the panel scrolls as one thing, so without a way
 * to fold one, reaching the readings under a long list of suggestions means scrolling past all of
 * them every time. The count is what tells you whether folding is worth it.
 *
 * ## The whole row is the button, not the caret
 *
 * It was the caret alone, on the reasoning that `sectionLabel` draws a label and a label is not a
 * control. That is true of the fragment and does not decide this: the label stays a label, and a
 * *control wraps it*. What the narrow reading cost was a hit target the size of a glyph at the far
 * end of a row whose obvious target is the word naming the thing — and three headings where the
 * caret moved and the words did not, which reads as two different kinds of row.
 *
 * `bare` is the appearance-free clickable — a real `<button>`, with the keyboard activation and the
 * role that a `Row` carrying an `onClick` silently loses — so the heading looks exactly as it did.
 * The hover band is the affordance the caret's own darkening used to be, and it is the row's own
 * box: no padding is added, so the name stays aligned with the cards underneath it.
 *
 * `railGroup` in the template kit is the same shape for the same reason, which is worth knowing
 * before narrowing this again.
 *
 * ## What names it
 *
 * Nothing, explicitly: the accessible name comes from the contents, so it is "Logs 3" — the section
 * and its size, which is what the ARIA disclosure pattern asks a disclosure button to be called. The
 * caret button it replaces had to be named by hand (`Show the readings`) only because an icon-only
 * button has nothing to take a name from.
 *
 * What neither can say is whether the section is *open*: that wants `aria-expanded`, and a web
 * component's props are assigned as DOM properties, so no schema can set an attribute `we-button`
 * does not declare. The caret says it visually. Fixing it properly is a prop on the primitive, which
 * would also answer for `railGroup` and every openable row in this panel.
 */
const foldingSectionLabel = (opts: {
  label: string;
  /**
   * `neutral` for a section that is not a verdict.
   *
   * The other two badges mean something: amber is work waiting on a person, green is work that
   * landed. A log is neither — it counts how many times the call has been read, which is no more a
   * status than a timestamp is, and spending a status colour on it would say the readings are
   * themselves either pending or good.
   */
  count: string;
  tone: 'neutral' | 'warning' | 'success';
  field: string;
  /**
   * A control about the whole section — Logs' export — drawn between the name and the count.
   *
   * The heading is a `<button>` and a button inside a button is invalid markup that would also
   * toggle the section on the way past, so with an action the heading splits in two: the name, and
   * the count with its caret, each its own bare button folding the same section. The action sits in
   * the gap between them, beside the number it exports.
   */
  action?: SchemaNode;
}): SchemaNode => {
  const toggle = (children: SchemaNode[], extra: Record<string, unknown> = {}): SchemaNode => ({
    type: 'we-button',
    props: {
      variant: 'bare',
      // Nothing paints on hover: the pointer is the affordance, and a band the width of the panel
      // lighting up under the cursor is a lot of movement for a heading somebody is passing over on
      // the way to the cards. The radius is for the focus ring, which `we-button` draws itself and
      // which `bare` would otherwise take around a square-cornered full-width row.
      r: '200',
      onClick: { $toggleLocal: opts.field },
      ...extra,
    },
    children,
  });

  if (!opts.action) {
    return toggle([sectionLabel({ label: opts.label, aside: foldingCount(opts) })], { width: '100%' });
  }
  return {
    type: 'Row',
    props: { ay: 'center', gap: '200', width: '100%' },
    children: [
      toggle([sectionLabel({ label: opts.label })], { flex: '1', minWidth: '0' }),
      opts.action,
      // Named for what it does: its contents are a number and a caret, which say nothing read aloud.
      toggle([foldingCount(opts)], { label: `Show or hide ${opts.label.toLowerCase()}` }),
    ],
  };
};

/** The count and the caret at the end of a folding heading. */
const foldingCount = (opts: { count: string; tone: 'neutral' | 'warning' | 'success'; field: string }): SchemaNode => ({
  // `200`, where the label sits `200` from the badge: the caret is a separate thing from the
  // count, and at `100` the two read as one object with a number in it.
  type: 'Row',
  props: { ay: 'center', gap: '200' },
  children: [
    {
      type: 'we-badge',
      props: {
        size: 'xs',
        variant: opts.tone,
        appearance: 'solid',
        /*
          Square at its narrowest, and wider only when the number needs it.

          A badge is sized by its content, so `3` came out as a squat lozenge and `12` as a
          wider one — every section's chip a different shape, and none of them the round-ish
          counter a count wants to be. The floor is the badge's own height, written as the
          same expression `SIZE_DEFAULTS` gives it so a theme's `control-height-offset` moves
          both together and it cannot go oblong the moment a theme changes density.

          Only a floor: two digits are wider than 24px with the padding an `xs` badge carries,
          so they grow, which is the half a fixed width would have lost.
        */
        minWidth: 'calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px))',
      },
      children: [{ $: opts.count }],
    },
    /*
      A plain icon, not a button: the heading around it is a `<button>`, and a button inside a
      button is invalid markup — it would also take the press on the way past and toggle twice.
    */
    {
      type: 'we-icon',
      props: {
        size: CARET_SIZE,
        color: 'text-faint',
        name: { $: `local.${opts.field} ? 'caret-up' : 'caret-down'` },
      },
    },
  ],
});

/**
 * A list that folds away under its heading.
 *
 * `$if` rather than `$animate`, which would keep the content mounted behind a clipped wrapper. The
 * point of folding a list here is that it has got large, so leaving a screenful of cards rendered
 * would be folding away the only thing it cost. Nothing is lost by unmounting: the suggestions come
 * from a store, the results from a query declared above this, and an open editor's draft lives in
 * the store rather than in the card.
 */
const collapsible = (field: string, body: SchemaNode): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: `local.${field}` },
    enterTransition: { type: 'reveal', duration: 200 },
    exitTransition: { type: 'reveal', duration: 160 },
    then: body,
  },
});

/** A round yes-or-no button in the success or danger role — the pair every suggestion here is answered with. */
const answerButton = (tone: 'success' | 'danger', label: string, onClick: SchemaProp): SchemaNode => ({
  type: 'we-tooltip',
  props: { content: label },
  children: [
    {
      type: 'we-button',
      props: {
        variant: 'outline',
        size: 'xs',
        square: true,
        r: 'full',
        label,
        color: `${tone}-text`,
        hoverProps: { bg: tone, color: `on-${tone}`, borderColor: tone },
        onClick,
      },
      children: [{ type: 'we-icon', props: { name: tone === 'success' ? 'check' : 'x', weight: 'bold' } }],
    },
  ],
});

/** The record a suggested change is to, as it is stored now — the card's own `current` query. */
const CURRENT = 'first(local.current)';

/**
 * The changes that would change something. A staged update carries every value the pass proposed,
 * including ones equal to what the record holds, so they are compared once the record has answered;
 * until then every proposed value is listed, which is at worst one frame of "Fri → Fri".
 */
const CHANGES = `(local.currentLoaded ? proposal.fields.filter(f, ('' + ${CURRENT}[f.name]) != f.value) : proposal.fields)`;

/** A value as a reader knows it: a state by its community's name rather than its slug. */
const readableValue = (field: string, value: string) =>
  `(${field} == 'status' ? (find(spaceStore.taskStates, { slug: ${value} }).name ?? ${value}) : ${value})`;

/**
 * Pending changes to agreed records, each card the record as it is and the change as old → new.
 *
 * Its own group under its own heading, apart from the records a pass made, because it is a different
 * question with different answers. The record is not in doubt, so the card has no "suggested" edge in
 * warning: it takes the accent, and each line is applied or dismissed on its own — a suggestion is
 * often half right. Accept all and Reject all once there is more than one, which are also what clear
 * a suggestion whose remaining values change nothing.
 */
const suggestedChangesGroup: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: `count(${CHANGE_PROPOSALS})` },
    then: {
      type: 'Column',
      props: { gap: '200', width: '100%' },
      children: [
        foldingSectionLabel({
          label: 'Pending changes',
          count: `count(${CHANGE_PROPOSALS})`,
          tone: 'warning',
          field: 'changesListOpen',
        }),
        collapsible('changesListOpen', {
          type: 'Grid',
          props: { minChildWidth: '240px', gap: '200', width: '100%' },
          children: [
            {
              type: '$each',
              props: { items: { $: CHANGE_PROPOSALS }, as: 'proposal' },
              children: [
                {
                  type: 'Column',
                  /*
                    The record itself, by id, for the "old" half of every line — a proposal carries
                    only what the pass suggested. Not asked until the backend has said which model
                    this is; without one the lines say "—" for what is there now.
                  */
                  $queries: {
                    current: {
                      entity: { $: 'proposal.entity' },
                      where: { id: { $: 'proposal.id' } },
                      limit: 1,
                      when: { $: 'proposal.entity' },
                    },
                  },
                  props: {
                    bg: 'surface',
                    color: 'text',
                    // Amber, as a change is marked everywhere else — the accent is what selected means.
                    borderLeft: '3px solid warning',
                    r: '300',
                    px: '300',
                    py: '300',
                    gap: '200',
                  },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '100', ay: 'center', width: '100%' },
                      children: [cardKind(PROPOSAL_SHAPE)],
                    },
                    {
                      type: 'we-text',
                      props: {
                        fontWeight: 'semibold',
                        text: { $: `${CURRENT}[${DISPLAY}.title] ?? proposal.summary` },
                      },
                    },
                    {
                      type: '$each',
                      props: { items: { $: CHANGES }, as: 'change' },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '200', ay: 'center', width: '100%' },
                          children: [
                            {
                              type: 'we-text',
                              props: {
                                fontSize: '200',
                                flex: '1 1 auto',
                                minWidth: '0',
                                text: {
                                  $:
                                    '`${change.label}: ${' +
                                    readableValue('change.name', `(${CURRENT}[change.name] ?? '—')`) +
                                    '} → ${' +
                                    readableValue('change.name', 'change.value') +
                                    '}`',
                                },
                              },
                            },
                            {
                              /*
                                The pair never gives up room, however long the line beside it runs.

                                Without this the two buttons are ordinary flex items and shrink like
                                anything else, so a long value — a transcribed title, a sentence of
                                description — squeezed them until the glyphs were unreadable. The
                                line is what should absorb the pressure, and it already says so:
                                `flex: '1 1 auto'` with `minWidth: '0'` on the text is the half that
                                gives, and this is the half that does not.

                                The card above does exactly this around the same pair, in a `Row`
                                with the same `flexShrink`. That it was done there and not here is
                                the whole bug: one answer surface held its shape and the other did
                                not, for no reason anybody chose.
                              */
                              type: 'Row',
                              props: { gap: '100', ay: 'center', flexShrink: '0' },
                              children: [
                                answerButton('success', 'Accept this change', {
                                  $action: 'modules.transcribe.applyChange',
                                  args: [{ $: 'proposal.id' }, { $: 'change.name' }],
                                }),
                                answerButton('danger', 'Reject this change — keeps the current value', {
                                  $action: 'modules.transcribe.dismissChange',
                                  args: [{ $: 'proposal.id' }, { $: 'change.name' }],
                                }),
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: { $: `count(${CHANGES}) > 1` },
                        then: {
                          type: 'Row',
                          props: { gap: '100', ay: 'center', ax: 'end', width: '100%' },
                          children: [
                            {
                              type: 'we-button',
                              props: {
                                variant: 'ghost',
                                size: 'xs',
                                onClick: { $action: 'modules.transcribe.acceptProposal', args: [{ $: 'proposal.id' }] },
                              },
                              children: ['Accept all'],
                            },
                            {
                              type: 'we-button',
                              props: {
                                variant: 'ghost',
                                size: 'xs',
                                onClick: { $action: 'modules.transcribe.rejectProposal', args: [{ $: 'proposal.id' }] },
                              },
                              children: ['Reject all'],
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ],
    },
  },
};

const proposals: SchemaNode = {
  /*
    Nothing at all outside a call, and the gate is a node rather than a clause.

    Unscoped, this listed everything staged anywhere in the space — every conversation the community
    has ever had, in one undifferentiated list, with no way to tell which suggestion came from where
    and no way to act on one from a panel that is about no call in particular. Reviewing across calls
    may be worth building one day; it is a surface of its own, with its own grouping and its own
    sense of where a decision lands, and it is not this one wearing no scope.

    Nested rather than `EXTRACTION_SUBJECT && count(…)`, because the inner condition *reads* the
    list, and a read is what fetches it. One expression would have asked the backend the very
    question this gate exists to stop being asked.
  */
  type: '$if',
  props: {
    condition: EXTRACTION_SUBJECT,
    then: {
      type: '$if',
      props: {
        condition: { $: `count(${PROPOSALS})` },
        then: {
          type: 'Column',
          props: { gap: '400', width: '100%' },
          children: [
            {
              type: '$if',
              props: {
                condition: { $: `count(${NEW_PROPOSALS})` },
                then: {
                  type: 'Column',
                  // Its natural height. It used to fight the results list for the panel's fixed height, each
                  // with its own scroller; the panel scrolls as one thing now, so a section is as tall as
                  // what it holds and folds away when that is too much.
                  props: { gap: '200', width: '100%' },
                  children: [
                    /*
              The count, and nothing beside it.

              A warning glyph sat here for a commit, moved up from the cards where there had been one
              apiece. One was better than eight, and none is better still: the heading already says
              "Pending acceptance", which is the whole meaning, and a triangle beside those words
              puts an alarm on a queue that is an ordinary part of using the panel.

              `solid` rather than the default `soft`. A soft badge is a tint, and a tint of the
              warning hue against a panel is dark enough that the number inside it stopped being the
              thing you noticed. It is also now the only thing carrying the tone, which is the other
              reason it has to be the strong version.
            */
                    foldingSectionLabel({
                      label: 'Pending acceptance',
                      count: `count(${NEW_PROPOSALS})`,
                      tone: 'warning',
                      field: 'proposalsOpen',
                    }),
                    collapsible('proposalsOpen', {
                      type: 'Grid',
                      props: { minChildWidth: '240px', gap: '200', width: '100%' },
                      children: [
                        {
                          type: '$each',
                          props: { items: { $: NEW_PROPOSALS }, as: 'proposal' },
                          children: [
                            {
                              /*
                            The alert's edge, without the alert's icon.

                            `we-alert` always draws one — it has no way to be told not to, and that
                            is deliberate: its own note points at WCAG 1.4.1, which asks that colour
                            never be the only thing carrying a status. A glyph per card is how a
                            single alert earns that.

                            A *grid* of them is the case the rule was not written for. Eight cards
                            with eight identical warning triangles says one thing eight times, and
                            the triangles crowd the title they sit beside. Nothing is left relying on
                            colour alone either way: the heading above says "Pending acceptance" in
                            words, which is the whole meaning of the edge, and every card on screen
                            sits under it.

                            The edge itself is `we-alert`'s `accent` appearance written out: a
                            surface, ordinary text, and a three-pixel rule in the status at full
                            strength rather than in its tint. Same figures, so a card here and an
                            alert elsewhere still look like the same family.
                          */
                              type: 'Column',
                              props: {
                                bg: 'surface',
                                color: 'text',
                                borderLeft: '3px solid warning',
                                r: '300',
                                px: '300',
                                py: '300',
                              },
                              children: [
                                {
                                  type: 'Column',
                                  // `flex` so it fills the card: a grid row is as tall as its tallest card, and
                                  // the others are stretched to match — see the answer row's `mt`.
                                  props: { gap: '200', width: '100%', flex: '1' },
                                  children: [
                                    /*
                              What kind of thing is being offered, in the model's own words and icon.

                              Absent where the backend could not classify the base — an executor
                              predating `subjectClassesOf` answers that way for everything — and the
                              card falls back to the flat summary below rather than to a blank box.
                            */
                                    {
                                      /*
                                    What kind of thing this is, and the way into changing it.

                                    Edit used to be a third button in the row of answers at the
                                    bottom, which made a binary question look like a three-way
                                    choice however neutrally it was painted. It is not an answer —
                                    it is what you do *before* answering — so it sits apart from the
                                    pair, in the corner, as a mark rather than a word.

                                    The label keeps the space either way, so the control stays in the
                                    corner on a card whose entity the backend could not name.
                                  */
                                      type: 'Row',
                                      props: { ax: 'between', ay: 'center', gap: '200', width: '100%' },
                                      children: [
                                        {
                                          type: 'Row',
                                          props: { flex: '1', minWidth: '0', ay: 'center', gap: '100' },
                                          children: [cardKind(PROPOSAL_SHAPE)],
                                        },
                                        /*
                                      Offered only where an edit could actually be written back: the
                                      host has to lend a record-update surface and the backend has to
                                      have said which model this is. Without either, Keep would take
                                      the typing and silently drop it.

                                      A pencil going into it and a cross coming back out, each with
                                      the words behind a tooltip — a glyph alone in a corner is only
                                      obvious to somebody who already knows what it does.
                                    */
                                        {
                                          type: '$if',
                                          props: {
                                            condition: {
                                              $: 'modules.transcribe.canEditProposals && proposal.entity',
                                            },
                                            then: {
                                              type: '$if',
                                              props: {
                                                condition: { $: 'modules.transcribe.editingProposal == proposal.id' },
                                                then: {
                                                  type: 'we-tooltip',
                                                  props: { content: 'Stop editing' },
                                                  children: [
                                                    {
                                                      type: 'we-button',
                                                      props: {
                                                        variant: 'ghost',
                                                        size: 'xs',
                                                        square: true,
                                                        label: 'Stop editing',
                                                        onClick: { $action: 'modules.transcribe.cancelProposalEdit' },
                                                      },
                                                      children: [{ type: 'we-icon', props: { name: 'x' } }],
                                                    },
                                                  ],
                                                },
                                                else: {
                                                  type: 'we-tooltip',
                                                  props: { content: 'Edit before accepting' },
                                                  children: [
                                                    {
                                                      type: 'we-button',
                                                      props: {
                                                        variant: 'ghost',
                                                        size: 'xs',
                                                        square: true,
                                                        label: 'Edit before accepting',
                                                        onClick: {
                                                          $action: 'modules.transcribe.editProposal',
                                                          args: [{ $: 'proposal.id' }],
                                                        },
                                                      },
                                                      children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
                                                    },
                                                  ],
                                                },
                                              },
                                            },
                                          },
                                        },
                                      ],
                                    },
                                    {
                                      // Editing, or reading. The controls replace the card's body rather than
                                      // sitting under it, so the thing being changed is the thing on screen.
                                      type: '$if',
                                      props: {
                                        condition: { $: 'modules.transcribe.editingProposal == proposal.id' },
                                        then: { type: 'Column', props: { gap: '200' }, children: [proposalEditor] },
                                        /*
                                      The model's title property, drawn as one — the whole reason this
                                      stopped being a run-on line of `field: value` pairs.

                                      Falls back to the flat summary where there is no model to ask,
                                      which is the one case a card cannot do better than the old one,
                                      and the one case only a suggestion can be in.
                                    */
                                        else: cardTitle(PROPOSAL_SHAPE, { $: 'proposal.summary' }),
                                      },
                                    },
                                    {
                                      /*
                                    The card's last line: what it says about itself, and the answer.

                                    The detail rows used to sit above a full-width row of buttons, so
                                    every card spent a line on controls that fit beside what was
                                    already there — in a docked panel showing several at once, that
                                    is the difference between reading three and reading five.

                                    `ay: 'end'` rather than centre: the details wrap to as many lines
                                    as they need, and the answer belongs at the foot of the card
                                    however tall the left-hand side turns out to be.

                                    And `flex: '1'` for the same promise across cards. Full screen
                                    lays them out as a grid, whose rows stretch every card to the
                                    tallest one's height; without it a short card's answer sat
                                    wherever its content ended, partway up the card. The row takes the
                                    spare height so the answer can reach the corner — and only the
                                    answer: the details keep to the top (`alignSelf`), under the title
                                    they describe, rather than dropping to the foot with it.
                                  */
                                      type: 'Row',
                                      props: { gap: '200', ax: 'between', ay: 'end', width: '100%', flex: '1' },
                                      children: [
                                        {
                                          type: 'Column',
                                          props: { flex: '1', minWidth: '0', gap: '100', alignSelf: 'start' },
                                          children: [
                                            {
                                              // Not while the editor is open: those fields are the same
                                              // values, and showing both would be the card arguing with
                                              // itself about what the suggestion says.
                                              type: '$if',
                                              props: {
                                                condition: {
                                                  $: `${DISPLAY}.label && modules.transcribe.editingProposal != proposal.id`,
                                                },
                                                then: detailRows(PROPOSAL_SHAPE),
                                              },
                                            },
                                          ],
                                        },
                                        {
                                          /*
                                        A yes and a no, drawn the way the board draws the same pair on
                                        the card itself — a raised circle, the glyph in the success or
                                        danger role, filling with that role's surface under the
                                        pointer. Two surfaces answering one decision should not look
                                        like two decisions.

                                        Glyphs without words, which they can be here because they are
                                        the board's glyphs and the tooltips carry the words. A
                                        green/red pair is the classic thing to fail on, so the mark is
                                        what carries the meaning for anyone who cannot separate them.
                                      */
                                          type: 'Row',
                                          props: { gap: '100', ay: 'center', flexShrink: '0' },
                                          children: [
                                            {
                                              type: 'we-tooltip',
                                              props: { content: 'Accept' },
                                              children: [
                                                {
                                                  type: 'we-button',
                                                  props: {
                                                    variant: 'outline',
                                                    size: 'xs',
                                                    square: true,
                                                    r: 'full',
                                                    label: 'Accept',
                                                    /*
                                                  The status *foreground* at rest, the fill on hover
                                                  — the canvas's own rule for this pair, and the
                                                  reason is in its stylesheet: at this size the icon
                                                  *is* the button, so it has to stay legible against
                                                  the surface behind it, and `success-text` is the
                                                  role corrected for exactly that. The fill takes
                                                  over on hover, where `on-success` answers for the
                                                  contrast instead.

                                                  A tint was tried here first, which reads as the
                                                  button acknowledging the pointer rather than as the
                                                  answer it is about to give.
                                                */
                                                    color: 'success-text',
                                                    hoverProps: {
                                                      bg: 'success',
                                                      color: 'on-success',
                                                      borderColor: 'success',
                                                    },
                                                    onClick: {
                                                      $action: 'modules.transcribe.acceptProposal',
                                                      args: [{ $: 'proposal.id' }],
                                                    },
                                                  },
                                                  children: [
                                                    { type: 'we-icon', props: { name: 'check', weight: 'bold' } },
                                                  ],
                                                },
                                              ],
                                            },
                                            {
                                              type: 'we-tooltip',
                                              props: { content: 'Reject — removes it' },
                                              children: [
                                                {
                                                  type: 'we-button',
                                                  props: {
                                                    variant: 'outline',
                                                    size: 'xs',
                                                    square: true,
                                                    r: 'full',
                                                    label: 'Reject',
                                                    // The other half of the pair — see above.
                                                    color: 'danger-text',
                                                    hoverProps: {
                                                      bg: 'danger',
                                                      color: 'on-danger',
                                                      borderColor: 'danger',
                                                    },
                                                    onClick: {
                                                      $action: 'modules.transcribe.rejectProposal',
                                                      args: [{ $: 'proposal.id' }],
                                                    },
                                                  },
                                                  children: [{ type: 'we-icon', props: { name: 'x', weight: 'bold' } }],
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
                          ],
                        },
                      ],
                    }),
                  ],
                },
              },
            },
            suggestedChangesGroup,
          ],
        },
      },
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
 * processed-turn cursor — which is why the panel's help says pressing Extract is how the rest of
 * the conversation gets swept, and the button's own tooltip says it reads the whole thing.
 *
 * ## No lead-in
 *
 * This opened with a sentence — "Look through what was said for:" in a call, "This space's calls
 * look for:" outside one — telling apart two lists that look identical. It was the third line of
 * prose in a box whose job is two controls, and the distinction it drew is already drawn: outside a
 * call the chips are disabled and a link to the space's default appears under them. What a chip
 * *is* went into the panel's help, which is read once and then costs nothing.
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
      Not a failure, and phrased as the one thing a person can act on.

      Every other reason extraction is unavailable is about this node — no model
      configured, an executor that cannot interpret — and none of them can be fixed
      from here. This one can: it is a decision the community has not made yet, and
      the place to make it is the space's own models.

      The only sentence left above the chips, and only where there are no chips to show.
    */
    {
      type: '$if',
      props: {
        condition: { $: `!count(${forSubject('targets').$})` },
        then: {
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
        condition: { $: `count(${forSubject('targets').$}) && !${forSubject('canChoose').$}` },
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
      the panel's help says so, since the answer for the rest of the conversation is the
      button itself.
    */
    {
      type: 'Row',
      props: { gap: '100', wrap: true },
      children: [
        {
          type: '$each',
          props: { items: forSubject('targets'), as: 'target' },
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
                disabled: { $: `!${forSubject('canChoose').$}` },
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
                  args: [{ $: 'target.entity' }, EXTRACTION_SUBJECT],
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
        /*
          The way to add a kind of thing, at the end of the row of kinds.

          What a call can extract is whatever this space has models for, and until now the panel
          could only ever say so — the chips were a closed list with no visible route to a longer
          one, and the only mention of where that list comes from was a link that appeared solely
          where the chips could not be pressed. So the answer to "why is the thing I want not here"
          was two screens away and nothing pointed at it.

          Inside the same wrapping row rather than beside it, so it reflows with the chips and sits
          after the last one at any width. Square and outlined: it is one more thing in a row of
          outlined things, and the one that is not a toggle.

          It opens the space's vocabulary rather than doing anything itself. Adding a model is a
          decision about the community, with its own screen and its own wizard, and a panel about
          one call is the wrong place to make it — but exactly the right place to be reminded it can
          be made.
        */
        {
          type: 'we-tooltip',
          props: { content: "Add a kind of thing to extract, in this space's vocabulary" },
          children: [
            {
              type: 'we-button',
              props: {
                size: 'xs',
                variant: 'outline',
                square: true,
                label: "Add a kind of thing to extract, in this space's vocabulary",
                onClick: { $action: 'shellStore.openSpaceSettings', args: ['vocabulary'] },
              },
              children: [{ type: 'we-icon', props: { name: 'plus' } }],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Whether this stored pass has an exchange worth opening.
 *
 * Both halves are written for every pass now, so in practice this is true for anything run since —
 * but a record written before the fields existed carries neither, and an absent property is absent
 * rather than defaulted. So the row asks rather than assuming, and one written last week stays a
 * plain line instead of a disclosure that opens onto nothing.
 */
const HISTORY_OPENABLE = 'pass.prompt || pass.response';

/**
 * Whose finger was on it — the one difference between the two kinds of pass that is worth seeing.
 *
 * A one-shot pass and an automatic one are the same act with the same result, which is why they are
 * now one list rather than a durable log beside an ephemeral bar. What still differs is why it
 * happened: somebody pressed Extract now, or the call was being watched. Reading a log of sixty
 * readings, that is the question — "did I do this, or did it just happen?"
 *
 * A glyph rather than a word, because the row already carries an outcome, a name, a count and a
 * time, and a fifth string would not be read. Nothing at all for a record predating the field: an
 * unmarked row is honestly silent, where guessing a default would put a claim on screen that was
 * never stored.
 */
const passTriggerMark: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'pass.trigger' },
    then: {
      type: 'we-icon',
      props: {
        size: 'xs',
        color: 'text-faint',
        name: { $: "pass.trigger == 'auto' ? 'lightning' : 'cursor-click'" },
      },
    },
  },
};

/**
 * One stored pass, as a line.
 *
 * Written once and mounted in two places — inside a disclosure button when there is an exchange
 * under it, bare when there is not. Duplicating it for those two cases is how the two drifted the
 * last time something was added to a row.
 */
const historyRow: SchemaNode = {
  type: 'Row',
  props: { gap: '200', ay: 'center', width: '100%' },
  children: [
    /*
      The outcome as a mark, not as a tick on everything.

      The template's own version of this list drew a green check on every settled row because it
      never read the outcome — so a pass that failed and one that wrote nine records looked
      identical, which is the whole reason a failure is worth storing.
    */
    {
      type: 'we-icon',
      props: {
        size: 'sm',
        name: {
          $: "pass.outcome == 'failed' ? 'warning' : pass.outcome == 'skipped' ? 'minus-circle' : 'check-circle'",
        },
        color: {
          $: "pass.outcome == 'failed' ? 'danger-text' : pass.outcome == 'done' ? 'success-text' : 'text-muted'",
        },
      },
    },
    {
      type: '$agent',
      props: { did: { $: 'pass.author' }, as: 'runner' },
      children: [
        {
          type: 'we-avatar',
          props: { size: 'xs', image: { $: 'runner.avatar' }, hash: { $: 'runner.did' } },
        },
      ],
    },
    passTriggerMark,
    {
      type: 'we-text',
      props: { variant: 'footnote', flex: '1', minWidth: '0', truncate: true, textAlign: 'left' },
      children: [
        {
          /*
            "Things", not "records".

            A record is what the graph stores; a thing is what the reader asked to be found, and the
            chips above are already labelled "Things to extract". "No records" also read as a
            failure to write rather than as a pass that looked and found nothing — which is an
            ordinary outcome and the one this line is most often reporting.
          */
          $:
            "pass.outcome == 'failed' ? pass.error : " +
            "pass.outcome == 'skipped' ? 'Nothing was being looked for' : " +
            "pass.recordCount ? `${pass.recordCount} ${plural(pass.recordCount, 'thing', 'things')} found` : " +
            "'Nothing found'",
        },
      ],
    },
    {
      type: 'we-timestamp',
      props: {
        value: { $: 'pass.createdAt' },
        relative: true,
        /*
          Relative here and not on a transcript row, because these *are* the feed of unrelated items
          relative time is for: passes run minutes or days apart and "how recent is this one" is the
          whole question.

          Abbreviated for the transcript row's reason — it sits at the end of a line already holding
          an outcome that can be a whole error message.
        */
        relativeStyle: 'narrow',
        fontSize: '200',
        color: 'text-faint',
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: HISTORY_OPENABLE },
        then: {
          type: 'we-icon',
          props: {
            size: CARET_SIZE,
            color: 'text-muted',
            name: { $: "pass.id in local.openHistoryPasses ? 'caret-up' : 'caret-down'" },
          },
        },
      },
    },
  ],
};

/**
 * What a stored pass shows when opened — the same two panes the live bar shows.
 *
 * Deliberately the same component and the same defaults: prompt closed, response open. A pass read
 * while it ran and the same pass read a week later are the same thing, and the reason this exists
 * at all is that they used to be told apart by which surface happened to be on screen.
 *
 * `$if` rather than `$animate`, for the live bar's reason — each pane is a CodeMirror instance, and
 * keeping fifty alive for a log nobody has opened costs far more than a scroll position is worth.
 */
const historyPassDetail: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'pass.id in local.openHistoryPasses' },
    enterTransition: { type: 'reveal', duration: 200 },
    exitTransition: { type: 'reveal', duration: 160 },
    then: {
      type: 'Column',
      props: { gap: '300', width: '100%', pt: '200', pl: '400' },
      /*
        Indented here, where the live feed indents in its store.

        The record holds what the model was asked and answered verbatim, which is right for a record
        and unreadable as a pane: both arrive as one unbroken line, so the editor came out a
        one-line trough with a horizontal scrollbar rather than a document. `codePane`'s own option
        says "the already-indented text, from the store" — and a query has no store in the way, so
        the host lends the function a schema cannot have. See `formatJson` in app-shell's sources.
      */
      children: [
        codePane({
          label: 'Prompt',
          value: { $: 'formatJson({ text: pass.prompt })' },
          field: 'openHistoryPrompts',
          isOpen: { $: 'pass.id in local.openHistoryPrompts' },
          key: { $: 'pass.id' },
        }),
        codePane({
          label: 'Response',
          value: { $: 'formatJson({ text: pass.response })' },
          field: 'closedHistoryResponses',
          isOpen: { $: '!(pass.id in local.closedHistoryResponses)' },
          key: { $: 'pass.id' },
        }),
      ],
    },
  },
};

/**
 * What has been read on this call, written down rather than remembered.
 *
 * The counterpart of `extractionActivity`, which is a live subscription: it starts empty, fills from
 * the backend as passes run, and is thrown away on every space change. Excellent for watching
 * something happen and useless the moment you reload — a call read an hour ago looked exactly like
 * one never read at all, and a pass that *failed* looked exactly like one that found nothing.
 *
 * So the durable half is a query, over the `ExtractionPass` records the host writes beside every
 * pass, scoped to the call on screen like everything else in this panel. Which also settles the
 * question the live feed could not answer: these rows belong to *this* call, because containment is
 * what they hang off.
 *
 * Collapsed behind a count, the way the live readout collapses its settled passes — a call read
 * every few minutes for an hour is sixty rows nobody wants open.
 */
const extractionHistory: SchemaNode = {
  type: '$if',
  props: {
    /*
      No readings, no section — not a heading over a sentence saying so.

      It had a placeholder ("No extraction runs yet on this call.") for one commit, which is the
      honest thing to show for a list that is *usually* full and happens to be empty. This one is
      the opposite: every call starts with no readings, so the common state was a heading and an
      apology, twice over with the results below doing the same.

      `local.passes` comes from the panel body, not from here — a section that unmounts itself
      cannot own the query that decides whether it should. See the `$queries` there.
    */
    condition: { $: 'count(local.passes)' },
    then: {
      type: 'Column',
      props: { gap: '200', width: '100%' },
      $localState: {
        /*
      Which stored passes are open, and which halves of each.

      Sets of ids rather than a boolean apiece, for the reason any per-row state coming from data
      needs them: the rows are a query, so there is no name a `$localState` field could take. The
      responses are tracked as the *closed* ones so a row opens showing the answer, which mirrors the
      live bar exactly — the two lists are the same log and should not disagree about defaults.
    */
        openHistoryPasses: { type: 'array', initial: [] },
        openHistoryPrompts: { type: 'array', initial: [] },
        closedHistoryResponses: { type: 'array', initial: [] },
      },
      children: [
        /*
          A name over the readings, folding them away, in the treatment every other region here
          wears.

          Inside the gate above rather than over it, so a call nobody has read shows no heading
          rather than a heading with nothing under it.

          The fold used to be one level lower, on a row reading "4 readings of this call" that sat
          under this heading and carried its own caret. Two rows of chrome over one list, and the
          count said twice what the badge now says once — while this section was the only one of the
          three whose heading did nothing, so the panel had two ways of folding a list depending on
          which list it was. The row is gone with the caret it existed for: what it said that the
          heading does not is "of this call", which is true of every word in this panel.
        */
        foldingSectionLabel({
          label: 'Logs',
          count: 'count(local.passes)',
          tone: 'neutral',
          field: 'logsOpen',
          /*
            Every pass on this call, as one file — the prompts and responses in full, the transcript
            they read, what they wrote and what is still waiting — for handing to somebody, or a
            model, working out why a call extracted what it did. Every member's passes, as this list
            shows them, and all of them rather than the fifty drawn here.
          */
          action: {
            type: 'we-tooltip',
            props: { content: 'Export the extraction log' },
            children: [
              {
                type: 'we-button',
                props: {
                  // The transcript panel's export, the same size: one act, two panels.
                  variant: 'ghost',
                  size: 'sm',
                  square: true,
                  label: 'Export the extraction log',
                  onClick: { $action: 'spaceStore.exportExtractionLog', args: [EXTRACTION_SUBJECT] },
                },
                children: [{ type: 'we-icon', props: { name: 'download' } }],
              },
            ],
          },
        }),
        collapsible('logsOpen', {
          type: 'Column',
          props: { gap: '200', width: '100%' },
          children: [
            {
              type: '$each',
              props: { items: { $: 'local.passes' }, as: 'pass' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '100', width: '100%' },
                  children: [
                    /*
                              Clickable only where there is something under it.

                              A bare button is the appearance-free clickable, so an openable row and
                              a plain one look identical and differ only in the caret — which is the
                              affordance. Wrapping every row in a button regardless would offer a
                              press to a record written before the exchange was stored, and answer it
                              with an empty box.
                            */
                    {
                      type: '$if',
                      props: {
                        condition: { $: HISTORY_OPENABLE },
                        then: {
                          type: 'we-button',
                          props: {
                            variant: 'bare',
                            width: '100%',
                            onClick: { $toggleLocalIn: 'openHistoryPasses', value: { $: 'pass.id' } },
                          },
                          children: [historyRow],
                        },
                        else: historyRow,
                      },
                    },
                    historyPassDetail,
                  ],
                },
              ],
            },
          ],
        }),
      ],
    },
  },
};

/**
 * What the passes wrote, for the call on screen — one list, drawn as the suggestions above are.
 *
 * ## One list, not one per kind
 *
 * It grouped by model, with a heading per kind. That came from the shape of the data rather than
 * from anything a reader wanted: a record has a type and `$query` takes one entity name, so a list
 * of mixed kinds is a list of queries, and the groups were those queries showing through. What
 * somebody reviewing a call wants is what the call produced, and each card already says what kind
 * it is.
 *
 * The `$each` over targets stays, because it has to — it is still one subscription per kind. What
 * went is the per-group heading and the space between groups, so the cards run together into a
 * single grid. The one thing this cannot do is interleave: cards come out grouped by kind in the
 * order the targets are listed, because a schema cannot merge a list of queries whose length it
 * does not know, let alone sort across them. Nothing on screen claims otherwise.
 *
 * ## The same card as a suggestion
 *
 * Same kind row, same headline, same detail fields, from the same builders — see `CardShape` for
 * how one definition draws two different shapes of row. What differs is the edge, which is
 * `success` here against the suggestions' `warning`, and the absence of an answer: these are
 * already agreed to, so there is nothing to keep or discard.
 *
 * No pencil either. Editing a suggestion is part of answering it — the store holds a draft that
 * Keep commits — and a record on this list has already been written, so changing one is an ordinary
 * record edit that belongs where records are edited rather than in a read-back of a call.
 */
const extractedCard: SchemaNode = {
  type: 'Column',
  props: {
    bg: 'surface',
    color: 'text',
    // `we-alert`'s `accent` edge, in the role that says this one is settled.
    borderLeft: '3px solid success',
    r: '300',
    px: '300',
    py: '300',
    gap: '200',
    width: '100%',
  },
  children: [
    cardKind(RECORD_SHAPE),
    cardTitle(RECORD_SHAPE),
    {
      type: '$if',
      props: { condition: { $: `${RECORD_SHAPE.display}.label` }, then: detailRows(RECORD_SHAPE) },
    },
  ],
};

const extractedRows: SchemaNode = {
  type: '$each',
  props: {
    /*
      One list, from one subscription, because the link says which records these are.

      This was an `$each` over the call's target models with a query apiece, and the grouping that
      produced was the queries showing through rather than anything a reader wanted. It could not be
      otherwise: a query names one entity, an untyped `include` carries no class constraint, and the
      call's children are mostly transcript — so "everything this call produced" was unaskable and
      the panel asked "all the tasks, then all the events" instead.

      `CollectionBlock.extracted` makes it askable. A pass writes that link beside the containment
      one, so the relation *is* the answer, and an include over it comes back polymorphically: every
      record the passes wrote, whatever its type, hydrated as the class it actually is. One round
      trip, no utterances in the payload, and a community shape extracted this morning arrives
      without being named anywhere.

      Which also buys the two things the grouped version could not have. The rows sort by when they
      were made rather than by which model they happen to be, and there is a number to put beside
      the heading — see `EXTRACTED_COUNT`.

      Staged suggestions are filtered rather than excluded by the query, for the reason they always
      were: "is this still awaiting a decision" is not a property of the record and there is nothing
      in the graph to ask it about. The list of pending ids is right here, and it is a handful.
    */
    items: { $: EXTRACTED_ROWS },
    as: 'item',
  },
  children: [extractedCard],
};

/**
 * How a card reads an amendment's own record — the shape the settled-change rows are built against.
 *
 * The third `CardShape` in this file, and the one whose two halves come from different places: the
 * *type* is on the amendment (`nodeType`, written when the change was accepted), and everything
 * drawn from the record is on the record, fetched per row. That split is the point — an amendment
 * is a fact about a pair, so neither end alone can draw the card.
 */
const AMENDMENT_SHAPE: CardShape = {
  display: 'recordStore.displays[amendment.nodeType]',
  value: (name) => `first(local.amended)[${name}]`,
  present: (field) => `first(local.amended)[${field}.name]`,
};

/**
 * The property a change was to, in the words the model uses for it.
 *
 * Looked up in the declaration rather than stored beside the amendment: `displays` already carries a
 * label for every declared property, and a copy written at accept time would keep saying "Due date"
 * after the model renamed it. Falls through to the raw property name where the type is unknown,
 * which is how everything else in this panel degrades against an executor that cannot classify.
 */
const AMENDED_LABEL = `(find(${AMENDMENT_SHAPE.display}.fields, { name: amendment.property }).label ?? amendment.property)`;

/**
 * One accepted change: what kind of thing it was to, which thing, and what it did.
 *
 * Deliberately the same card furniture as the two above it — the kind row, then the record's own
 * title — so a reader moving down the panel is looking at one family of things and not three. What
 * differs is the last line, which is the whole content here: the old value and the new one, in the
 * order they happened.
 *
 * The record is fetched per row rather than snapshotted at accept time, so the title is what the
 * thing is called *now*. A log naming what a record used to be called would be a worse answer than
 * naming what it is, and this card claims nothing about the rest of the record standing still: it
 * is about one property, and says so on its own line.
 */
const amendmentCard: SchemaNode = {
  type: 'Column',
  /*
    The amended record, for its title. Not asked until the amendment says what type it is — without
    one there is nothing to query, and the card falls back to naming the property alone.
  */
  $queries: {
    amended: {
      entity: { $: 'amendment.nodeType' },
      where: { id: { $: 'amendment.node' } },
      limit: 1,
      when: { $: 'amendment.nodeType && amendment.node' },
    },
  },
  props: {
    bg: 'surface',
    color: 'text',
    // Green, as everything settled in this panel is — the same edge the accepted records wear.
    borderLeft: '3px solid success',
    r: '300',
    px: '300',
    py: '300',
    gap: '200',
    width: '100%',
  },
  children: [
    cardKind(AMENDMENT_SHAPE),
    {
      /*
        The record's title, or the property's name where the record could not be read.

        Not `cardTitle`, which also draws a summary line: the interesting second line here is the
        change itself, and a description under the title would push it out of a 240px card.
      */
      type: 'we-text',
      props: {
        fontWeight: 'semibold',
        truncate: true,
        text: { $: `${AMENDMENT_SHAPE.value(`${AMENDMENT_SHAPE.display}.title`)} ?? ${AMENDED_LABEL}` },
      },
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', width: '100%', wrap: true },
      children: [
        {
          type: 'we-text',
          props: {
            fontSize: '200',
            flex: '1 1 auto',
            minWidth: '0',
            // The same readable-value rule the pending card uses, so a status reads as the word the
            // community gave it on both sides of the decision rather than as a slug on one of them.
            text: {
              $:
                '`${' +
                AMENDED_LABEL +
                '}: ${' +
                readableValue('amendment.property', "(amendment.previousValue ? amendment.previousValue : '—')") +
                '} → ${' +
                readableValue('amendment.property', 'amendment.newValue') +
                '}`',
            },
          },
        },
      ],
    },
    {
      /*
        Who decided, and when. Absent from the cards above because a record carries its author on its
        own face; here the author is the *reviewer* rather than whoever wrote the record, and which
        of the two it is is exactly what somebody reading a change log wants to know.
      */
      type: 'Row',
      props: { gap: '100', ay: 'center', width: '100%' },
      children: [
        {
          type: '$agent',
          props: { did: { $: 'amendment.author' }, as: 'decider' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted', truncate: true },
              children: [{ $: "`kept by ${decider.did == me.did ? 'you' : decider.name}`" }],
            },
          ],
        },
        {
          type: 'we-timestamp',
          props: { value: { $: 'amendment.createdAt' }, relative: true, fontSize: '100', color: 'text-muted' },
        },
      ],
    },
  ],
};

const amendmentRows: SchemaNode = {
  type: '$each',
  props: { items: { $: AMENDMENT_ROWS }, as: 'amendment' },
  children: [amendmentCard],
};

/*
  What starts a pass automatically, and it is a *call's* decision.

  The space has a standing answer and an administrator sets it; this is the people in the room
  deciding about the room. On the live call only: a meeting somebody opened from a link is not
  happening, so "as it happens" has nothing to be about, and the switch would be asking about a
  conversation that finished. Everything else here follows the call on screen; this one thing
  cannot.

  ## A button that says its state, not a switch

  It was a `we-switch` whose `label` is an aria-label, so on screen it was an unlabelled toggle
  beside an "Extract" button, and nobody could say which of the two did what. A button carries
  its own words. `primary` when on rather than `danger`: red is this interface's word for "your
  microphone is live", a personal state that is its own off switch, and auto extraction is a
  standing decision the whole call shares. Two red buttons in one panel would say one thing about
  two different things.

  ## Under the chips, which is what it is about

  It has been three places. Beside the title, where two labelled buttons plus a glyph is more than
  a `sm` dock is wide and the title gave way first. Then inside the sunken box with the chips, where
  a filled button among outlined ones read as one more toggle. Then in a row above that box, paired
  with Extract now.

  That pairing was the thing worth breaking. The two buttons look alike and are not: one runs a pass
  now, the other decides whether passes happen at all — and the second is a fact *about* the chips
  above it, which is where it now sits. Extract now went to the header, where the transcript panel
  keeps its own verb, so the two are no longer read as a matched pair.
*/
const autoExtractControl: SchemaNode = {
  type: '$if',
  props: {
    condition: VIEWING_LIVE,
    then: {
      type: 'we-tooltip',
      props: {
        placement: 'bottom',
        /*
          Whose decision it is, said where the press is — the record button beside the transcript is
          this agent's microphone, and this looks the same and is everybody's. Outside a call there
          is no record to write the decision against, and the button explains that rather than
          greying out in silence, which is what the switch did.
        */
        content: {
          $:
            "!modules.transcribe.extractionFor[modules.transcribe.callId].canChoose ? 'Join a call to decide for it' : " +
            "modules.transcribe.autoExtract ? 'Stop extracting as the call goes, for everyone in it' : " +
            "'Extract as the call goes, for everyone in it'",
        },
      },
      children: [
        {
          type: 'we-button',
          props: {
            size: 'sm',
            gap: '100',
            variant: { $: "modules.transcribe.autoExtract ? 'primary' : 'ghost'" },
            // The live call's answer, and the same record `autoExtract` reads.
            disabled: { $: '!modules.transcribe.extractionFor[modules.transcribe.callId].canChoose' },
            onClick: { $action: 'modules.transcribe.toggleAutoExtract' },
          },
          children: [
            { type: 'we-icon', props: { name: 'lightning' } },
            { $: "modules.transcribe.autoExtract ? 'Auto extract: on' : 'Auto extract: off'" },
          ],
        },
      ],
    },
  },
};

/*
  The one-shot pass, in the header where the panel's verb belongs.

  It has been a chip at the end of the chip row, a button inside the sunken box, and a button in a
  row above it paired with the auto-extract toggle. The header is where it settles, and the reason
  is the panel one over: the transcript's header carries Transcribe and Continue, which are the two
  things that panel *does*. This is the thing this panel does, so it goes in the same corner — a
  reader moving between the two docked panels finds the verb in one place rather than two.

  Which also unpairs it from the auto-extract button, and that pairing was misleading. They look
  alike and mean different kinds of thing: one runs a pass now, the other decides whether passes
  happen at all. The second is a fact about the chips and now sits under them.

  `secondary` in every state. It dropped to `ghost` while the automatic pass was on, on the
  reasoning that a press is then the backfill rather than the usual way a pass starts — but this is
  the only control in the panel that *does* anything on a press, and a button that fades because a
  setting elsewhere is on reads as unavailable rather than as unnecessary.
*/
const extractNowControl: SchemaNode = {
  type: 'we-tooltip',
  /*
    The one thing about mid-call changes that is not guessable, in the place it is asked.

    A standing watch keeps a processed-turn cursor, so a model switched on part-way through is
    applied to what is said next and not to what was said before it. The one-shot pass carries no
    cursor — it hands the executor the whole transcript — so pressing Extract is the backfill, and
    the executor's dedup means what was already found returns as updates rather than as second
    copies. A phrase here, and the longer form in the panel's help.
  */
  props: {
    placement: 'bottom',
    /*
      Why it cannot be pressed, and it has to be the *actual* reason.

      `canExtract` folds three of them into one boolean — a space with no models, a call with
      nothing ticked, and a conversation nobody has spoken in — so a tooltip reading it alone can
      only guess, and it guessed "Nothing has been said yet". Somebody who had just unticked the
      last chip was told the call was silent, which is both wrong and unfixable by anything they
      would then try.

      Asked apart, in the order they rule each other out. The fourth reason `canExtract` carries, a
      node with no model at all, cannot reach here: the panel's own `$if` has already replaced
      everything with a sentence about it.
    */
    content: {
      $:
        `!count(${forSubject('targets').$}) ? 'No models are set up here' : ` +
        `!${forSubject('targets').$}.exists(t, t.selected) ? 'Nothing is selected to extract' : ` +
        "!count(local.spoken) ? 'Nothing has been said yet' : " +
        "'Reads the whole conversation so far'",
    },
  },
  children: [
    {
      type: 'we-button',
      props: {
        size: 'sm',
        variant: 'secondary',
        gap: '100',
        // Its own alignment, so it needs no wrapper row to stop it stretching across the well —
        // and a wrapper that stayed behind when the button did not would cost a gap for nothing.
        alignSelf: 'start',
        // Disabled rather than hidden once the panel is showing the section: the reason is
        // "nothing has been said yet", which resolves on its own and is worth waiting for.
        // `count(local.spoken)` is the honest half — see the query on the panel root. `canExtract`
        // stays for what it still answers alone: a model on this node, and something ticked.
        disabled: {
          $:
            `!count(local.spoken) || !${forSubject('canExtract').$} || ` +
            "modules.transcribe.extractStatus == 'running'",
        },
        /*
          The call on screen, not "the call I am in".

          `extractCollection` takes the record, which is what makes this work on one somebody opened
          from a link; `extract` can only ever mean the live one. The guard above asks about the
          same record, which it did not when a template owned this — the button was hidden by a
          `canExtract` about the live call while the action behind it would have worked on the one
          being shown.
        */
        onClick: { $action: 'modules.transcribe.extractCollection', args: [EXTRACTION_SUBJECT] },
      },
      children: [
        { type: 'we-icon', props: { name: 'sparkle' } },
        { $: "modules.transcribe.extractStatus == 'running' ? 'Reading…' : 'Extract now'" },
      ],
    },
  ],
};

/**
 * Turning what was heard into tasks and events.
 *
 * One press, one pass, and a count afterwards. An LLM call takes seconds, and the gap between press
 * and result is exactly where a feature stops looking like it is working — so `running` says so, and
 * `done` keeps its number until the next press rather than reverting to a blank button. The count
 * used to end with "Open the graph to see them", which was an errand rather than an answer; the
 * records are listed under this now.
 *
 * Carries no `extractable` gate of its own. It had one — a fact about the *node*, not about any
 * call — and the panel above now branches on the same value, so the inner copy only ever asked the
 * question twice. That nesting is also what used to hide a running pass and a decision waiting on
 * somebody from a node that could not start one, which is precisely the node whose passes came from
 * a peer.
 *
 * ## The chips, and what the last press did
 *
 * The box opened with "Extract" in bold, in a panel titled "Extraction"; a lead-in above the chips;
 * a footnote under the button about what a mid-call change does and does not cover; and the button
 * itself, at the end of the chip row, where an outlined button beside outlined chips read as one
 * more chip. The prose went two places — the panel's help glyph, read on demand, and the button's
 * own tooltip — and the button went beside the switch that decides the automatic pass, so the two
 * ways of starting one sit together.
 *
 * What is left is three bands in the order somebody uses them: the controls, then what the last
 * press did, then what a press looks for — three words and a row of chips on a ground of their own.
 */
/**
 * Has anybody actually said anything into this record.
 *
 * The store cannot answer it. `canExtract` asks `hasTranscript`, which infers words from *adoption*
 * — the live call's record counts as empty until this agent's transcriber takes it up — and that
 * inference stopped being true the moment continuing a call adopted its record straight away.
 * Continue a conversation nobody spoke in and Extract went live over nothing. The store cannot do
 * better alone either: peers write into the shared record without telling it, so "is there anything
 * in here" is a question for the graph rather than for this session.
 *
 * One row is the whole answer, so `limit: 1` — this is a count against zero and never a list. Named
 * `spoken` rather than `utterances` because the transcript's own part already has a query by that
 * name; they never share a scope, and two `local.utterances` in one module is a trap for whoever
 * moves one of them.
 *
 * `when` for the reason every scoped query here carries it: an unresolved anchor is *pruned* rather
 * than sent, and pruning widens, so without it a subject that has not arrived asks for every
 * TextBlock in the space.
 *
 * On the well rather than on the panel root, because its one reader is the Extract now button under
 * the chips. It spent a commit at the root, when that button was in the header and a `$queries`
 * entry is only readable from inside the node declaring it. Back down here it is also skipped on a
 * node with no model at all, which the root could not do — everything in this well is already
 * behind that gate.
 */
const extract: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  $queries: {
    spoken: {
      entity: 'TextBlock',
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: EXTRACTION_SUBJECT },
      limit: 1,
      when: EXTRACTION_SUBJECT,
    },
  },
  children: [
    /*
      What the last press did, then what a pass looks for, then whether passes happen on their own.

      The status lines come first because they report the press, and the press is now made in the
      header — so they sit directly under the button that caused them rather than under a copy of it
      that used to be here. A spinner while it runs, the reason a standing pass is not running, and
      the alert when one failed.
    */
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
    /*
      What the last pass produced is no longer said here.

      It was a tick and "N records written.", which every pass left standing above the chips until
      the next one — and the two readouts below say it with more: the results themselves appear under
      "Accepted", and `ExtractionPass` records the outcome and the count of every pass, one-shot and
      standing alike, so the history holds what this held and keeps holding it after the next press.

      Worth knowing what went with it: a pass that finds *nothing* now changes nothing on screen
      except the count in the collapsed history. The line's own note called that the difference
      between "it worked, there was nothing" and "it silently failed", and that reading was fair.
      What made it worth removing anyway is that it paid for the common case with permanent chrome.
    */
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
    {
      type: 'Column',
      props: { gap: '200' },
      children: [
        /*
          Naming the row under it, in the treatment this panel gives every region.

          A lead-in lived here once and was removed: a whole sentence with two forms, one for a call
          and one for the space's default, reading as prose in a box whose job is two controls. What
          was wrong with it was the length and the branching, not the idea — with the controls moved
          out, the chips are a row of unexplained words under a heading that only says "Extraction".

          It came back as a sentence-case footnote first, on the reasoning that a control row is not
          a section the way a scroll area of proposals is. That drew the line in the wrong place:
          what `sectionLabel` marks is a *region with a name*, and having two labelled regions in one
          panel wearing two treatments is exactly the drift the fragment exists to stop. No colon —
          the caps and the tracking already say this is a name rather than a lead-in.
        */
        sectionLabel({ label: 'Things to extract' }),
        {
          type: 'Column',
          props: { bg: 'surface-sunken', r: '300', p: '200' },
          children: [{ type: '$part', props: { id: 'transcribe.extractionTargets' } }],
        },
        /*
          Under the chips, because it acts on them.

          "Extract now" reads the whole conversation so far looking for exactly the things listed
          above it, so the button sits at the end of the list it is about — press the list. Above
          the box it was one of two buttons in a row beside the auto-extract toggle, and the two
          look alike while answering different questions: one runs a pass this instant, the other
          decides whether passes happen at all. Splitting them is what stops them reading as a
          matched pair, and the standing decision is the one that belongs in the header.

          No wrapper row around it, which is not tidiness. `extractNowControl` renders nothing
          outside a live call, and an empty `Row` is still a flex item — so the well went on paying a
          whole gap for a control that was not there. The button aligns itself instead.
        */
        extractNowControl,
      ],
    },
  ],
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
/**
 * What the feed shows when it holds nothing — one placeholder, six situations.
 *
 * There were two of these and they did not look alike. A call with no words in it got this
 * treatment: an icon and a centred line. No call at all got an italic sentence in `captureStatus`,
 * which renders *above* the feed rather than in it — so the same emptiness was a tidy placeholder
 * or a stray caption under the meter depending on whether an address happened to name a call. One
 * shape now, in the one place the reader is looking.
 *
 * ## Split on the same line the rest of the panel is split on
 *
 * "Nothing has been said here yet" is true in five of the six and useless on its own: what a person
 * does next is different in each, and the panel is the only thing that knows which. The six sort
 * cleanly into the two the whole panel already sorts by — a call being read back, and the live one —
 * so they are two branches of three rather than one chain of six.
 *
 * That split is structural rather than tidiness. A `$if` **remounts** when its condition flips, so
 * continuing a call fades the old sentence out and the new one in, the way switching between calls
 * already does. Kept as one node the text swapped in place, mid-sentence, with no transition — the
 * one moment in this panel that still read as a jump. Nothing about the branches themselves changed.
 *
 * Reading a call back:
 *
 * - **Nothing can pick it up.** Another call is already running, or there is no call module. Say
 *   only what is true: a clause telling somebody to continue a meeting, with nothing on screen or in
 *   the rail willing to do it, is worse than no clause.
 * - **Somebody is in it.** Then the act is joining them, not restarting it, and the button beside
 *   this says the same word.
 * - **Nobody is in it.** The offer is to pick it up.
 *
 * The live view:
 *
 * - **No call at all.** Nothing to record and nothing to read: the whole sentence is the way in.
 *   Joining is the only step it names, because it is usually the only one — `recordCalls` defaults
 *   on, so transcription starts with the call and nobody presses anything.
 * - **In a call, with a microphone, not recording.** The one state where a button on this panel
 *   changes the answer. `available` is what keeps it out of the second between joining a call and
 *   the microphone coming up: recording is about to start on its own there, so telling somebody to
 *   press Transcribe is both wrong and unreadable — it was on screen just long enough to change the
 *   sentence twice. The same test coverage uses, for the same reason.
 * - **In a call, recording.** Nothing to add — the panel is waiting for somebody to speak, and
 *   saying so twice would be furniture.
 *
 * ## Neither sentence mentions the subject
 *
 * Whole-token substitution rewrites `{ $: 'modules.transcribe.collectionId' }` where a `$part`
 * points this at another call, and leaves an expression that merely *mentions* it alone — so a
 * sentence built around the subject would go on describing the live call inside a panel about a past
 * one. `VIEWING_LIVE_EXPR` reads the address for that reason, and `callId` is a fact about this
 * agent's own session either way.
 */
const noUtterances: SchemaNode = {
  type: '$if',
  props: {
    condition: VIEWING_LIVE,
    /*
      Fades out in place, then fades back in.

      `emptyState` holds its own placeholder back for a moment before fading it in, which is what
      makes switching calls read as a settle rather than a flicker. Mounting through this gets the
      same treatment on the transitions that had none.

      **In place** is the load-bearing half, and it is not this node's doing. The renderer keeps an
      outgoing branch mounted for the length of its exit, so a sentence fading here is on screen
      while the microphone section above it is going — and that section vanishing pulled it up the
      panel mid-fade. Making the exit instant did not fix it either: the opacity change lands a frame
      or two after the condition, so the sentence was still painted for the collapse.

      What fixes it is above: the section fades and keeps its box for longer than this takes. So the
      order is the sentence finishing, then the height going, then the new sentence arriving where it
      will stay — and this exit is deliberately the **shorter** of the two.
    */
    enterTransition: { type: 'fade', duration: 200 },
    exitTransition: { type: 'fade', duration: 150 },
    then: emptyState({
      icon: 'chat-dots',
      label: 'transcript',
      /*
        "No call at all" is both halves, not just the one this branch could take for granted.

        Inside the live view an address naming a call means it is the call being recorded, so
        `!callId` alone reads as "no call" and is right — until the moment somebody leaves. A branch
        being faded out is still live: `callId` empties, this re-renders, and the panel offered to
        join a call for the length of the exit before the past-call branch took over saying the
        opposite. Naming both halves makes the sentence true on its own terms rather than on its
        neighbour's, which is what a node that outlives its own condition needs.
      */
      message: {
        $:
          `!routeStore.params.call && !modules.transcribe.callId ? 'Join a call to transcribe what is said.' : ` +
          `!modules.transcribe.enabled && modules.transcribe.available ? 'Nothing has been said here yet. Press Transcribe to write down what is said.' : ` +
          `'Nothing has been said here yet.'`,
      },
    }),
    else: emptyState({
      icon: 'chat-dots',
      label: 'transcript',
      message: {
        $:
          `(!modules.call || ${IN_A_CALL}) ? 'Nothing has been said here yet.' : ` +
          `${CALL_ON_SCREEN_LIVE} ? 'Nothing has been said here yet. Join the call to begin transcribing.' : ` +
          `'Nothing has been said here yet. Continue the call to begin transcribing.'`,
      },
    }),
  },
};

export const transcriptLines: SchemaNode = {
  type: 'Column',
  // The gap is the only thing separating one utterance from the next now that a row carries no
  // fill or padding of its own, so it does that job alone and is a step wider than it was.
  props: { gap: '400' },
  /*
    Hoisted so the count is readable from outside the loop — a `$query` on the `$each` answers only
    the `$each`, and "are there none" is a question about the list rather than about a row.

    `when` is not optional here, and its absence is the hazard rather than an omission: an operand
    that has not resolved is *pruned* rather than sent, and pruning **widens**. Without it, a subject
    that has not arrived would drop the scope and ask for every TextBlock in the space — a
    transcript of the whole community, shown with confidence, for a frame or forever. The `$if` on
    the same expression used to stand in for this by never rendering the query at all.
  */
  $queries: {
    utterances: {
      entity: 'TextBlock',
      scope: {
        anchor: 'CollectionBlock',
        via: 'children',
        anchorId: { $: 'modules.transcribe.collectionId' },
      },
      // Oldest first, because a transcript read backwards is not a transcript.
      order: { createdAt: 'asc' },
      when: { $: 'modules.transcribe.collectionId' },
    },
  },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'count(local.utterances)' },
        then: {
          type: '$each',
          props: {
            items: { $: 'local.utterances' },
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
                  props: {
                    /*
                      No fill, no padding — the gap between rows is what separates them.

                      A card each gave every utterance a box, and a transcript is a hundred of them:
                      the padding pushed the words apart far more than telling one line from the
                      next needs, and the whole feed read as a stack of tiles rather than as a
                      conversation. The gap does that job on its own.

                      It also stops the panel fighting whatever is behind it. A docked panel can be
                      floating over the content on a translucent ground, and a column of opaque
                      sunken rectangles cancels that out — the glass shows through the gaps and
                      nowhere else.
                    */
                    gap: '100',
                    /*
                      The row knows whether the pointer is on it, so its pencil can keep out of the
                      way until it is wanted.

                      Held here rather than by the button, which is the whole point: an affordance
                      that only appears once you are already on it cannot be found. `hoverProps` on
                      the button answers for the button, and there is no way to say "when my parent
                      is hovered" in props, so the parent says it instead — the same shape the
                      break-out grip uses in `PanelLane`, written with a local rather than a signal.
                    */
                    onMouseEnter: { $setLocal: 'pointerOnRow', value: true },
                    onMouseLeave: { $setLocal: 'pointerOnRow', value: false },
                  },
                  /*
                    Per row, which is what makes this a local rather than store state.

                    `$localState` on a node inside `$each` is created per row, so each line owns
                    whether it is being mended and the words being typed into it — no id to compare
                    against, and no way for two rows to disagree. The proposal editor needed a store
                    draft because *which fields exist* comes from the model; here the field is
                    `text` and nothing else, which is exactly the case locals are for.
                  */
                  $localState: {
                    mending: { type: 'boolean', initial: false },
                    draft: { type: 'string', initial: '' },
                    pointerOnRow: { type: 'boolean', initial: false },
                  },
                  children: [
                    {
                      /*
                        Somebody has to give up the space, and it is the name.

                        A row that overflows is a row where nobody said who yields: a flex item's
                        automatic minimum size is its content, so the deficit comes out of whichever
                        sibling *can* shrink. Here that was the marks — and worse than usual,
                        because the design system defaults typography to `overflow-wrap: anywhere`,
                        which reduces a word's min-content width to a single glyph. "(edited)" could
                        therefore shrink to nearly nothing and broke mid-word onto two lines.

                        The name is the one thing on the row with a sensible narrower form, and it
                        already asks to be truncated — which needs `minWidth: 0` to happen at all,
                        since without it the item is never asked to be narrower than its text.
                      */
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        {
                          type: 'we-avatar',
                          props: {
                            // `xs`, not `xxs`. A transcript is a list of people talking, so who is
                            // speaking is the second thing on the row after the words — at the
                            // smallest size on the scale a face is a coloured dot and the run of
                            // them stops being scannable.
                            size: 'xs',
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
                          // `label` rather than `footnote` — one step up the scale, and the weight
                          // that comes with it is wanted here: a name is what the eye lands on when
                          // skimming a transcript for who said something.
                          props: {
                            variant: 'label',
                            color: 'text-muted',
                            truncate: true,
                            /*
                              Shrink, but never grow — `0 1 auto`, not `1 1 auto`.

                              A grow factor made the name take every spare pixel on the row, which
                              pushed the clock, the marks and the pencil to the far edge. Nothing
                              here wants to be right-aligned; the name only ever needed permission
                              to *give up* space, which is the shrink half. `minWidth: 0` is what
                              lets it, since a flex item is otherwise never asked to be narrower
                              than its own text.
                            */
                            flex: '0 1 auto',
                            minWidth: '0',
                          },
                          children: [{ $: 'speaker.name' }],
                        },
                        {
                          /*
                            How long ago while it is still happening; what time it was once it is not.

                            Relative time answers "how fresh is this?", which is a question about a
                            feed of unrelated items. A transcript is not one: every row came out of
                            the same conversation, so on a call recorded last Tuesday all two hundred
                            of them read "6 days ago" — the same string on every line, carrying no
                            information and taking the width that made the row wrap. What a reader
                            wants from a line of a finished meeting is where in it the line was, and
                            that is the clock.

                            On the live call relative earns its place: the tail is minutes old, the
                            numbers differ row to row, and they move on their own.

                            `narrow` for the live side because a transcript stamp is a *coordinate* —
                            something skimmed past to find a moment, not read — and a coordinate wants
                            to be terse at any width. That is a fact about the row rather than about
                            the panel, so it is not conditional on how much room there is.

                            One node rather than an `$if` on the two: `relative` short-circuits inside
                            the primitive, so `timeStyle` simply goes unread while it is true. A
                            branch here would unmount and rebuild the row every time a call ended.

                            ## Last on the row, after the marks

                            It used to sit before them, and in `en-US` that put "Aa" hard against
                            "PM" — two letterforms beside two letterforms in the same faint grey,
                            reading as one word. Moving the marks up to the name fixes it by
                            separation rather than by decoration, which is what makes it hold: an
                            `en-GB` reader sees "14:32" and never had the collision, so an
                            icon-level or colour-level fix would have been treating one locale's
                            symptom. The mark is about the line and the time is about the moment;
                            they were only ever neighbours by accident.
                          */
                          type: 'we-timestamp',
                          props: {
                            value: { $: 'utterance.createdAt' },
                            relative: VIEWING_LIVE,
                            relativeStyle: 'narrow',
                            timeStyle: 'short',
                            fontSize: '100',
                            color: 'text-faint',
                          },
                        },
                        /*
                          What this line is, where it is not simply what somebody said.

                          Only ever shown for the two that are not plain speech, and `spoken` stays
                          silent. That is the whole economy of the thing: a transcript is speech
                          almost all the way down, so marking it would put furniture on every row to
                          restate the panel's own title, and a mark that appears everywhere is one
                          people stop reading. The reader's default assumption is already right; the
                          mark exists for where it would not be.

                          Which is also why neither of these is a sparkle. Machine-heard is the
                          assumption here, so "this came from a model" is not news — that icon earns
                          its place on an extraction card, where a record stands for something
                          inferred and the reader would otherwise have no way to tell.
                        */
                        {
                          /*
                            Typed: an icon, because it is a provenance nicety rather than a warning.

                            `text-aa` rather than `keyboard`, which was the first guess and the
                            wrong one: a keyboard is a grid of small keys, and at 12px they merge
                            into a grey smudge that reads as "some icon". Two letterforms survive
                            the size and say "text" on sight.

                            And not a pencil, which is the edit button two elements along this same
                            row — one glyph cannot mean both "written rather than spoken" and
                            "change these words". `translate` means language and `key-return` means
                            submit; both are the wrong claim rather than an unclear one.
                          */
                          type: '$if',
                          props: {
                            condition: { $: "utterance.source == 'typed'" },
                            then: {
                              type: 'we-tooltip',
                              // No `flexShrink` here: the tooltip generates no box, so the badge
                              // inside it is the flex item and its own refusal to shrink is what
                              // counts. That is the whole point of the wrapper being boxless.
                              props: { content: 'Typed, not spoken', placement: 'top' },
                              children: [
                                {
                                  /*
                                    A chip, not a bare icon — because bare it read as part of the
                                    clock beside it.

                                    In `en-US` the time ends "AM" or "PM", and two letterforms in
                                    the same faint grey immediately after two more letterforms are
                                    one word to the eye. Moving the mark to the other side of the row
                                    was tried first and did not help: what separates them is a
                                    *ground*, not a gap, so the mark stops being loose text on the
                                    row and becomes a thing sitting on it.

                                    `control-surface` is a step away from both `surface` and
                                    `surface-sunken` in either polarity, which is the whole reason
                                    the neutral badge is painted with it — see
                                    BADGE_APPEARANCE_DEFAULTS, where this same transcript row is the
                                    case that argued it. The row carried a sunken fill when that was
                                    written and carries none now, and the choice survives the change
                                    precisely because it was made against both grounds.
                                  */
                                  type: 'we-badge',
                                  props: { size: 'xs', variant: 'neutral' },
                                  /*
                                    A keyboard, because this marks *how the line arrived* rather than
                                    that it is text — everything on this row is text.

                                    It was `text-aa`, which is the glyph the record button in this
                                    panel's own header now uses for transcription, as the call bar
                                    always did. One surface cannot spend the same letterform on "this
                                    module makes text" at the top and "somebody typed this" a few
                                    rows down, so the more literal mark takes this one. It also stays
                                    clear of "(edited)", which is the other provenance signal on
                                    these rows.

                                    Sized between the badge's own xxs (12px) and xs (16px). The
                                    badge's height is fixed per size, so a larger glyph fills it
                                    rather than stretching it.
                                  */
                                  children: [{ type: 'we-icon', props: { name: 'keyboard', size: '14px' } }],
                                },
                              ],
                            },
                          },
                        },
                        {
                          /*
                            Corrected: words, not an icon behind a hover.

                            This one is a claim about whether the line is still a verbatim quote, and
                            `editUtterance`'s own note is the reason it cannot be hover-only — a
                            mended line reading as something somebody said is a claim nobody checked.
                            A tooltip is invisible on a touchscreen and to anyone not poking at rows,
                            which is exactly the wrong property for a trust signal.

                            "(edited)" rather than a badge or an asterisk: it is lighter than the
                            badge it replaces, needs no legend, and is the convention every reader
                            already holds from chat. An asterisk needs learning, and a star reads as
                            a rating.

                            The tooltip is then the upgrade rather than the message — it says *when*,
                            which is worth having and worth nothing if it is the only channel.
                          */
                          type: '$if',
                          props: {
                            condition: { $: "utterance.source == 'corrected'" },
                            then: {
                              type: 'we-tooltip',
                              props: { placement: 'top' },
                              children: [
                                {
                                  type: 'we-text',
                                  // `nowrap` because this is one atomic phrase with no narrower
                                  // form, and the `anywhere` default would otherwise let it break
                                  // between any two letters rather than not at all.
                                  props: { variant: 'footnote', color: 'text-faint', whiteSpace: 'nowrap' },
                                  children: ['(edited)'],
                                },
                                {
                                  /*
                                    A formatted time, which is why this is slotted content rather
                                    than the `title` string: a schema has no way to format a date,
                                    and `updatedAt` arrives as epoch milliseconds. `we-timestamp`
                                    already knows how, so the tooltip holds one.

                                    `updatedAt` comes back on every fetch beside `author` and
                                    `createdAt` — no field to declare. What it cannot say is *who*:
                                    `author` stays the original speaker, and anybody may mend a line.
                                  */
                                  type: 'Row',
                                  props: { gap: '100', ay: 'center' },
                                  slot: 'content',
                                  children: [
                                    { type: 'we-text', props: { variant: 'footnote' }, children: ['Edited'] },
                                    {
                                      type: 'we-timestamp',
                                      props: {
                                        value: { $: 'utterance.updatedAt' },
                                        relative: VIEWING_LIVE,
                                        relativeStyle: 'narrow',
                                        timeStyle: 'short',
                                        fontSize: '100',
                                      },
                                    },
                                  ],
                                },
                              ],
                            },
                          },
                        },
                        /*
                          The correction affordance, on the row it corrects.

                          Offered on every line rather than only your own: a recogniser mishears
                          names and jargon, and whoever notices is usually not the speaker. See
                          `editUtterance` for what that costs and what is recorded about it.
                        */
                        {
                          type: '$if',
                          props: {
                            condition: { $: '!local.mending' },
                            then: {
                              type: 'we-tooltip',
                              props: { content: 'Edit text' },
                              children: [
                                {
                                  type: 'we-button',
                                  props: {
                                    label: 'Edit text',
                                    size: 'xs',
                                    variant: 'bare',
                                    color: 'text-faint',
                                    /*
                                      Out of the way until the row is pointed at — and back the
                                      moment it is focused.

                                      A pencil on all two hundred rows is furniture on the ordinary
                                      case, which is reading. Faded rather than unmounted, so the
                                      row does not change width as the pointer crosses it, and so
                                      the button keeps its place in the tab order.

                                      `focusProps` is the half that stops this being a mouse-only
                                      affordance: it fires on `:focus-visible`, so tabbing to the
                                      pencil brings it back into view even though nothing is
                                      hovering it. Without that pair, a keyboard user would be
                                      moving focus onto something invisible.
                                    */
                                    opacity: { $: 'local.pointerOnRow ? 1 : 0' },
                                    focusProps: { opacity: 1 },
                                    transition: 'opacity 200 ease-in-out',
                                    onClick: [
                                      // Seeded on the press rather than at mount, so a row reopened
                                      // after a cancel starts from the words as they now stand.
                                      { $setLocal: 'draft', value: { $: 'utterance.text' } },
                                      { $setLocal: 'mending', value: true },
                                    ],
                                  },
                                  children: [{ type: 'we-icon', props: { size: 'xs', name: 'pencil-simple' } }],
                                },
                              ],
                            },
                          },
                        },
                      ],
                    },
                    {
                      // Reading, or mending. The field replaces the words rather than sitting under
                      // them, so what is being changed is the thing on screen.
                      type: '$if',
                      props: {
                        condition: { $: 'local.mending' },
                        then: {
                          type: 'Column',
                          props: { gap: '200' },
                          children: [
                            {
                              /*
                                One row, growing — and reading at the size of the words it replaces.

                                Two rows was half a box of empty space under a line that is usually
                                one line long. `autoGrow` starts it at the height of the text it is
                                standing in for and takes the room only when there is something to
                                put in it, which is the same behaviour the composer at the foot of
                                the panel has.

                                `fontSize` is pinned because `size: 'sm'` carries one: the size
                                presets set padding *and* type, so a compact control also shrank the
                                words — mending a line made it visibly smaller than the line beside
                                it, and switching to `md` would have fixed the type by making the box
                                bigger. The two are separable, so they are separated here.
                              */
                              type: 'we-textarea',
                              props: {
                                size: 'sm',
                                fontSize: '300',
                                rows: 1,
                                autoGrow: true,
                                maxRows: 6,
                                submitOnEnter: true,
                                value: { $: 'local.draft' },
                                onInput: { $setLocal: 'draft', value: { $: 'event.detail' } },
                                'on:submit': {
                                  $action: 'modules.transcribe.editUtterance',
                                  args: [{ $: 'utterance.id' }, { $: 'local.draft' }, { $: 'utterance.source' }],
                                  onSuccess: [{ $setLocal: 'mending', value: false }],
                                },
                              },
                            },
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                {
                                  type: 'we-button',
                                  props: {
                                    size: 'xs',
                                    /*
                                      Primary, not success. Green is the palette for an *outcome* —
                                      it says something went well — and this button is a plain
                                      submit that has not done anything yet. The Keep/Discard pair on
                                      a proposal card is the case that earns success and danger,
                                      because there the colour IS the decision being offered.
                                    */
                                    variant: 'primary',
                                    disabled: { $: '!trim(local.draft)' },
                                    onClick: {
                                      $action: 'modules.transcribe.editUtterance',
                                      args: [{ $: 'utterance.id' }, { $: 'local.draft' }, { $: 'utterance.source' }],
                                      // Closed on success only: a failed write leaves the words on
                                      // screen to try again with, rather than discarding them and
                                      // showing the line unchanged as though nothing was attempted.
                                      // `pointerOnRow` for the reason Cancel sets it — the row
                                      // reflows out from under the pointer either way out.
                                      onSuccess: [
                                        { $setLocal: 'mending', value: false },
                                        { $setLocal: 'pointerOnRow', value: false },
                                      ],
                                    },
                                  },
                                  children: ['Save'],
                                },
                                {
                                  type: 'we-button',
                                  props: {
                                    size: 'xs',
                                    // Secondary rather than ghost: ghost has no edge until it is
                                    // hovered, so beside a filled Save it read as a word somebody
                                    // had left next to a button rather than the other half of a
                                    // pair.
                                    variant: 'secondary',
                                    /*
                                      Both, and the second is what stops the pencil flashing.

                                      Leaving the editor makes the row shorter — a field and two
                                      buttons become one line of text — so it reflows out from under
                                      a pointer that was on the Cancel button. The read view mounts
                                      with `pointerOnRow` still true, so the pencil fades in, and the
                                      pointer is then outside the shrunken row, so it fades straight
                                      back out. Two hundred milliseconds each way, which is exactly
                                      long enough to read as a glitch.

                                      Saying the pointer has left is a small lie when it has not,
                                      and it corrects itself on the next mouse move — where the
                                      flash corrects itself by being wrong twice.
                                    */
                                    onClick: [
                                      { $setLocal: 'mending', value: false },
                                      { $setLocal: 'pointerOnRow', value: false },
                                    ],
                                  },
                                  children: ['Cancel'],
                                },
                              ],
                            },
                          ],
                        },
                        else: { type: 'we-text', props: { color: 'text' }, children: [{ $: 'utterance.text' }] },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        /*
          Nothing to show, and why — see `noUtterances` for the sentence.

          Two gates rather than one, because "is there a transcript record" and "has it answered"
          become true at different moments and only the second is worth waiting for.

          **A record on screen** is gated on the query having *answered*, not merely on the count: a
          list backed by a query is empty on its first frame, so an unqualified else asserts
          "nothing here" about a transcript that is still arriving — which on a long one is the
          wrong sentence for as long as it takes to fetch.

          **No record** is synchronous and needs no such wait, and this is where the missing state
          was: `when` refuses the query without a subject, and a query never asked never reports
          itself loaded, so gating on `utterancesLoaded` alone left the panel blank in the two
          situations a newcomer is most likely to be in — no call, and a call nobody has spoken in.

          The outer condition is the bare subject token and has to stay bare. Substitution is
          whole-token, so it is rewritten wherever a `$part` points this at another call, where an
          expression merely *mentioning* it would be left alone — which is exactly how the inner
          gate came to read the live collection inside a panel about a past one.

          "yet" is right even on a call that finished. A past transcript is not closed: the composer
          writes into whichever one is on screen, so a meeting nobody spoke in is still somewhere a
          note can be left.
        */
        else: {
          /*
            Not while a preview is on screen, because then something *has* been said.

            The unsaved buffer is the first thing that happens on a new call: somebody speaks, the
            preview appears, and the record still holds nothing — so the placeholder went on saying
            "Nothing has been said here yet." directly above the words being said. Two claims about
            the same moment, one of them plainly false.

            It also cost the handover its footing. The placeholder sits above the preview, so when
            the line saved the placeholder went at the same moment the preview did and the row
            arrived, and the whole column moved twice on the way.

            A wrapper rather than a term on each branch below: there are two of them and one has no
            condition of its own, so a term would have had to become a condition and the pair would
            have drifted. Reversible for free — a preview that never saves takes the placeholder's
            reason with it, and the sentence comes back.
          */
          type: '$if',
          props: {
            condition: { $: `!(modules.transcribe.heard && (${VIEWING_LIVE_EXPR}))` },
            then: {
              type: '$if',
              props: {
                condition: { $: 'modules.transcribe.collectionId' },
                then: {
                  type: '$if',
                  props: { condition: { $: 'local.utterancesLoaded' }, then: noUtterances },
                },
                else: noUtterances,
              },
            },
          },
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
    /*
      Starting up is no longer a row of its own.

      A spinner and the word "Starting…" appeared here for the few hundred milliseconds an audio
      graph takes to open, and then vanished — a whole line arriving and leaving under a meter that
      had just arrived itself, which moved everything below it twice for something nobody had time
      to read. It says the same thing in the meter's own right-hand label now, where it costs no
      layout: the bar is up, and it has nothing to measure yet.
    */
    /*
      "Nothing is wrong, nothing has happened yet" is no longer said here.

      It was an italic line meaning one of two things — press record, or join a call and then press
      record — and it sat above the feed while the feed said nothing at all, so the same emptiness
      was a caption under the meter in one situation and a centred placeholder in another. The feed
      answers both now, in the place the reader is already looking: see `noUtterances`.

      What is left below is this part's actual subject, which is every reason the module *cannot*
      produce text. Those are not states a transcript can report by being empty — a node with no
      speech-to-text looks exactly like a conversation nobody has started.
    */
    note('no-audio', 'microphone-slash', 'Nothing to listen to. Start or join a call and this will follow it.'),
    note('no-backend', 'plugs', 'This backend cannot transcribe — no speech-to-text is reachable from here.'),
    /*
      No model, asked of what the store knows about models rather than of the status.

      The status says `no-model` only after somebody pressed record and found nothing. The two other
      ways to be here say nothing at all: recording that started on its own gives up silently, and a
      panel opened before any call has never tried. Those are exactly the moments somebody would
      want the button, so the note follows the fact rather than the attempt.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'modules.transcribe.modelMissing' },
        then: {
          type: 'Column',
          // `ax`, not `ay`: the axes are screen axes whatever the direction, so on a Column `ax` is
          // the cross axis. Without it the button stretched across the whole panel.
          props: { gap: '200', ax: 'start' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'start' },
              children: [
                { type: 'we-icon', props: { name: 'warning', color: 'text-faint' } },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted' },
                  children: ['No transcription model is installed. Once one is, transcription starts on its own.'],
                },
              ],
            },
            {
              /*
                One click where this connection may install one — the backend picks the model and
                the button names its size, since most of a gigabyte is something to say before the
                press rather than after.

                Otherwise settings where there are settings to open, and a sentence where there are
                not: AI administration is node-scoped, so a guest on somebody else's executor has no
                AI section, and a button that opens Settings to nothing is worse than no button.
              */
              type: '$if',
              props: {
                condition: { $: 'modules.transcribe.canInstallModel' },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'primary',
                    loading: { $: 'modules.transcribe.installingModel' },
                    disabled: { $: 'modules.transcribe.installingModel' },
                    onClick: { $action: 'modules.transcribe.installModel' },
                  },
                  children: [
                    { type: 'we-icon', props: { name: 'download-simple' } },
                    { $: 'modules.transcribe.installModelLabel' },
                  ],
                },
                else: {
                  type: '$if',
                  props: {
                    condition: { $: 'runtimeStore.canManageAi' },
                    then: {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'secondary',
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
              },
            },
          ],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: 'modules.transcribe.modelDownloading' },
        then: {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                // A glyph rather than a spinner: this part keeps a stable height, and the percentage
                // beside it is what says the download is moving.
                { type: 'we-icon', props: { name: 'download-simple', color: 'text-faint' } },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted' },
                  children: [{ $: 'modules.transcribe.modelDownloadText' }],
                },
              ],
            },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: ['Transcription starts on its own once it has arrived.'],
            },
          ],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: 'modules.transcribe.installError' },
        then: {
          type: 'we-alert',
          props: { variant: 'warning' },
          children: [{ $: '`The model could not be installed: ${modules.transcribe.installError}`' }],
        },
      },
    },
    /*
      A dropped stream, while it is being put back.

      Not a `note`, which keys on `status` — the session is still listening here, and that is the
      point: the microphone is open and the meter is moving, so without a line saying otherwise this
      looks exactly like a working panel that has gone quiet. It says where the words went, because
      they are held rather than lost, and it clears itself when the stream comes back.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'modules.transcribe.reconnecting' },
        then: {
          type: 'we-alert',
          props: { variant: 'warning' },
          children: ['Reconnecting to the speech model. What is said now is held, and written once it is back.'],
        },
      },
    },
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
    /*
      Gated on the live call as well as on there being words, and it gates *itself*.

      The buffer is this agent's own microphone, so it has nothing to do with a call somebody opened
      from a link — and a fragment that has to be wrapped in the right condition by whoever places it
      is a fragment that will be placed without one. The workshop wrapped it by hand; nothing made
      that obligatory, and nothing would have said so if it had been forgotten.
    */
    /*
      `heard` rather than `pending`: speech still with the model counts as well as words buffered.

      Between somebody stopping and their words coming back there used to be nothing here at all —
      a second or several on a CPU in which the panel looked exactly as it would had nobody spoken.
    */
    condition: { $: `modules.transcribe.heard && (${VIEWING_LIVE_EXPR})` },
    then: {
      type: 'Column',
      props: { bg: 'accent-muted', r: '300', p: '300', gap: '200' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center', minHeight: '24px' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted', uppercase: true },
                  children: [{ $: "modules.transcribe.pending ? 'Not saved yet' : 'Transcribing…'" }],
                },
                // Beside the label rather than instead of it, so a line waiting to save and the next
                // sentence still with the model can both be said at once.
                {
                  type: '$if',
                  props: {
                    condition: { $: 'modules.transcribe.transcribing' },
                    then: { type: 'we-spinner', props: { size: 'xs', color: 'text-muted' } },
                  },
                },
              ],
            },
            {
              // The buffer flushes on its own; this is for somebody who has stopped talking and
              // wants the line in the record now rather than at the end of the window.
              type: '$if',
              props: {
                condition: { $: 'modules.transcribe.pending' },
                then: {
                  type: 'we-button',
                  props: { variant: 'ghost', size: 'xs', onClick: { $action: 'modules.transcribe.flushNow' } },
                  children: ['Save now'],
                },
              },
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'modules.transcribe.pending' },
            then: { type: 'we-text', children: [{ $: 'modules.transcribe.pending' }] },
          },
        },
      ],
    },
  },
};

/**
 * Typing a message into the transcript.
 *
 * ## Why this belongs in the timeline rather than beside it
 *
 * Somebody typing during a meeting is contributing to the record of it — a name the recogniser will
 * not catch, a decision nobody said aloud, a correction to their own point. Kept in a separate list
 * that would be a second document to read alongside the first; the whole value is that it lands at
 * the moment it was written, among what was being said then. So it is a `TextBlock` in the same
 * collection, and `source` is what stops it passing as speech — see the field's own note.
 *
 * ## Why it is the panel's chrome and not part of the feed
 *
 * It used to sit *inside* the scroll region, after the unsaved line, so that it appeared where the
 * next thing to arrive would and moved down with it. That reads well on a full transcript and badly
 * on every other one: with two lines said, the box sits under the second of them halfway up an
 * otherwise empty panel, and it moves every time anybody speaks. A place to write is a fixture of
 * the surface rather than the last row of the document — so it is pinned below the feed, always at
 * the foot of the panel, and the words scroll behind it.
 *
 * Named as a part, for `captureMeter`'s reason: an interface arranging the module's pieces itself
 * would otherwise have the transcript and no way to write into it.
 */
export const transcriptComposer: SchemaNode = {
  type: '$if',
  /*
    Wherever a transcript is on screen, not only while one is being recorded.

    This was gated on the live call, on the reasoning that adding to a finished meeting's timeline
    would date a remark to a conversation it was not made in. That is exactly the claim `source`
    exists to stop it making: a typed line says it was typed and carries its own `createdAt`, so
    nothing about it pretends to have been said at the time. And the case is a real one — watching a
    call back is when somebody notices what is worth writing down, where during it they are busy
    talking.
  */
  props: {
    condition: EXTRACTION_SUBJECT,
    then: {
      type: 'Row',
      /*
        Further from the transcript than the panel's own gap puts it.

        `panelShell` spaces every child of the panel equally, and these are not equal distances: the
        header names what is below it and wants to sit close to it, while this is a fixture of the
        surface rather than the last row of the document — see above — and at one gap it read as one
        more line of the timeline. Widening the panel's gap would have moved the heading off the
        transcript to fix a boundary three children lower.

        A margin rather than a wrapper, because what is being said is about this element's own
        relationship to what precedes it, and it leaves with the element: the composer is gated on
        there being a transcript at all, and a gap held by the container would have stayed behind on
        a panel with nothing to write into.
      */
      props: { gap: '200', ay: 'end', width: '100%', mt: '100' },
      $localState: { message: { type: 'string', initial: '' } },
      children: [
        {
          type: 'we-textarea',
          props: {
            /*
              No `size`, which is `md` — the height every other field in WE stands at.

              It was `sm`, and 32px is the compact size: right for a control tucked into a dense row
              of something else, wrong for the one thing on the panel a person is meant to type
              into. The `fontSize` that used to be pinned here goes with it, because md's own preset
              already reads at 300 — that override existed only to undo `sm`'s smaller type, which
              is the trap the size presets set by carrying both.
            */
            rows: 1,
            flex: '1',
            minWidth: '0',
            /*
              One line to start, growing as somebody writes, capped before it eats the transcript.

              `autoGrow` is also what makes this line up with the button: at rest it takes the same
              control height `we-input` does, rather than whatever `rows` × line-height happens to
              come to. See the prop's own note.
            */
            autoGrow: true,
            maxRows: 6,
            submitOnEnter: true,
            // Short: a placeholder is read at a glance and the panel it sits in is already headed
            // "Transcript", so naming the destination was the box explaining where it was.
            placeholder: 'Type a message…',
            value: { $: 'local.message' },
            onInput: { $setLocal: 'message', value: { $: 'event.detail' } },
            // Enter commits, and the primitive suppresses the newline that would otherwise follow —
            // a schema can read a key event but has nothing that calls `preventDefault`.
            'on:submit': {
              $action: 'modules.transcribe.addMessage',
              args: [{ $: EXTRACTION_SUBJECT_EXPR }, { $: 'local.message' }],
              onSuccess: [{ $setLocal: 'message', value: '' }],
            },
          },
        },
        {
          type: 'we-tooltip',
          props: { content: 'Add this to the transcript' },
          children: [
            {
              type: 'we-button',
              props: {
                label: 'Add this to the transcript',
                // No `size` either: the pair has to agree, and md is what the field is now.
                // `square` sizes the width from that same height, so an icon-only button is a
                // square rather than a rounded rectangle with an icon adrift in it.
                square: true,
                variant: 'secondary',
                disabled: { $: '!trim(local.message)' },
                onClick: {
                  $action: 'modules.transcribe.addMessage',
                  args: [{ $: EXTRACTION_SUBJECT_EXPR }, { $: 'local.message' }],
                  // Cleared on success only — a failed write keeps what was typed rather than
                  // swallowing it and leaving an empty box as the only report.
                  onSuccess: [{ $setLocal: 'message', value: '' }],
                },
              },
              children: [{ type: 'we-icon', props: { name: 'paper-plane-tilt' } }],
            },
          ],
        },
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
export const transcriptFeed: SchemaNode = panelScroll({
  // Follows the tail while somebody is at the tail, and holds still while they read further
  // up. A live transcript is the case this exists for — and the case that most needs a way back
  // down again, since holding still is otherwise a decision nothing offers to undo.
  pin: 'end',
  jump: 'both',
  children: [
    {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: '$part',
          props: { id: 'transcribe.transcriptLines', subject: SUBJECT },
        },
        pendingUtterance,
      ],
    },
  ],
});

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
  ...panelShell({
    title: 'Extraction',
    /*
    The standing decision, in the corner the transcript panel keeps its own in.

    Transcribe and Continue sit at the top right of the panel one over, and both are *modes* — a
    state this agent or this call is in, which a press changes and which then persists. "Auto
    extract: on" is exactly that shape, so it takes the same corner, and the two docked panels read
    as a pair rather than as two unrelated surfaces.

    Extract now went the other way, under the chips it acts on. That split is the point: a header
    holding both put a mode and an action side by side looking alike, and this is the one of the two
    that is about the call rather than about this moment.

    Gated twice, and both gates already govern everything below. A node with no model replaces the
    whole panel with a sentence about it, so a control here would be the one thing left over a
    screen saying nothing can be extracted. And outside a call there is nothing to decide about —
    the chips, the history and the results are all behind the same subject test, and a live control
    over an empty panel was the "dead furniture" the body was cleared of. The button's own
    `VIEWING_LIVE` test still applies inside these: a meeting being read back has no "as it happens"
    to answer.
  */
    aside: {
      type: '$if',
      props: {
        condition: { $: `modules.transcribe.extractable && (${EXTRACTION_SUBJECT_EXPR})` },
        then: autoExtractControl,
      },
    },
    /*
    How the whole thing works, once, behind a glyph.

    This is where the body's three lines of explanation went — see `extract`. The four facts a
    newcomer cannot guess, in the order they meet them: that a model writes records, that the chips
    choose which and from when, that Extract is the backfill, and that what arrives is a suggestion.
  */
    help:
      'A model reads the transcript and writes what it finds as records. Auto extract reads the call ' +
      'as it goes, for everyone in it; the chips choose what it looks for, from now on. Extract now ' +
      'reads the whole conversation so far, including anything said before a model was switched on. ' +
      'What it finds appears below as suggestions to accept or dismiss.',
    children: [
      {
        type: '$if',
        /*
        Can this node interpret at all — which is a different question from whether there is anything
        to interpret, and the copy here used to answer the wrong one.

        It said "Nothing to read yet. What a call produces appears here as it is found.", which
        describes an absent conversation. `extractable` is `interpretation.available()`: it says
        nothing about whether a call exists, only whether this node has a model. A person reading the
        old sentence waited for a conversation that was never going to help.

        Nothing below it is offered, because nothing below it can be fixed from here.
      */
        props: {
          condition: { $: 'modules.transcribe.extractable' },
          then: panelScroll({
            /*
              The panel scrolls as one thing, rather than two lists scrolling inside a fixed frame.

              It had a scroller on the suggestions and another on the results, each `flex: '1'` inside
              a panel of fixed height — so the two competed for that height, the chips and the log
              between them were pinned in place, and reading a long list meant a small window moving
              inside a small window. Whichever list you were not reading was still taking room.

              One scroller over everything is the shape a docked column wants: the header stays (it is
              `panelShell`'s, outside this), and everything under it moves together. What that costs
              is that a long list pushes the rest below the fold, which is what each heading now
              folds away — see `foldingSectionLabel`.
            */
            children: [
              {
                type: 'Column',
                /*
              A wider gap than the blocks inside each section use.

              At `300` every band sat the same distance from its neighbour as a heading sat from the
              rows under it, so five sections read as one long column of similar things. A gap
              between sections against `200` inside them is what makes a heading look attached to
              what it names rather than floating between two lists.

              `500` rather than the `400` it was: now that a heading is a full-width control with a
              focus ring of its own, 16px between the end of one section's cards and the top of the
              next section's row was not enough to tell which list a heading belonged to at a glance.
              Three times the inner gap reads as a break; twice it read as a slightly bigger row.
            */
                props: { width: '100%', gap: '500' },
                /*
              Which lists are folded, kept on the device.

              A preference rather than view state: it says how somebody likes this panel arranged,
              not what they are looking at, so it must not travel in a shared link — the rule
              `$localState` spells as `persist` against `syncParam`. Namespaced by the module, since
              the key is deployment-global.
            */
                $localState: {
                  proposalsOpen: { type: 'boolean', initial: true, persist: 'transcribe.proposalsOpen' },
                  changesListOpen: { type: 'boolean', initial: true, persist: 'transcribe.changesListOpen' },
                  extractedOpen: { type: 'boolean', initial: true, persist: 'transcribe.extractedOpen' },
                  amendmentsOpen: { type: 'boolean', initial: true, persist: 'transcribe.amendmentsOpen' },
                  /*
                    Closed to start, where the other two open: the readings are a record of how the
                    other sections came to say what they say, wanted when something looks wrong and
                    not otherwise. A call read every few minutes for an hour is sixty rows, and they
                    now sit above the one section with a decision waiting in it.

                    Declared here beside its siblings rather than on the section, which hides itself
                    on a call nobody has read — a field declared there would be created and destroyed
                    with it, and the first reading of a call would open the log somebody had folded.
                  */
                  logsOpen: { type: 'boolean', initial: false, persist: 'transcribe.logsOpen' },
                },
                /*
              The readings, declared here rather than on the section that draws them.

              A `$queries` entry only answers while the node declaring it is mounted, so a section
              that hides itself when it has nothing cannot also own the query that decides whether it
              has anything — it would unmount, stop asking, and never come back. Hoisted one level,
              the query runs whenever the panel is open and the section is a plain `$if` over the
              result, which renders no node at all when there is nothing to show.

              `when` is what the section's own `$if` used to provide: an unresolved anchor is pruned
              rather than sent, and pruning widens, so without it a call-less panel would ask for
              every ExtractionPass in the space.
            */
                $queries: {
                  passes: {
                    entity: 'ExtractionPass',
                    scope: { anchor: 'CollectionBlock', via: 'extractionPasses', anchorId: EXTRACTION_SUBJECT },
                    order: { createdAt: 'desc' },
                    limit: 50,
                    when: EXTRACTION_SUBJECT,
                  },
                },
                children: [
                  /*
              The controls, the chips and whatever the last pass did — only where there is a call.

              Outside one this was a well of dead furniture: an auto switch that could not be
              pressed, an Extract that could not run, and a chip row showing the space's default
              list greyed out. Every one of them was correctly disabled and none of them could be
              acted on, which is a panel explaining what it *would* offer rather than what it does.

              The same gate everything else here already carries — proposals, the history and the
              results below all ask for a call first — so the panel now says one thing outside a
              call and shows its controls the moment there is a conversation to point them at.

              What goes with it is the "Change the default" link, which only ever appeared where the
              chips could not be pressed. The space's own models are two clicks away in settings,
              which is where that link went.
            */
                  { type: '$if', props: { condition: EXTRACTION_SUBJECT, then: extract } },
                  /*
              What the passes did, in full.

              This used to be the whole of the call bar's readout, and it moved the call's furniture
              every time somebody opened a row — see `extractionActivity`. It belongs here: this
              panel is already the surface about extraction, opening something in it costs the call
              nothing, and there is room for a prompt pane without a floating strip growing to 520px
              over the controls somebody is reaching for.

              A one-line signal stays in the call chrome so the four people in five who did not start
              a pass can still see one is running without opening anything.

              A sibling of `extract` rather than a child of it, which is where it and `proposals`
              both were. Nested, they inherited `extractable` — a fact about the *node* — so a
              running pass and a decision waiting on somebody were both invisible on a node that
              could not start one, which is precisely the node whose passes came from a peer.
            */
                  extractionActivity,
                  /*
              Nothing to ask about until there is a call to ask about.

              A drill-down whose `anchorId` is empty is not an empty query, it is a malformed one —
              the backend refused it as invalid SPARQL and the panel opened on a toast. Outside a
              call there is no record to hang passes off, so there is nothing to read.
            */
                  extractionHistory,
                  /*
              The suggestions, under the machinery that produced them rather than over it.

              The panel reads as what it does, in order: here is what I will look for, here is a
              pass running, here is every pass so far — and then the two piles of records, the one
              waiting on you and the one already yours. Read the other way round, a decision sat
              above the controls that caused it and the log that explains it, so the first thing the
              panel said was "answer this" and the reason was underneath.

              It costs the suggestions the top of the panel, which they had. What pays for it is that
              the two sections above are each one line when nothing is happening — a running pass is
              a strip that only exists while one runs, and the readings are folded by default — so
              the queue is a heading further down and not a scroll.
            */
                  proposals,
                  /*
              What the passes actually wrote, for the call on screen.

              The panel used to end at "N records written. Open the graph to see them." — a count
              and an errand. The records are one query per target away and this is the surface somebody
              is already looking at while they arrive, so it shows them. The workshop template built
              this for itself, which is how it came to have the better half of an extraction panel
              and the worse half of everything else.

              Its own scroll region, and the only one: the header, the chips and the activity above
              stay put while this grows, which is what makes a long history readable inside a docked
              panel that clips.
            */
                  {
                    type: '$if',
                    props: {
                      condition: EXTRACTION_SUBJECT,
                      /*
                  One name over the results, and it stays while they scroll.

                  It went briefly, replaced by a heading per kind, because a single "Accepted" here
                  cannot hide itself when there is nothing under it — the rows are one subscription
                  per kind, so nothing above them can ask whether any of them found anything. Per-kind
                  headings could answer that about themselves, and made the results read as several
                  lists when they are one thing: what this call produced.

                  So the name is back, in the treatment every other region in this panel wears, and
                  the residual is a heading over an empty grid on a call that has targets and no
                  results. That is the honest cost of the constraint, and it is the smaller one — a
                  reader who has just pressed Extract wants to see where the answer will appear.

                  Gated on there being anything to look for at all, which is the one part of
                  emptiness a node above the groups *can* see: a call with no models ticked can have
                  extracted nothing, and that is the state every call starts in.
                */
                      then: {
                        type: 'Column',
                        props: { gap: '200', width: '100%' },
                        /*
                      One query for the whole section, and it is what makes the section knowable.

                      The call record, with its `extracted` relation hydrated. Everything the heading
                      and the grid need comes off that one row: the count for the badge, and the
                      records themselves, already ordered by the backend. Before the relation existed
                      this was a query per model, which is why the section could neither be counted
                      nor sorted and why it hid itself behind "are there any targets" instead of "is
                      there anything here".

                      `order` inside the include rather than a sort in the schema, because the
                      expression library has none — and it belongs on the backend anyway, which is
                      the only place the whole set exists at once.

                      No limit. What a pass wrote is small by construction, which is exactly what the
                      relation buys: through `children` an unbounded read would have meant the whole
                      transcript, and the per-model paging that replaced it existed to bound a query
                      that could not say what it wanted.
                    */
                        $queries: {
                          extractedFrom: {
                            entity: 'CollectionBlock',
                            where: { id: EXTRACTION_SUBJECT },
                            limit: 1,
                            /*
                              Both relations in one round trip. `amendments` is typed, so it
                              hydrates into real rows here rather than needing a query of its own —
                              and the section below reads its count off the same answer the
                              accepted-records section does, so the two cannot disagree about
                              whether this call has been asked about yet.
                            */
                            include: {
                              extracted: { order: { createdAt: 'desc' } },
                              amendments: { order: { createdAt: 'desc' } },
                            },
                            when: EXTRACTION_SUBJECT,
                          },
                        },
                        children: [
                          {
                            type: '$if',
                            props: {
                              /*
                            The section hides itself when it holds nothing, which it could not do
                            before: with a query per model, nothing above the groups could ask
                            whether any of them had found anything, so it fell back to gating on
                            whether the call had any models ticked. One list has one count.
                          */
                              condition: { $: EXTRACTED_COUNT },
                              then: {
                                type: 'Column',
                                props: { gap: '200', width: '100%' },
                                children: [
                                  /*
                                  The same count the suggestions above carry, in the role that says
                                  these are settled rather than waiting. `solid` for the reason that
                                  one is: a tint of the hue against a panel leaves the number
                                  competing with its own background.

                                  "Accepted", not "Extracted", though the rows come off the
                                  `extracted` relation — because {@link EXTRACTED_ROWS} takes
                                  `unconfirmedIds` back out of it, so what is drawn here is not what
                                  a pass wrote but what somebody agreed to keep. The old name was a
                                  description of the query rather than of the list, and it named the
                                  one property these rows have in common with the suggestions above
                                  them instead of the one that tells them apart. Every other heading
                                  in this panel is about the decision — "Pending acceptance",
                                  "Pending changes" — and this is the answer to both.
                                */
                                  foldingSectionLabel({
                                    label: 'Accepted',
                                    count: EXTRACTED_COUNT,
                                    tone: 'success',
                                    field: 'extractedOpen',
                                  }),
                                  collapsible('extractedOpen', {
                                    type: 'Grid',
                                    props: { minChildWidth: '240px', gap: '200', width: '100%' },
                                    children: [extractedRows],
                                  }),
                                ],
                              },
                            },
                          },
                          {
                            /*
                              What the call changed about things that already existed.

                              Its own section rather than a mark on the accepted records above,
                              because the two lists are mostly about different records: a change
                              proposal targets an *already-agreed* record by definition, and the
                              usual one is something nobody here extracted — a task somebody wrote
                              down last week that the conversation has now moved on. There is no
                              card in "Accepted" to put a badge on, so a badge would have reported
                              the minority case and silently dropped the rest.

                              It also keeps the content. A mark says a record was changed; these
                              rows say which property and from what, which is the half a reader
                              came for and the half that cannot be recovered afterwards.

                              Green like the section above and separately foldable, so a long call's
                              worth of small edits can be put away without hiding what it produced.
                            */
                            type: '$if',
                            props: {
                              condition: { $: AMENDMENT_COUNT },
                              then: {
                                type: 'Column',
                                props: { gap: '200', width: '100%' },
                                children: [
                                  foldingSectionLabel({
                                    label: 'Accepted changes',
                                    count: AMENDMENT_COUNT,
                                    tone: 'success',
                                    field: 'amendmentsOpen',
                                  }),
                                  collapsible('amendmentsOpen', {
                                    type: 'Grid',
                                    props: { minChildWidth: '240px', gap: '200', width: '100%' },
                                    children: [amendmentRows],
                                  }),
                                ],
                              },
                            },
                          },
                        ],
                      },
                      /*
                      The shared placeholder, so this panel and the transcript's read as one pair.

                      It was a hand-written column with `footnote` text, which is a step smaller
                      than `emptyState` draws — two panels side by side in the same dock, saying
                      the same kind of thing in two sizes. Going through the fragment also brings
                      its delayed fade, which is what stops a placeholder asserting emptiness on
                      the frame before a query answers.

                      "Join a call" rather than "Start a call": joining is the act either way, and
                      it is the word the transcript's own placeholder uses one panel over.
                    */
                      else: emptyState({
                        icon: 'sparkle',
                        label: 'extraction',
                        message: 'Join a call to start extracting things.',
                      }),
                    },
                  },
                ],
              },
            ],
          }),
          // The same fragment, for the same reason — see the placeholder above.
          else: emptyState({
            icon: 'plugs',
            label: 'extraction',
            message: 'This node has no model configured, so nothing can be extracted from a call.',
          }),
        },
      },
    ],
  }),
};

/*
  Fills the box the host gave it, and names itself the way every panel does.

  It used to position itself — `fixed`, `right: 48px`, a hardcoded copy of the module rail's width —
  which meant it overlaid the space rather than making room in it, sat on top of the editor's
  controls, and stayed put when a docked call panel took the edge out from under it. All three are
  the host's job; see `panels` in `index.ts`. The box is `panelShell`'s now, as is the header: this
  drew a `heading-sm` where the panels beside it drew a quiet capitalised label, which is the kind
  of difference nobody chooses and everybody notices.

  No `$if` of its own around it. The extraction panel shed the same wrapper first, and the reason
  carries: the host renders a panel only while its `open` key says so and gates the module's chrome
  on the space, so `datasetStore.currentDataset && modules.transcribe.open` was a second copy of
  both — and one a template supplying this panel's body had to know to repeat.
*/
export const panel: SchemaNode = panelShell({
  // Says which call this is about, because the panel can be about either.
  /*
        One word, whichever call this is about.

        It said "Past call" when the address named one, which was the panel answering a question
        nothing else could: before the pill above it, the only way to know which conversation you
        were reading was the panel's own heading. The pill names the call and says who was in it, so
        the heading went back to describing what the panel *is* — and a title that changes as you
        move between calls is a heading that has to be re-read to learn nothing.
      */
  title: 'Transcript',
  /*
        The same glyph the extraction panel carries, with the three facts about a transcript that
        nothing on screen says: whose machine hears whom, why every line has a name, and that a
        finished call reads back into the same surface. See `docs/architecture/transcripts.md`.
      */
  help:
    "What is said on the call is written down here, by whoever says it: each person's " +
    'microphone is transcribed on their own machine and the lines join into one shared record. ' +
    'Press Transcribe to add your own voice to it. A finished call is read back here, and can ' +
    'be picked up again.',
  /*
        One control, not a control and a badge saying the same thing.

        There was a solid red REC chip beside the button here, and between them they made one point
        twice: the chip appeared while capturing, and the button's icon turned red at the same
        moment. That split happened because this button only ever had two variants, so it had no way
        to look different while actually capturing and the chip was added to cover the third state.

        The call bar's copy of this button already carries all three — off, armed, capturing — in the
        button itself, and its note says why: a state that arrives on its own has to be legible
        without being looked for, and the loudest thing in the row should be the way out of the thing
        nobody switched on. Taking that rule here is what makes the chip redundant rather than
        merely duplicated.

        Nothing loses a signal. The chip showed only while capturing, and capturing means armed, so
        the button is on screen wherever the chip was.
      */
  aside: {
    type: 'Row',
    props: { gap: '200', ay: 'center' },
    children: [
      /*
            Take the transcript with you — the calls list has offered this all along, and the panel
            reading the transcript is where somebody is when they want it.

            Only once there is one: the subject is the transcript's own record, which exists from the
            first thing said, so a call nobody has spoken in offers nothing to download rather than a
            button that answers with a warning. Live or looked back at alike — the file is the shared
            record, not this agent's microphone.
          */
      {
        type: '$if',
        props: {
          condition: SUBJECT,
          then: {
            type: 'we-tooltip',
            props: { content: 'Export the transcript' },
            children: [
              {
                type: 'we-button',
                props: {
                  variant: 'ghost',
                  size: 'sm',
                  square: true,
                  label: 'Export the transcript',
                  onClick: { $action: 'spaceStore.exportCallTranscript', args: [SUBJECT] },
                },
                children: [{ type: 'we-icon', props: { name: 'download' } }],
              },
            ],
          },
        },
      },
      {
        /*
              Recording is about the call you are *in*, so the control is only offered there. A call
              being looked back at gets the way back into it instead — see the `else`.
            */
        type: '$if',
        props: {
          /*
                One question, and the audio one is asked *inside* it rather than beside it.

                These were one condition — live, and there is something to record — which reads
                correctly and is wrong, because the `else` then means two things at once: a call
                being read back, *and* a live view with no microphone. So the panel offered to
                continue a call with no call on screen, and the press did nothing, since the record
                it names is the empty address.

                Nested, each branch keeps one meaning: the live view offers recording or nothing,
                and only a call being looked back at reaches the offer to pick it up.
              */
          condition: VIEWING_LIVE,
          then: {
            /*
                  Absent where it could not work, rather than present and dead.

                  This was a `disabled` on the button, true in exactly one situation: outside a
                  call, where there is no audio to record. So the control sat greyed out in the
                  header of every panel opened outside a call — the state a newcomer opens it in —
                  saying nothing about why, next to a placeholder already explaining that a call is
                  what is missing.

                  ## And it waits for the microphone, having tried not to

                  This asked `callId` for a day, so that it appeared the instant a call was joined
                  rather than a second later with the level meter. The cost was a label that turned
                  over in front of you: recording only starts once there is a stream to record, so
                  the button read "Transcribe" and then became "Transcribing" on its own.

                  There is no third option. The state genuinely changes in that second, so a label
                  that reports the state must change with it, and one that reports it early is
                  guessing — auto-join can still be refused by `recordCalls`, and a device that never
                  opens would leave the word "Transcribing" standing over nothing recorded, with no
                  diagnostic on screen, which is a far worse failure than waiting.

                  So it arrives with the meter and the coverage readout, already saying the settled
                  thing. That is one arrival for the whole panel rather than a control that appears
                  early to change its mind.

                  `enabled ||` stays, so the way *out* of recording never vanishes: a stream that
                  drops mid-call would otherwise take the stop button with it and leave this agent
                  recording with nothing on screen to say so.
                */
            type: '$if',
            props: {
              condition: { $: 'modules.transcribe.enabled || modules.transcribe.available' },
              then: {
                type: 'we-tooltip',
                props: {
                  content: { $: "modules.transcribe.enabled ? 'Stop transcribing' : 'Start transcribing'" },
                },
                children: [
                  {
                    // The panel's own record control. The call bar is the natural place for it
                    // during a call, but the panel has to be self-sufficient: it opens outside a
                    // call too, and a template may place neither the bar nor the rail.
                    type: 'we-button',
                    props: {
                      /*
                            Three states, the call bar's own — and the third is why the REC chip
                            beside this is gone.

                            Off is `ghost`. Armed but not yet producing, the seconds while a model
                            loads, is `secondary`. Actually capturing is `danger`, and that is the
                            change recording-by-default requires: a state somebody chose can afford
                            to be quiet, while one that arrives on its own has to be legible without
                            being looked for. It is also the off switch, so the loudest thing here is
                            the way out of the thing nobody switched on.
                          */
                      variant: {
                        $: "modules.transcribe.listening ? 'danger' : modules.transcribe.enabled ? 'secondary' : 'ghost'",
                      },
                      size: 'sm',
                      gap: '200',
                      onClick: { $action: 'modules.transcribe.toggle' },
                    },
                    /*
                          A glyph and a word, the shape the Continue button beside it already has.

                          Icon-only, this asked a newcomer to know that a mark means transcription,
                          and the panel had answered that once already with a REC chip that has since
                          gone. The header has room — Continue proves it — so the button says what it
                          is instead.

                          The word carries the state and the tooltip carries the act, which is the
                          division a toggle wants: "Transcribing" is what is happening, and hovering
                          or focusing says pressing stops it. No `label` prop with them, so the
                          accessible name is the visible word rather than a second string that has to
                          be kept containing it.
                        */
                    children: [
                      {
                        /*
                              The record dot, and it can be one here because the word beside it says
                              which kind of recording.

                              The call bar spends a letterform on this instead, and its note gives
                              the reason: in a row of icon-only squares next to a microphone mute, a
                              dot reads as a second, redder mute. That is a fact about *that* row.
                              Here the button is labelled, so the universal capturing mark is the
                              clearer of the two and cannot be mistaken for anything.

                              No colour of its own. Red is the button's, so one here would be red on
                              red — the second of the two bugs the bar's note says were fixed there
                              and left standing on this copy.
                            */
                        type: 'we-icon',
                        props: { name: 'record' },
                      },
                      /*
                            A bare string, not a `footnote`.

                            It was wrapped in one, which is `fontSize: '100'` — a step below the
                            `200` a `sm` button sets for its own label. So this word and the one in
                            Continue beside it were smaller than every other button in the module,
                            including Extract now one panel over, which never had the wrapper. The
                            button already knows what size its text is; saying it again is how they
                            drifted apart.
                          */
                      { $: "modules.transcribe.enabled ? 'Transcribing' : 'Transcribe'" },
                    ],
                  },
                ],
              },
            },
          },
          /*
                No `else`, and the way back into a past call is why there used to be one.

                A Continue button lived here — went once because the rail does the same thing, came
                back because the rail is the least discoverable control in the app — and it was in
                the wrong panel the whole time. Two panels sit side by side about one call and only
                this one offered the way into it; a panel's header control is for the thing that
                panel *is*, and picking a call back up is about the call.

                It is `call.continueCallButton` now, published by the module whose action it is and
                placed against the call's own name, where it is on screen whether or not either
                panel is. What is left here is Transcribe, which is what this panel does.
              */
        },
      },
    ],
  },
  children: [
    /*
          Everything about this agent's own microphone, and so only about the live call.

          One `$if` around the three of them rather than three conditions: they answer one question
          between them — is it hearing me, is it hearing everyone else, and why is nothing happening
          — and that question is not asked at all of a meeting somebody is reading back.

          ## And only while one of them has an answer

          A `Column` with nothing in it is still a flex item, so an empty one costs its parent a
          whole `gap` — twelve pixels of nothing between the header and the transcript. All three
          children are dark for the second between joining a call and the microphone coming up, so
          continuing a call pushed everything below this down by a gap, and then down again as the
          meter arrived. The box was invisible and the movement was not.

          The second term is the question the three of them share: is this agent recording, or is
          there a microphone to record. Every note below is reachable under one of those — a backend
          that cannot transcribe and a missing model are both learned by *trying*, which needs audio,
          and "nothing to listen to" is a stream vanishing from under a recording that is still on.

          ## Why it is not `status`

          It was `available || status != 'idle'`, which reads better and leaves the panel jumping
          around after a call ends. `status` is set at the *tail* of `stop`, after a flush that
          writes buffered text to the backend — so it lands a network round trip late, while
          `enabled` and `available` are signals that answer in the same frame the call is torn down
          in.

          That split the teardown across two repaints: the audio went, coverage left, recording
          stopped, the meter left — and this box stayed up holding an empty gap until the flush
          resolved, then collapsed under a placeholder that had already settled. Both terms here are
          synchronous, so the whole section leaves in one frame with everything else.

          Fading it out instead would have hidden the symptom by holding the gap on purpose for the
          length of the fade. Nothing needs to animate once it all leaves together.
        */
    {
      type: '$if',
      props: {
        condition: {
          $: `(${VIEWING_LIVE_EXPR}) && (modules.transcribe.enabled || modules.transcribe.available)`,
        },
        // The section arrives and leaves the way its contents do, and must outlast them on the
        // way out: unmounting on time would cut their fades short and drop the height anyway.
        // See `MIC_FADE`.
        enterTransition: MIC_FADE,
        exitTransition: MIC_FADE,
        then: {
          type: 'Column',
          props: { gap: '300' },
          children: [
            // ── Is it hearing me? ────────────────────────────────────────
            captureMeter,

            // ── Is it hearing everyone else? ─────────────────────────────
            coverage,

            // ── Why nothing is happening, when nothing is ────────────────
            captureStatus,
          ],
        },
      },
    },

    // ── What has been heard, and what is still being said ────────────────
    // One node, not two: the unsaved line lives inside the feed's scroll region, immediately
    // after the last saved row. See `transcriptFeed`.
    transcriptFeed,

    // ── And a place to write into it ─────────────────────────────────────
    // Outside the scroll area, so it holds the foot of the panel instead of following the last
    // thing anybody said. See `transcriptComposer`.
    transcriptComposer,
  ],
});
