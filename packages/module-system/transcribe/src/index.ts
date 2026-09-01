/**
 * The Transcribe feature module — speech to text for whatever the host is capturing.
 *
 * The fourth module, and the first that consumes another module's output. Notes proved a module can
 * own durable entities; the globe proved one can carry a heavyweight framework component; the call
 * module proved one can reach the ephemeral port. This one proves two modules can cooperate **without
 * knowing about each other**.
 *
 * ## How it hears a call
 *
 * It does not import `@we/module-call`, and the call module does not import this. The call declares
 * `audioSource: 'localAudio'`; the host reads that, and lends whatever it finds to every module store
 * as `deps.audioInput`. Neither module has a reference to the other, so either can be uninstalled and
 * the remaining one still works — this module simply reports that there is nothing to listen to.
 *
 * That indirection is also what satisfies the requirement that muting the call stops the transcript.
 * The stream handed over is the call's *own* `MediaStream`, not a copy: mute disables the track, the
 * track produces silence, and the VAD never fires. A module that opened its own `getUserMedia` would
 * have gone on transcribing someone who believed they were muted.
 *
 * ## Fragments-only, again
 *
 * No `frameworks`, no `components`. The one piece of genuinely imperative machinery — an
 * `AudioWorklet` doing voice-activity detection on the audio thread — lives in the store, which is
 * plain TypeScript against `deps.signal`. Browser APIs are not framework coupling.
 *
 * ## Where the transcript goes
 *
 * Into a `CollectionBlock` with `kind: 'call'` — one per call, holding the utterances as children and
 * the roster as `participants`, and attached to whatever node the call was anchored to via
 * `WeNode.calls`. Blocks used to be written loose into the space with `tag: 'transcript'`, which
 * collided with the Lexical tag field and left transcripts showing up in the Cards route's Text list
 * next to authored prose.
 *
 * The record is created on the first thing said, not on the button press, so a call nobody speaks in
 * leaves no trace. See `store.ts` for the convergence rule when several agents record at once, and
 * `docs/architecture/transcripts.md` for the shape as a contract — four things read it now, and
 * nothing enforces it.
 *
 * ## Who decides that it runs
 *
 * Being in a call starts it. Not a press of a button, and not conditional on a peer having pressed
 * one — those were treated as two questions for a while, and the split made the ordinary case the
 * unreliable one: whether a meeting was recorded came down to whether whoever arrived first
 * remembered. A transcript that exists four times out of five is worse than either default, since
 * nothing separates "we chose not to" from "nobody pressed it".
 *
 * Declining is per microphone, which is why it is a button rather than a prompt. An agent who stops
 * recording is not preventing a record of the call, only removing their own words from one being
 * made anyway — which looks like a privacy decision, buys almost none, and used to be taken by
 * accident by everyone who ignored a prompt. What it produced was a five-person meeting recorded
 * from one microphone, which reads exactly like a transcript of the meeting. See the effect in
 * `store.ts` for the guards, and `Panel.schema.ts` for the coverage readout that says how much of
 * the call is actually in the record.
 *
 * A community that does not want its calls recorded says so through `settings`, and so does an agent
 * who does not want their own recorded — see the declaration below. Declared rather than read off
 * the space: nothing in this module can see a space's decisions, and giving it that view to answer
 * one question would put the policy in the module and the space's schema in a module's reach.
 *
 * ## What it is not yet
 *
 * No speaker threading, and no summary generation — deliberately, because the next step is an LLM
 * pass that builds a knowledge map from this text, and it would rather re-segment raw utterances than
 * unpick someone else's structure. It now has somewhere to hang that summary when it arrives.
 */
import { defineModule, type ModuleStoreDeps } from '@we/module-shared';

import { CALL_CONTROLS_ANCHOR, callControl } from './CallControl.schema';
import { CALL_STATUS_ANCHOR, extractionSignal } from './ExtractionStatus.schema';
import {
  captureMeter,
  captureStatus,
  coverage,
  extractionTargets,
  panel,
  pendingUtterance,
  transcriptFeed,
  transcriptLines,
} from './Panel.schema';
import { createTranscribeStore } from './store';

export { CALL_CONTROLS_ANCHOR, callControl } from './CallControl.schema';
export { CALL_STATUS_ANCHOR, extractionActivity, extractionSignal } from './ExtractionStatus.schema';
export {
  captureMeter,
  captureStatus,
  coverage,
  extractionTargets,
  panel,
  pendingUtterance,
  transcriptFeed,
  transcriptLines,
} from './Panel.schema';
export { createTranscribeStore, TRANSCRIBE_ACTIVITY, type TranscribeStatus } from './store';
export { WORKLET_NAME, WORKLET_SOURCE } from './workletSource';

export const transcribeModule = defineModule({
  id: 'transcribe',
  name: 'Transcription',
  description: 'Turns what is said in a call into text blocks in the space.',
  icon: 'waveform',

  // `microphone` even though this module never calls `getUserMedia`: it listens to a live microphone,
  // and the list exists to tell a user what a module can hear, not which API it called to hear it.
  // `storage` because every utterance ends up as a durable record in their space.
  capabilities: ['microphone', 'storage', 'dock'],

  // No `backends`: transcription goes through the port, so this runs on any backend that implements
  // one — and degrades to a stated reason on any that does not. No `frameworks`: fragments only.

  /**
   * Named fragments a template can place itself.
   *
   * `transcriptFeed` is the utterances and nothing else — no capture controls, no status notes. A
   * template that wants a transcript beside a graph, or inside a panel of its own, places this
   * rather than the whole panel, and gets the live record with speaker attribution for free.
   *
   * With its **subject** named, so a placer can point it at a call this module is not recording —
   * an archive, or a board somebody opened from a link. The feed is written against this module's
   * own state and stays valid on its own; the host substitutes the expression when somebody asks
   * for another. Without that a part is welded to the state its module happens to hold, which is
   * what made these uncomposable while the field sat here unread.
   *
   * ## The two that go with it
   *
   * The feed alone was not enough, and the reason is worth stating because it is not obvious from
   * looking at it: a transcript shows what has been *written*, and writing an utterance takes the
   * speaker stopping, the audio reaching the model and the block landing. For those seconds the
   * feed is identical to a feed that has stopped working. The module's own panel never had that
   * problem — the meter and the unsaved line sit above it — but a template placing only the feed
   * inherited a several-second silence after every sentence and no way to tell it from a dead
   * microphone.
   *
   * So `captureMeter` (is it hearing me) and `pendingUtterance` (here is what it heard, not saved
   * yet) are named too. Neither takes a `subject`: both are about the microphone this agent is
   * running right now, which belongs to the session rather than to any call record — a live meter
   * pointed at last month's meeting would be measuring nothing.
   *
   * ## And the two that say why there is nothing
   *
   * `captureStatus` and `coverage` are here for a different reason from the first three, and it is
   * not that an interface ought to show them. Whether to is a design decision, and an interface
   * that judges its readers better served by less is entitled to make it. What it may not be is
   * *unable* to: with these trapped inside the default panel, a template arranging the pieces
   * itself could not have offered "no transcription model is installed" or "2 of 5 transcribing"
   * even having decided it wanted to.
   *
   * That is the line this map draws. A module's presentation is a default rather than a monopoly,
   * so what belongs here is everything an interface could reasonably want to place — and the
   * default panel then becomes one arrangement of these rather than the only one.
   *
   * The capture controls are the exception that proves it: the record button, the close button and
   * the header are the *panel's* chrome rather than pieces of what this module knows, and an
   * interface supplying a body writes its own — the workshop's transcript header is a Record button
   * and a Continue button that exist nowhere in here.
   */
  schemas: {
    transcriptFeed: { node: transcriptFeed, subject: 'modules.transcribe.collectionId' },
    transcriptLines: { node: transcriptLines, subject: 'modules.transcribe.collectionId' },
    // Bare nodes rather than `{ node }`: the wrapper exists to name a subject, and these have none.
    captureMeter,
    captureStatus,
    coverage,
    extractionTargets,
    pendingUtterance,
  },

  slots: [
    // Into the call module's own bar. It declares the anchor; we never name the module.
    { anchor: CALL_CONTROLS_ANCHOR, node: callControl, order: 10 },
    /*
      And under it, where a thing that takes minutes can report on itself.

      A separate anchor rather than a second entry in the bar, because the bar is a row of controls
      and this is a sentence. Contributed by *this* module rather than by the host: extraction from
      a call is what this module is for, and the host has no opinion about where a readout of it
      belongs. A deployment without the call module gets no bar and loses nothing else.
    */
    { anchor: CALL_STATUS_ANCHOR, node: extractionSignal, order: 10 },
  ],

  /*
    Hold everything while this module is recording, whatever the space thinks.

    The same argument as the call module's `holdsWhen`, and the same failure without it: a module's
    chrome is gated on the space having enabled it, which is right for chrome *about* that space and
    wrong for a module whose work outlives the space it started in. Recording follows the call, and
    the call survives navigation — so walking into a space that has not enabled transcribe unmounted
    the controls, the status and the panel while the microphone carried on. There was no way to stop
    it except leaving the call, and no sign it was still running.

    `enabled` is false the moment recording stops, which is what this has to satisfy: a key that
    stayed true would make the chrome permanent.
  */
  holdsWhen: 'modules.transcribe.enabled',

  /**
   * A panel that makes room rather than covering. See `DockContribution`.
   *
   * `dockEdge` returns null while closed, which is how the host knows there is nothing to place —
   * one key answering both "where" and "whether", so the two can never disagree. `order` puts this
   * outside a notes panel sharing the edge, which is only a tiebreak: the host stacks whatever is
   * there rather than letting two panels land in the same box.
   */
  docks: [{ edge: 'dockEdge', size: 'dockSize', float: 'dockFloat', close: 'closePanel', node: panel, order: 90 }],
  /**
   * What a space, and an agent, may decide about recording.
   *
   * One setting, and every level may answer it — which is what `restrict` is for. Recording is on
   * by default because that is what makes a transcript trustworthy: a record that exists four
   * meetings out of five is worse than either default, since nothing separates "we chose not to"
   * from "nobody pressed the button". From there a community can switch it off for everyone, and an
   * agent can switch it off for themselves everywhere or in one space — and none of them can force
   * it back **on** against somebody else's refusal, which is the only direction a microphone
   * decision may travel.
   *
   * Declared rather than read off the space directly: this module has no view of a space's
   * decisions, and giving it one to answer a single question would put the policy in the module and
   * the space's schema in a module's reach. What comes back through `deps.settings` is one boolean.
   */
  settings: [
    {
      key: 'recordCalls',
      label: 'Record calls automatically',
      description:
        'Transcription starts when a call does, without anyone pressing record. Leaving a recording, or stopping it by hand, still only affects your own microphone for that call.',
      type: 'boolean',
      default: true,
      levels: ['deployment', 'agent', 'space', 'agent-in-space'],
      resolution: 'restrict',
    },
  ],

  /**
   * The rail opens the transcript; the call bar records into it.
   *
   * No `availableWhen` any more. The rail used to start recording, so offering it without audio was
   * offering nothing — now it opens a panel that can explain why there is nothing to record, which is
   * strictly more use than an absent button. Recording moved to where the microphone already is.
   */
  launcher: {
    icon: 'waveform',
    label: 'Transcript',
    action: 'togglePanel',
    activeWhen: 'open',
  },

  createStore: (deps: ModuleStoreDeps) => createTranscribeStore(deps),
});
