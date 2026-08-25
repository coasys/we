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
 * leaves no trace. See `store.ts` for the convergence rule when several agents record at once.
 *
 * ## What it is not yet
 *
 * No speaker threading, and no summary generation — deliberately, because the next step is an LLM
 * pass that builds a knowledge map from this text, and it would rather re-segment raw utterances than
 * unpick someone else's structure. It now has somewhere to hang that summary when it arrives.
 */
import { defineModule, type ModuleStoreDeps } from '@we/module-shared';

import { CALL_CONTROLS_ANCHOR, callControl } from './CallControl.schema';
import { CALL_STATUS_ANCHOR, extractionStatus } from './ExtractionStatus.schema';
import { panel } from './Panel.schema';
import { createTranscribeStore } from './store';

export { CALL_CONTROLS_ANCHOR, callControl } from './CallControl.schema';
export { CALL_STATUS_ANCHOR, extractionStatus } from './ExtractionStatus.schema';
export { panel } from './Panel.schema';
export { CALL_KIND, CALL_PREDICATE, createTranscribeStore, TRANSCRIBE_ACTIVITY, type TranscribeStatus } from './store';
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
    { anchor: CALL_STATUS_ANCHOR, node: extractionStatus, order: 10 },
  ],

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
