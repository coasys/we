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
 * It does not import `@we/module-call`, and the call module does not import this. The call publishes
 * its microphone through the `media` kernel; this module asks for the same kernel and reads
 * `media.input()`. Neither module has a reference to the other, so either can be uninstalled and
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
 * A community that does not want its calls recorded says so through `contributes.settings`, and so
 * does an agent who does not want their own recorded — see the declaration below. Declared rather
 * than read off the space: nothing in this module can see a space's decisions, and giving it that
 * view to answer one question would put the policy in the module and the space's schema in a
 * module's reach.
 *
 * ## What it is not yet
 *
 * No speaker threading, and no summary generation — deliberately, because the next step is an LLM
 * pass that builds a knowledge map from this text, and it would rather re-segment raw utterances than
 * unpick someone else's structure. It now has somewhere to hang that summary when it arrives.
 */
import { defineModule, type ModuleHost, type ModuleStoreDeps } from '@we/module-shared';

import { CALL_CONTROLS_ANCHOR, callControl } from './CallControl.schema';
import {
  captureMeter,
  captureStatus,
  coverage,
  extractionPanel,
  extractionTargets,
  panel,
  pendingUtterance,
  SUBJECT_EXPR,
  transcriptComposer,
  transcriptFeed,
  transcriptLines,
} from './Panel.schema';
import { createTranscribeStore } from './store';

export { CALL_CONTROLS_ANCHOR, callControl } from './CallControl.schema';
export { extractionActivity } from './ExtractionStatus.schema';
export {
  captureMeter,
  captureStatus,
  coverage,
  extractionTargets,
  panel,
  pendingUtterance,
  transcriptComposer,
  transcriptFeed,
  transcriptLines,
} from './Panel.schema';
export { createTranscribeStore, TRANSCRIBE_ACTIVITY, type TranscribeStatus } from './store';
export { WORKLET_NAME, WORKLET_SOURCE } from './workletSource';

export const transcribeModule = defineModule({
  manifest: {
    id: 'transcribe',
    name: 'Transcription',
    description: 'Turns what is said in a call into text blocks in the space.',
    icon: 'waveform',
    requires: {
      /**
       * Exactly the kernels the store reaches, and every one of them.
       *
       * `records` for the utterances, the roster link and an edited suggestion's write-back;
       * `presence` to find the call this agent is in and to say it is recording; `media` for the
       * microphone the call publishes; `transcription` for speech to text; `interpretation` for the
       * extraction passes and everything staged by one. A kernel not named here is absent from the
       * bag, so leaving one out is not a smaller declaration — it is a store that silently degrades.
       */
      kernels: ['records', 'presence', 'media', 'transcription', 'interpretation'],
      // `microphone` even though this module never calls `getUserMedia`: it listens to a live
      // microphone, and the list exists to tell a user what a module can hear, not which API it
      // called to hear it. What it *writes* is derived from the kernels rather than declared — see
      // `moduleCapabilities`.
      permissions: ['microphone'],
    },
    // No `backends`: transcription goes through the port, so this runs on any backend that
    // implements one — and degrades to a stated reason on any that does not. No `frameworks`:
    // fragments only.
  },

  contributes: {
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
     * The panel's own chrome is the exception that proves it: the header and the record button are
     * *the panel's*, not pieces of what this module knows, so an interface supplying a body writes
     * its own. It should need to far less often than it did — the workshop wrote a body for one
     * reason, route-awareness, and that now lives in the panel here.
     */
    parts: {
      /*
        The feed's subject is the whole route-aware expression, not the bare live id.

        Substitution is whole-token, so the token a consumer replaces has to be the one actually in
        the tree — and since the feed became route-aware that is `SUBJECT_EXPR`. Naming the live id
        here would match nothing and a `subject` would silently do nothing, which is the failure mode
        this map exists to avoid.
      */
      transcriptFeed: { node: transcriptFeed, subject: SUBJECT_EXPR },
      transcriptLines: { node: transcriptLines, subject: 'modules.transcribe.collectionId' },
      // Bare nodes rather than `{ node }`: the wrapper exists to name a subject, and these have none.
      // The composer writes into the live call by construction — it is about this agent typing now,
      // not about whichever call is being read — so there is no subject to point elsewhere.
      transcriptComposer,
      captureMeter,
      captureStatus,
      coverage,
      extractionTargets,
      pendingUtterance,
    },

    slots: [
      // Into the call module's own bar. It declares the anchor; we never name the module.
      /*
        Only the record button. The bar is for what a person does to themselves right now — mute,
        camera, transcribe-me — and this is the one control of that kind this module has.

        Extraction had a square here too, in three lives: a readout on a second anchor under the
        bar, then a way into the panel, then the switch for automatic extraction with a spinner while
        a pass ran. Each was a fair answer to "how does somebody see a pass is running without opening
        anything", and each put a group decision beside a personal one in a row that reads as one set
        of controls. The rail answers the visibility question now — see `busyWhen` on the extraction
        panel below — and the switch lives in the extraction panel, which has room to say whose
        decision it is. The call module's `call-status` anchor has nothing left to hold.
      */
      { anchor: CALL_CONTROLS_ANCHOR, node: callControl, order: 10 },
    ],

    /*
      Hold everything while this module is recording, whatever the space thinks.

      The same argument as the call module's `holds`, and the same failure without it: a module's
      chrome is gated on the space having enabled it, which is right for chrome *about* that space and
      wrong for a module whose work outlives the space it started in. Recording follows the call, and
      the call survives navigation — so walking into a space that has not enabled transcribe unmounted
      the controls, the status and the panel while the microphone carried on. There was no way to stop
      it except leaving the call, and no sign it was still running.

      `enabled` is false the moment recording stops, which is what this has to satisfy: a key that
      stayed true would make the chrome permanent. A bare store key, as every other key on this
      declaration is — the `modules.transcribe.` prefix is the host's spelling, not the module's.
    */
    holds: 'enabled',

    /**
     * Two panels, because they are two things.
     *
     * A transcript follows this agent's microphone and is read while somebody talks; extraction
     * follows a pass that may be a peer's, takes minutes, spends tokens and is read afterwards. In one
     * column that was a transcript, a meter, a coverage line, four status notes, an extract control, a
     * chip row and a proposal list — two surfaces wearing one coat, and the reason nobody could find
     * the half they wanted.
     *
     * Named, because a placement is remembered against a dock's id: unnamed they would be
     * `transcribe:0` and `transcribe:1`, and inserting a third at the top would renumber both and
     * throw away wherever anybody had dragged them. The names are also what a template's `meta.panels`
     * entry says to supply one body rather than the other.
     *
     * Both bid for the right edge, so the host stacks them; an interface that wants them apart moves
     * one and the host remembers. The bid is data here rather than three accessors each on the store
     * returning constants, which is all `dockEdge` / `dockSize` / `dockFloat` ever were.
     *
     * ## Why the module owns whether they are open
     *
     * The host holds a panel's openness by default, and for most panels that is right: a notes panel
     * being open is a fact about the screen. These two are the exception the contract describes.
     * Pressing record opens the transcript, because starting something invisible and saying nothing
     * about it is how a feature comes to look broken; a pass *starting* — anybody's — opens the
     * extraction panel, because the four people in five who did not start it are the ones who need
     * telling; and the store reads `open` to keep polling for a model while the panel says there is
     * none. Each of those is the module changing or reading the flag, which a host-held flag would
     * leave it no way to do. So both name `open`, and with it `show` and `close`, which the rail and
     * the titlebar call in place of a toggle of the module's own.
     *
     * ## The rail buttons
     *
     * Derived from the panels — a panel with an `icon` gets one — so the two launchers this used to
     * declare are gone. The transcript's is the plain module entry it has always been; the
     * extraction's spins while any peer's pass runs, which is the glance the call bar's square used
     * to give, in the place that outlives the call and opens the panel that explains it.
     */
    panels: [
      {
        name: 'transcript',
        title: 'Transcript',
        icon: 'waveform',
        node: panel,
        // `right` because that is the edge the module rail is on and where this has always opened;
        // `md` is an opening bid the user overrides by dragging. Never floating: a transcript you
        // read alongside the space is the case docking exists for.
        bid: { edge: 'right', size: 'md' },
        open: 'open',
        show: 'openPanel',
        close: 'closePanel',
        order: 90,
      },
      {
        name: 'extraction',
        title: 'Extraction',
        icon: 'sparkle',
        busyWhen: 'passRunning',
        node: extractionPanel,
        bid: { edge: 'right', size: 'sm' },
        open: 'extractionOpen',
        show: 'openExtractionPanel',
        close: 'closeExtractionPanel',
        order: 91,
      },
    ],

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
  },

  createStore: (deps: ModuleStoreDeps) => createTranscribeStore(deps),
});

/**
 * What a host calls to get the module.
 *
 * Takes the host's components and uses none of them — this module contributes fragments only — but
 * the shape is the contract's, so a host loads every module the same way whether or not one needs a
 * framework component lent to it.
 */
export const createModule = (_host: ModuleHost) => transcribeModule;
