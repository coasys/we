import { activitiesOfType } from '@we/backend-shared';
import type { ModuleStoreDeps } from '@we/module-shared';

import { WORKLET_NAME, WORKLET_SOURCE } from './workletSource';

/**
 * How eagerly the backend closes an utterance.
 *
 * Deliberately less twitchy than the preview settings Flux runs alongside its main stream: this is
 * the transcript of record, so it would rather wait and be right. A second, faster stream for live
 * word-by-word feedback is a later addition and does not change anything here.
 */
const TUNING = { startThreshold: 0.8 };

/**
 * Characters of transcript held before writing a block.
 *
 * Flux's number, kept. One block per utterance would be truer to the source but writes a record
 * every few seconds for every participant, into a perspective that syncs to all of them; one block
 * per call would be a single unreadable wall by the end. This is the compromise, and it is the level
 * a later knowledge map would want to re-segment from anyway.
 */
const MAX_CHARS = 1000;

/** Silence after which whatever has accumulated is written, so a short remark is not held forever. */
const FLUSH_AFTER_MS = 3_000;

/** The predicate `CollectionBlock.children` is minted under — how an utterance attaches to its call. */
export const CHILDREN_PREDICATE = 'we://children';

/**
 * The activity this module publishes so peers can converge on one record per call.
 *
 * Its own type rather than a field on the call activity, which keeps the two modules mutually
 * ignorant: the call module neither knows nor cares that anyone is recording, and this module never
 * has to write into a structure the call module owns. It also gives the coverage signal for free —
 * who is *transcribing* against who is merely present.
 */
export const TRANSCRIBE_ACTIVITY = 'transcribe';

/**
 * What extraction is allowed to produce from a transcript — **asked, no longer declared.**
 *
 * This was `EXTRACT_CLASSES = ['TaskBlock', 'EventBlock']`, and the list is now
 * `interpretation.targets()`: core vocabulary that declares itself `extractable`, plus every model
 * the space's own community defined and marked so. The constant is gone because it was the reason a
 * community could write careful AI hints for a `Sighting` and never have anything extract one —
 * the hints were stored, synced and editable, and the list that decided what to look for named two
 * classes this module had been compiled with.
 *
 * The argument for keeping that list *short* is not gone, it moved. Every entity named puts its
 * **whole shape** into the prompt, so the list is the cost and the quality control: a longer one is
 * slower, dearer and vaguer rather than more capable. That is now the case for `extractable` being
 * opt-in — see `EntitySchema.extractable`, which also records why `TextBlock` must never carry it
 * (its shape is mostly serialization — `indent`, `textFormat`, `listType` — a dozen fields a model
 * can only fill with noise) and why `CollectionBlock` must not either (it carries `mode`, and a
 * machine-written collection with no mode reads as legacy, which makes `reconcileBlocks` willing to
 * delete children it did not author — other agents' utterances).
 */

/**
 * An entity name as a person would say it — `TaskBlock` → "Task", `BirdSighting` → "Bird sighting".
 *
 * A module cannot reach `recordStore.displays`, where a model's real display name lives, and should
 * not: this list is a row of toggles in a call panel, not a record surface. The two rules cover
 * everything that can appear here — WE's own extraction targets are `*Block` classes, and a
 * community's shape is named the way its author typed it.
 *
 * Presentation only. Every write and every request uses the entity name.
 */
function humanise(entity: string): string {
  const bare = entity.endsWith('Block') ? entity.slice(0, -'Block'.length) : entity;
  const spaced = bare.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** How an extraction pass is going. `done` holds until the next run, so the result stays readable. */
export type ExtractStatus = 'idle' | 'running' | 'done' | 'error';

/**
 * One staged suggestion, flattened for display.
 *
 * `summary` rather than the raw value map, because a schema `$each` cannot iterate an object's
 * entries and a person deciding whether to keep a suggestion needs to read it, not inspect it. Built
 * here so the panel stays declarative — the alternative was a template that knew which field of a
 * task to show first, which is knowledge about models rather than about layout.
 */
export interface ProposalView {
  id: string;
  /** `create` proposed a whole record; `update` proposed changes to one that exists. */
  kind: string;
  /** What it says, in the order a reader wants it: what it is, then the detail. */
  summary: string;
}

/** Field names worth leading with, most identifying first. Anything else follows in map order. */
const SUMMARY_FIELDS = ['title', 'text', 'name', 'startDate', 'dueDate', 'assignee', 'location'];

/** Flatten a proposal's values into one readable line. */
/**
 * How much of one proposed value is shown, and how much of the summary in total.
 *
 * Both ends of this are a model's output: an LLM reading a transcript decides the field values, and
 * a transcript is whatever anybody in the call said out loud. `String(value)` with no bound is
 * therefore a row in a review list whose length a speaker chooses — and the review list is the one
 * surface whose whole job is being readable enough to make a decision from.
 *
 * Truncated with an ellipsis rather than refused: the point of the row is to be recognisable, and a
 * value cut short still recognises. What is being accepted is the record, not this string.
 */
const MAX_SUMMARY_VALUE = 120;
const MAX_SUMMARY_LENGTH = 400;

function summarise(values: Record<string, unknown>): string {
  const named = SUMMARY_FIELDS.filter((field) => values[field] !== undefined && values[field] !== '');
  const rest = Object.keys(values).filter((field) => !SUMMARY_FIELDS.includes(field));
  const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
  const line = [...named, ...rest]
    .map((field) => `${cut(field, 40)}: ${cut(String(values[field]), MAX_SUMMARY_VALUE)}`)
    .join(' · ');
  return cut(line, MAX_SUMMARY_LENGTH);
}

/**
 * The height of the extraction signal under the call bar, in pixels.
 *
 * One line of text in a strip padded `200` a side, and — unlike the readout this replaced — a strip
 * that cannot grow: the label truncates and concurrent passes collapse to a count, so this is the
 * real height rather than a collapsed one somebody has to reason about.
 *
 * Reserved at the *bottom*, because that is the edge the call bar took and this is mounted into its
 * column. The edge is the anchor's, not this module's choice: it contributes to `call-status` and
 * lands wherever that column is.
 */
const STATUS_RESERVE_PX = 40;

/** Its widest, which the signal itself caps — see `maxWidth` in `ExtractionStatus.schema`. */
const STATUS_WIDTH_PX = 320;

/**
 * Flux's *effective* voice-activity thresholds, which are not the ones in its defaults file.
 *
 * `audio-processor.js` declares one set and `TranscriberWidget.vue` overwrites it over the port the
 * moment it starts, so the shipped defaults are dead values that Flux never runs with. Porting the
 * file faithfully therefore reproduced roughly double the real thresholds, and the symptom was
 * having to speak up to be heard at all.
 *
 * Sent rather than baked into the worklet source so the two stay distinguishable: the source keeps
 * the upstream defaults it was ported from, and this is the deliberate override — the same shape
 * Flux uses, and the place to tune from.
 */
const VAD = {
  /**
   * 0.08 in the defaults, 0.04 in Flux. Onset is the one that decides whether normal speech
   * registers at all, and even Flux's number wanted a raised voice at ordinary mic distance.
   */
  speechOnsetThreshold: 0.025,
  /** 0.05 in the defaults. Too high and a sentence is cut at its quieter moments. */
  silenceThreshold: 0.015,
  /** 12 in the defaults — ~32ms of held speech rather than ~16ms. */
  onsetHoldFrames: 6,
  /** 8000 in the defaults. Largely academic either way, since pre-roll already fills the buffer. */
  minUtteranceSamples: 2400,
  /**
   * 0.04 in the defaults — the same figure as the onset threshold, but measured across the whole
   * utterance rather than one frame, and the utterance carries 500ms of pre-roll and up to 500ms of
   * trailing silence. So the old value was the real floor: quiet speech could open an utterance and
   * still be dropped on the way out. Lowered in step with onset, and kept above zero because the
   * hallucination it exists to prevent is real — a near-silent segment makes Whisper invent "you".
   */
  minUtteranceRms: 0.02,
};

/**
 * How often the worklet reports the level it is measuring, in audio frames.
 *
 * ~64ms at 128 samples / 48 kHz. Fast enough to look live, slow enough that the meter is not posting
 * a message every 2.7ms across a thread boundary for a bar a few pixels wide.
 */
const LEVEL_EVERY_FRAMES = 24;

/**
 * Meter scale: how much of the bar one unit of RMS fills.
 *
 * Speech RMS lives around 0.04–0.25, so a linear 0–1 bar would squeeze everything interesting into
 * the leftmost few pixels and read as permanently empty. At ×400 the onset threshold sits at 10% and
 * an ordinary voice fills most of the track.
 */
const METER_SCALE = 400;

/** Clamped so a shout does not overflow the bar, and rounded so the width does not jitter. */
const asPercent = (value: number) => `${Math.min(100, Math.round(value * METER_SCALE))}%`;

export type TranscribeStatus = 'idle' | 'no-backend' | 'no-model' | 'no-audio' | 'starting' | 'listening' | 'error';

/** What the worklet posts. Tagged, because it reports both what it heard and how loud things are. */
type WorkletMessage = { kind: 'utterance'; audio: Float32Array } | { kind: 'level'; rms: number; speaking: boolean };

/**
 * Where an utterance can go, if anywhere yet.
 *
 * Three outcomes rather than `string | null`, because two of them are nothing alike: `waiting` means
 * come back in a moment and the words are still good, `nowhere` means there is no call to attach
 * them to and they never will be. Collapsed into one null, the caller had to guess, and guessing
 * "drop it" is how a deferred first utterance would be lost.
 */
type CollectionSlot = { state: 'ready'; id: string } | { state: 'waiting' } | { state: 'nowhere' };

/**
 * Speech to text for the call this agent is in.
 *
 * ## What it listens to
 *
 * The call's own microphone, borrowed through `deps.audioInput` rather than opened here. That is
 * what makes muting the call stop the transcript: a muted track is disabled rather than removed, so
 * the worklet receives silence, the VAD never fires, and nothing is produced. A second
 * `getUserMedia` would have kept listening through the mute.
 *
 * ## What it writes
 *
 * A `CollectionBlock` with `kind: 'call'` per call, holding the utterances as `children`. The call
 * Not posts: a transcript is not authored content and should not arrive in a feed as though it were.
 *
 * The collection is what makes the transcript a *thing* rather than loose text — it groups one call's
 * utterances, carries its participants, and (later) its summary. It renders from its children and
 * never from an `editorState`, which is what keeps several agents writing into it conflict-free:
 * children links are add-only, whereas a shared serialized document would be last-write-wins.
 *
 * Author and timestamp come free from the model, so a block already knows who said it and when
 * without this module recording either — which is also why speaker attribution is free here and
 * needs no diarization: every agent transcribes only their own microphone.
 *
 * ## Lifecycle
 *
 * Created **lazily on first flush**, never on button press. A record therefore exists if and only if
 * somebody actually said something: no empty records are possible, and no delete path is needed. The
 * end is derived from the last child's timestamp rather than written, so nobody has to remember to
 * close it and it cannot go wrong when the creator is the first to leave.
 *
 * ## Converging on one record
 *
 * Whoever writes first creates the collection and announces it on presence as a
 * `{@link TRANSCRIBE_ACTIVITY}` activity; everyone else in the same call adopts it off the roster.
 * If two people speak for the first time inside the same heartbeat, both may create before either
 * sees the other — that yields two records for one meeting, which is cosmetic (every agent's blocks
 * are attached to a valid record) and dedupable on read. The simple version ships first.
 */
export function createTranscribeStore(deps: ModuleStoreDeps) {
  const {
    signal,
    effect,
    audioInput,
    transcription,
    interpretation,
    createEntity,
    linkEntity,
    dataset,
    presence,
    selfId,
    onDispose,
  } = deps;

  const [status, setStatus] = signal<TranscribeStatus>('idle');
  /** Whether we are recording. Independent of the panel — see the two toggles at the bottom. */
  const [enabled, setEnabled] = signal(false);
  /** Whether the transcript panel is showing. Independent of recording, so a finished session can be read. */
  const [open, setOpen] = signal(false);
  const [error, setError] = signal<string>('');
  /** What has been heard but not yet written — shown live, so the user can see it working. */
  const [pending, setPending] = signal<string>('');
  /**
   * Microphone loudness as the VAD measures it, 0–1, and whether it currently counts as speech.
   *
   * The same RMS the onset decision is made on rather than a second measurement of the same signal,
   * so a meter drawn from it cannot disagree with the thing it is explaining.
   */
  const [level, setLevel] = signal(0);
  const [speaking, setSpeaking] = signal(false);
  /**
   * The collection this session's utterances are written into, once there is one.
   *
   * Null until the first thing worth recording is said. Cleared when the call ends, so the next call
   * starts a new record rather than appending to the last one.
   */
  const [collectionId, setCollectionId] = signal<string | null>(null);
  /**
   * The last extraction pass, if there has been one.
   *
   * Kept as state rather than fired and forgotten because an LLM pass takes seconds, and a button
   * that does nothing visible for that long reads as broken. `count` survives into `done` so the
   * panel can say what happened rather than just stopping.
   */
  const [extractStatus, setExtractStatus] = signal<ExtractStatus>('idle');
  const [extractCount, setExtractCount] = signal(0);
  const [extractError, setExtractError] = signal('');
  /**
   * Which collection a pass is running on, and which one the last result describes.
   *
   * Two ids rather than one, because extraction is now offered per card in a list: a single status
   * flag would put "Reading…" on every call in the space while one of them is working, and would
   * attribute a finished pass's count to whichever card the eye landed on. `extractingId` clears
   * when the pass ends; `extractedId` persists so the card that asked can show what came back.
   */
  const [extractingId, setExtractingId] = signal('');
  const [extractedId, setExtractedId] = signal('');
  /**
   * How many turns the last pass actually read.
   *
   * Without it, "the model found nothing in this conversation" and "no transcript reached the model"
   * are the same empty result — and they need opposite responses. The first is a fact about the
   * meeting; the second means something between the collection and the prompt is dropping turns, and
   * every one of those failures (a wrong containment predicate, an unreadable timestamp, the wrong
   * collection) looks exactly like a quiet meeting.
   */
  const [extractTurns, setExtractTurns] = signal(0);
  /**
   * Suggestions the backend staged instead of writing, awaiting a person.
   *
   * Held rather than queried on render because resolving one is a round trip and the list has to
   * update without a second: accepting the third of five should leave four, immediately, without
   * re-reading the whole set and without the row a user is looking at jumping.
   */
  const [proposals, setProposals] = signal<ProposalView[]>([]);
  /**
   * Why the standing watch is not running, when it is not.
   *
   * Empty in the ordinary case — including on a host that never had a watch to fail, since the
   * affordance is not offered there either. See the catch in `syncWatch` for why this is recorded
   * rather than only logged.
   */
  const [watchProblem, setWatchProblem] = signal<string>('');
  /**
   * The call the current collection belongs to.
   *
   * The record's lifetime is the *call's*, not the recording toggle's. Tying it to the toggle meant
   * switching recording off and back on in one meeting produced two records for it — and the whole
   * point of the collection is that a call has one.
   */
  let collectionCallId: string | null = null;
  /**
   * Records this agent has already added itself to, so it is written once per transcript.
   *
   * Keyed on the collection rather than on the agents seen — see `recordSelfParticipation` for why
   * that key, and why the set is never cleared when a call ends.
   */
  const recordedParticipants = new Set<string>();
  /**
   * This agent has taken itself out of this call's transcript.
   *
   * Per *call*, where the old dismissal was per peer. That granularity was right while the prompt
   * was an offer — someone else starting later was a new thing to be told about. It is wrong now
   * that recording starts on its own: leaving is a decision about this agent's own microphone for
   * this conversation, and a second peer starting is not a reason to revisit it. Per peer, the
   * agent who pressed Leave would be switched back on by the next person to press record.
   *
   * Also what stops the auto-join effect fighting the record button: turning recording off by hand
   * sets this, so the effect sees a decision rather than an agent who is merely not recording yet.
   */
  const [optedOut, setOptedOut] = signal(false);
  /**
   * Recording is running because a peer was already transcribing, not because this agent said so.
   *
   * Kept because the two are the same state to everything downstream and different things to say:
   * one is a thing you did, the other is a thing that happened to you and has to be declared. It is
   * what the call bar reads to say so, and what `start` reads to fail quietly — see `giveUpAutoJoin`.
   */
  const [autoJoined, setAutoJoined] = signal(false);
  /**
   * Auto-join has given up on this call, because this node turned out not to be able to transcribe.
   *
   * Without it the effect would re-arm the moment `start` switched recording back off, and the two
   * would spin against each other for the length of the call.
   */
  const [autoJoinFailed, setAutoJoinFailed] = signal(false);
  /**
   * A record this agent has been asked to continue, held until there is a call to continue it in.
   *
   * Deferred rather than applied on the spot because the two halves of "continue this call" cannot
   * be sequenced from a schema: joining is fire-and-forget — `joinCall` returns nothing, so an
   * `onSuccess` never fires — and it publishes the call activity several awaits deep. Pinning
   * immediately would therefore land before there was any call to pin to, and be dropped.
   */
  const [pendingResume, setPendingResume] = signal<string>('');

  let context: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let stream: Awaited<ReturnType<NonNullable<typeof transcription>['open']>> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let buffer = '';
  /**
   * Bumped by every start and every stop, so a start that lost a race can tell.
   *
   * Starting is slow in a way the user can act inside of: loading Whisper takes seconds, during
   * which the panel says "Starting…" and nothing appears. Switching off in that window used to leave
   * the half-built session to finish and go on transcribing — the UI said off, blocks kept arriving,
   * and nothing held a reference to shut it down.
   */
  let generation = 0;

  function clearTimer() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
  }

  /**
   * The call this agent is in, read off its own presence entry.
   *
   * Presence is the only channel used, and no message is exchanged with the call module: every
   * participant already publishes `{ type: 'call', id, anchor? }`, and the presence driver keeps this
   * agent's own state in the roster. So "which call am I in, and what is it about" is answerable
   * locally, from data that is already there, without either module knowing the other exists.
   */
  function myCall(): {
    id: string;
    anchorNodeId: string | null;
    recordId: string | null;
    datasetUri: string | null;
  } | null {
    const me = selfId?.() ?? null;
    if (!me || !presence) return null;
    const mine = activitiesOfType(presence.peers(), 'call').find(({ peer }) => peer.agentId === me);
    if (!mine) return null;
    const anchor = (mine.activity as { anchor?: { nodeId?: string; datasetUri?: string } }).anchor;
    return {
      id: mine.activity.id,
      anchorNodeId: anchor?.nodeId ?? null,
      /*
        The space the call is *in*, which is not necessarily the space on screen.

        A call survives navigation, so by the time somebody speaks the reader may be two spaces away
        — and every write here used to resolve to "the current dataset", which put the utterance in
        the wrong perspective with a `children` link to a record that perspective does not hold.
        Peers in the call's own space stopped seeing the transcript. The call module publishes this
        on every activity, so it is already here; it just was not being read.
      */
      datasetUri: anchor?.datasetUri ?? null,
      // Published by the call module from the moment the call starts — see `recordCallId`. This is
      // what replaced electing a creator among the transcribers.
      recordId: (mine.activity as { record?: string }).record ?? null,
    };
  }

  /**
   * Everyone *else* recording this call right now, sorted.
   *
   * Split out from `recordersOf` because most of the questions asked here are about the others: who
   * to name in the notice, and whether there is a transcript worth joining at all. Folding this
   * agent into that list means the notice can end up naming the reader to themselves, which is what
   * happened the moment the prompt stopped being conditional on *not* recording.
   */
  function peerRecordersOf(callId: string): string[] {
    const me = selfId?.() ?? null;
    if (!presence) return [];
    return activitiesOfType(presence.peers(), TRANSCRIBE_ACTIVITY)
      .filter(
        ({ peer, activity }) =>
          peer.agentId !== me &&
          (activity as { id?: string }).id === callId &&
          (activity as { recording?: boolean }).recording === true,
      )
      .map(({ peer }) => peer.agentId)
      .sort();
  }

  /**
   * Everyone recording this call right now, this agent included, sorted.
   *
   * Coverage reads it: it is the numerator in "2 of 4", where the whole point is that this agent
   * counts as one of them. Sorted so the list a member reads is stable rather than following
   * whatever order the roster happened to arrive in.
   */
  function recordersOf(callId: string): string[] {
    const me = selfId?.() ?? null;
    const peers = peerRecordersOf(callId);
    return (enabled() && me ? [me, ...peers] : peers).sort();
  }

  /** Everyone in this call, recording or not — the denominator coverage is measured against. */
  function agentsInCall(callId: string): string[] {
    if (!presence) return [];
    return activitiesOfType(presence.peers(), 'call')
      .filter(({ activity }) => activity.id === callId)
      .map(({ peer }) => peer.agentId)
      .sort();
  }

  /**
   * Publish what this agent is doing about this call's transcript.
   *
   * One activity carrying two separate facts, because they have different lifetimes. `recording` is
   * live — it goes true on the button press, which is what gives peers something to react to before
   * anybody has spoken, and false again on stop. `collection` says which record this agent is
   * writing into, and stays published after recording stops.
   *
   * `collection` used to be load-bearing: it was how peers found the record one of them had created,
   * and adopting an announced one was the alternative to creating a second. The call's own activity
   * now carries the record from the moment it starts, so this is no longer how anybody finds it — it
   * remains because `resume` writes a *different* record than the call names, and a peer has to be
   * able to see that somebody continued an old transcript.
   */
  function announce(callId: string, recording: boolean, collection?: string | null): void {
    const claim = collection ?? collectionId();
    /*
      Anchored to the call's space, exactly as the call module anchors its own activity.

      Without an anchor, `PresenceStore.setActivity` publishes into the space on screen — so an
      agent transcribing a call in A while reading B announced the transcription to **B's** peers,
      who cannot join the call it names, while A's peers never saw `recording: true` and had no way
      to know they were being recorded. That is the more serious half: a recording notice that
      reaches everyone except the people being recorded.
    */
    const anchorUri = myCall()?.datasetUri;
    presence?.setActivity({
      type: TRANSCRIBE_ACTIVITY,
      id: callId,
      recording,
      ...(anchorUri ? { anchor: { datasetUri: anchorUri } } : {}),
      ...(claim ? { collection: claim } : {}),
    });
  }

  /**
   * Put *this* agent on the call's roster, once per record.
   *
   * ## Why only itself
   *
   * `participants` is a `@HasMany` — a bag of links, not a set. Nothing at the storage layer can
   * refuse a link that is already there, and deliberately so: the alternative is a read-modify-write
   * that drops whoever loses the race. So the only way the relation becomes a set is if there is
   * exactly one writer per member, and the one writer who can never be raced about an agent's
   * presence is that agent.
   *
   * It used to append *everyone it could see*, from every agent that was recording. That is N writes
   * per person rather than one, it repeats on every session that resets the guard, and it grew
   * without bound: a two-person call carried each of them several times over, and the avatar row
   * drew a wall of the same two faces. Deduplicating at the point of drawing hid it; it did not stop
   * `$count` — or anything else that reads the relation — from being wrong.
   *
   * ## Why coverage survives
   *
   * The point of the roster is *coverage*: a transcript that shows somebody was present but silent
   * is worth much more than one that quietly looks complete. Appending only yourself would lose that
   * if it were tied to speaking — so it is not. The effect below runs for any agent in the call once
   * a record exists, whether or not they are recording and whether or not they ever say anything,
   * because the record's id is published on presence for everyone to read.
   *
   * ## Why the guard is keyed on the record
   *
   * Not on the call, which is derived from the space and so is the same id forever, and not cleared
   * when a call ends — an agent who leaves and rejoins the same conversation would otherwise append
   * itself a second time. Keyed on the collection, the answer to "have I already said I was here"
   * stays right across every leave and rejoin within a session.
   */
  async function recordSelfParticipation(collection: string, dataset?: string): Promise<void> {
    const me = selfId?.() ?? null;
    if (!linkEntity || !me || recordedParticipants.has(collection)) return;
    recordedParticipants.add(collection);
    try {
      await linkEntity('CollectionBlock', collection, 'participants', me, dataset ? { dataset } : undefined);
    } catch (cause) {
      // Let it be retried rather than losing this agent from the roster for the rest of the call.
      recordedParticipants.delete(collection);
      console.error('transcribe: could not record participation', cause);
    }
  }

  /**
   * The dataset every write and every read in this module is about: the call's, not the reader's.
   *
   * `undefined` when there is no call or no anchor, which the host reads as "the space on screen" —
   * the behaviour everything here had before, and the right one when nothing says otherwise.
   */
  function callTarget(): { dataset: string } | undefined {
    const uri = myCall()?.datasetUri;
    return uri ? { dataset: uri } : undefined;
  }

  /**
   * The record to write into — the one the call itself names.
   *
   * ## Adopting, not electing
   *
   * This used to create the record, and everything hard about it followed from that. A call had no
   * identity of its own until somebody spoke, so the first transcriber to flush minted the
   * `CollectionBlock` — and two agents flushing together minted two, for one meeting. That race was
   * fought with a distributed election among the recorders, a five-second timeout for an elected
   * creator who might never speak, and a documented failure mode where a partition still produced
   * two records.
   *
   * All of it is gone. A call now creates its record when it *starts* and publishes the id on its
   * presence activity, so every transcriber is told the answer before anyone has said a word. There
   * is nothing left to agree about, which is the only way to be safe under partition: the id was
   * decided by one agent, before the network could disagree, and it travels with the roster.
   *
   * `waiting` survives, and is the only interesting state left: the call is real but its record id
   * has not reached this agent yet, which is a presence round trip. The words are still good, so the
   * caller re-buffers rather than dropping them.
   */
  async function ensureCollection(): Promise<CollectionSlot> {
    const call = myCall();
    if (!call) return { state: 'nowhere' };

    const existing = collectionId();
    if (existing && collectionCallId === call.id) return { state: 'ready', id: existing };

    // In a call whose record has not arrived yet. Come back for it — see above.
    if (!call.recordId) return { state: 'waiting' };

    // A different call from the one the current record belongs to — start clean rather than
    // appending this meeting's words to the last one's transcript.
    useCollection(call.recordId);
    collectionCallId = call.id;
    announce(call.id, enabled());
    return { state: 'ready', id: call.recordId };
  }

  /** Write what has accumulated, if anything. Safe to call at any point, including teardown. */
  /**
   * Re-read the staged suggestions — this call's, not the whole dataset's.
   *
   * It used to be the whole dataset's, on the reasoning that the two coincide in practice: the only
   * thing staging proposals here is this call's own extraction. They do not coincide, because a
   * proposal outlives the pass that made it. One nobody accepted or rejected an hour ago is still
   * staged, so it arrived the moment the next call started — reading as something that call had
   * just found, in a panel that had been on screen for ten seconds.
   *
   * Accepting one made it worse rather than harmless. The instance was parented to the *earlier*
   * call when that pass ran, and accepting commits its values without moving it; so the record went
   * on existing exactly where it always had, and never appeared on the board of the call the
   * reviewer was sitting in. "Showing one more than expected" was not the cost — the cost was a
   * suggestion nobody could act on from where they were.
   *
   * `collection` names which conversation to ask about. A caller that has just run a pass passes the
   * one it ran, so extracting a *past* call from the calls list can still review what that found;
   * the default is the call in progress, and outside a call there is none — which asks the whole
   * space, the right answer for a surface that is about no one conversation.
   *
   * Never throws: this runs after a pass that already succeeded, and turning a successful extraction
   * into an error because the review list could not be fetched would be a lie about what happened.
   */
  async function loadProposals(collection?: string): Promise<void> {
    if (!interpretation) return;
    try {
      // The call's space, for the same reason the writes use it: a call outlives the space on
      // screen, so "proposals here" was answering about wherever the reader had wandered to. The
      // collection narrows it from that space to one conversation.
      const staged = await interpretation.proposals(callTarget(), collection ?? collectionId() ?? undefined);
      setProposals(staged.map((p) => ({ id: p.id, kind: p.kind, summary: summarise(p.values) })));
    } catch {
      setProposals([]);
    }
  }

  /*
    Re-read the staged suggestions whenever a pass settles — anybody's, not just a press of ours.

    The one-shot path reloads on its own, because it has the result in hand. A *standing* pass has
    nobody waiting on it: it runs on whichever peer registered the watch, stages what it found in
    the shared graph, and announces nothing this client acts on. So auto-extraction produced proposals
    that were really there and never appeared — the review list only ever filled after somebody
    pressed Extract, which reads as "automatic extraction cannot propose anything".

    Keyed on how many passes have *settled* rather than on the feed itself: a running pass emits a
    step every few seconds and reloading on each would be a round trip per phase, for an answer that
    cannot have changed until the pass finishes. Counting settled passes fires once per completion,
    which is exactly when there is something new to fetch.

    Peers' passes count too, and must: proposals live in the shared graph, so a pass run on somebody
    else's node stages rows this agent is being asked to review.
  */
  let settledSeen = 0;
  effect?.(() => {
    // Feature-tested per method, like `syncWatch` and `targetsFor`: the host publishes a forwarding
    // wrapper that is always present, so `interpretation?.` only answers "is there a wrapper" — and
    // this runs at construction, where a host without an activity feed would otherwise throw.
    const feed = typeof interpretation?.activity === 'function' ? interpretation.activity() : [];
    const settled = feed.filter((pass) => !pass.running).length;
    if (settled === settledSeen) return;
    settledSeen = settled;
    void loadProposals();
  });

  /**
   * What this call extracts, and what else it could — the host's answer, not this module's.
   *
   * Three layers decide it and none of them is a module's business: the codebase says what is a
   * candidate, the space says what its calls start with, the call's participants say what this one
   * is doing. This used to be a constant naming two classes, which is why a community could write
   * careful hints for a `Sighting` and never have anything extract one.
   *
   * Feature-tested per method rather than per object, the same way `syncWatch` tests its two: the
   * host publishes a forwarding wrapper that is always present, so `interpretation?.` only answers
   * "is there a wrapper" — and a host predating this list has one without a `targets` on it.
   */
  const targetsFor = (collection: string): { entity: string; selected: boolean }[] =>
    typeof interpretation?.targets === 'function' ? interpretation.targets(collection) : [];

  /** Whether a pass over this collection has anything to look for. */
  const hasTargets = (collection: string): boolean => targetsFor(collection).some((t) => t.selected);

  /**
   * One extraction pass over a named collection.
   *
   * Flushes only when the named collection is the live one, which is exactly right: pressing
   * Extract on this morning's call should not push a word said just now into it.
   *
   * One shot, driven by a press rather than a timer. A standing watch is a better *feature* and a
   * worse thing to demonstrate — a button has a visible cause and a visible result, can be pressed
   * again when a pass disappoints, and cannot quietly run up a bill while nobody is looking.
   *
   * Re-running is safe and expected: the engine dedups against instances already in the graph, so a
   * second press over the same conversation updates what it found rather than duplicating it.
   */
  async function runExtraction(collection: string): Promise<void> {
    if (!collection || !interpretation) return;
    // One at a time across every surface. Two passes over one collection would race their writes,
    // and two over different collections would make the shared status unreadable.
    if (extractStatus() === 'running') return;

    setExtractingId(collection);
    setExtractStatus('running');
    setExtractError('');
    try {
      if (collection === collectionId()) await flush();
      const result = await interpretation.runOnCollection(collection);
      setExtractCount(result.ids.length);
      setExtractTurns(result.turns);
      setExtractedId(collection);
      setExtractStatus('done');
      // Only worth a round trip when the pass actually staged something. A backend with no
      // provenance gate reports nothing proposed and never had a list to fetch.
      //
      // Named rather than defaulted, because this pass is not always over the call in progress: the
      // calls list extracts a finished one, and reviewing what that found is the whole point of
      // being able to.
      if (result.proposed.length) await loadProposals(collection);
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : String(error));
      setExtractedId(collection);
      setExtractStatus('error');
    } finally {
      setExtractingId('');
    }
  }

  /**
   * How many times in a row a flush may find the call's record missing before giving up on those
   * words. At `FLUSH_AFTER_MS` apart this is the better part of a minute — long enough for a record
   * to replicate, short enough that a call whose record never arrives does not accumulate the whole
   * conversation in a buffer nothing will ever drain.
   */
  const MAX_WAITING_FLUSHES = 20;
  let waitingFlushes = 0;

  async function flush(): Promise<void> {
    clearTimer();
    const text = buffer.trim();
    buffer = '';
    setPending('');
    if (!text) return;

    try {
      const slot = await ensureCollection();

      /*
        The call's record has not arrived yet. Put the words back and come round again — dropping
        them would lose the opening line of every call for every agent who started speaking before
        the record synced, which is precisely the part of a conversation worth having.

        Capped, because the wait is not guaranteed to end: a call whose starter left before their
        record replicated never gets one, and an uncapped retry re-queued the same words on a timer
        for as long as the call ran, growing the buffer with every utterance and holding the whole
        conversation in memory unwritten. After the cap the words go to the console with the rest of
        the failures and the transcript carries on from wherever it can.
      */
      if (slot.state === 'waiting') {
        if (waitingFlushes >= MAX_WAITING_FLUSHES) {
          console.warn('transcribe: the call record never arrived; these words were not written', text);
          waitingFlushes = 0;
          return;
        }
        waitingFlushes += 1;
        buffer = buffer ? `${text} ${buffer}` : text;
        setPending(buffer);
        clearTimer();
        flushTimer = setTimeout(() => void flush(), FLUSH_AFTER_MS);
        return;
      }
      // Arrived. The next wait starts its own count rather than inheriting this one's.
      waitingFlushes = 0;

      if (slot.state === 'nowhere') {
        console.warn('transcribe: no call to attach this utterance to; not written');
        return;
      }

      // The call's space, not the reader's. See `myCall().datasetUri`.
      const dataset = myCall()?.datasetUri ?? undefined;
      await createEntity?.(
        'TextBlock',
        { text },
        { parent: { id: slot.id, predicate: CHILDREN_PREDICATE }, ...(dataset ? { dataset } : {}) },
      );
      await recordSelfParticipation(slot.id, dataset);
    } catch (cause) {
      // Reported but not surfaced as a failed state: the transcript continues, and losing one block
      // is better than stopping a call's transcription over a single write.
      console.error('transcribe: could not write block', cause);
    }
  }

  function onText(text: string): void {
    if (!text.trim()) return;
    buffer = buffer ? `${buffer} ${text.trim()}` : text.trim();
    setPending(buffer);
    if (buffer.length >= MAX_CHARS) {
      void flush();
      return;
    }
    clearTimer();
    flushTimer = setTimeout(() => void flush(), FLUSH_AFTER_MS);
  }

  /**
   * Undo an automatic start on a node that cannot transcribe, and say nothing about it.
   *
   * The counterpart to the promise auto-join makes. Recording that starts on its own is allowed to
   * be silent, so it has to be silent when it fails too: a node with no speech model would
   * otherwise open every call with a warning about something nobody asked for, and the one state
   * that warning exists to report — a person pressing record and finding nothing installed — would
   * be lost in the noise of it. Pressing record still says `no-model`, because then it is an answer.
   *
   * Logged rather than discarded: this is the one path where the app knows something the user does
   * not, and a developer looking for why a call is not being transcribed deserves the sentence.
   */
  function giveUpAutoJoin(reason: TranscribeStatus): void {
    console.info(`[transcribe] not joining this call automatically: ${reason}`);
    setAutoJoinFailed(true);
    setAutoJoined(false);
    setEnabled(false);
    setStatus('idle');
    const call = myCall();
    if (call) announce(call.id, false);
  }

  /**
   * Build the session into locals, and publish it only once it is whole.
   *
   * Nothing is assigned to the module-level handles until every await has resolved and the run is
   * confirmed to still be the current one. That is what makes a cancelled start leave nothing
   * behind: a stale run closes what it built and returns, and `stop` never has to reason about a
   * half-constructed pipeline.
   */
  async function start(audio: MediaStream): Promise<void> {
    // Asked at start rather than at construction: the host supplies a forwarding wrapper before the
    // backend has bound, so `transcription` is an object either way and only it knows whether there
    // is a port behind it yet.
    if (!transcription || transcription.available?.() === false) {
      if (autoJoined()) return giveUpAutoJoin('no-backend');
      setStatus('no-backend');
      return;
    }
    const mine = ++generation;
    setStatus('starting');
    setError('');

    let newStream: typeof stream = null;
    let newContext: AudioContext | null = null;

    /** Undo a start that lost the race, or threw partway. */
    const unwind = async () => {
      await newContext?.close().catch(() => {});
      await newStream?.close().catch(() => {});
    };

    try {
      const models = await transcription.models();
      if (mine !== generation) return await unwind();

      // `no-model` means *there is no model*, and nothing else. It used to also fire when a model
      // was installed but reported not-ready, which told the user to go and install the thing they
      // had already installed.
      if (models.length === 0) {
        if (autoJoined()) return giveUpAutoJoin('no-model');
        // Distinguished from a silent failure on purpose: no model and nobody talking look identical
        // from here, and only one of them is something the user can act on.
        setStatus('no-model');
        return;
      }

      // `ready` orders the choice; it never excludes. A model that reports not-ready is still the
      // only model there is, the executor loads on demand, and if it genuinely cannot run then
      // `open` fails and says why — which beats claiming nothing is installed.
      const preferred = (candidates: typeof models) => candidates.find((m) => m.isDefault) ?? candidates[0];
      const model = preferred(models.filter((m) => m.ready)) ?? preferred(models);

      newStream = await transcription.open(model.id, onText, TUNING);
      if (mine !== generation) return await unwind();

      newContext = new AudioContext();
      // Built here rather than fetched: see `workletSource`. Revoked as soon as it is registered —
      // `addModule` has finished with it, and an un-revoked object URL keeps its blob alive for the
      // lifetime of the document.
      const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
      try {
        await newContext.audioWorklet.addModule(workletUrl);
      } finally {
        URL.revokeObjectURL(workletUrl);
      }
      if (mine !== generation) return await unwind();

      const newNode = new AudioWorkletNode(newContext, WORKLET_NAME);
      // The thresholds that actually run. See `VAD` — the worklet's own defaults are the ones Flux
      // ships and does not use.
      newNode.port.postMessage({ ...VAD, levelEveryFrames: LEVEL_EVERY_FRAMES });
      const newSource = newContext.createMediaStreamSource(audio);
      newSource.connect(newNode);
      // Not connected to the destination: this is a listener, and routing the microphone to the
      // speakers would echo the speaker back to themselves.
      //
      // Closes over the local rather than the field, so an utterance in flight during a teardown
      // feeds the stream it was captured for instead of whatever happens to be current.
      const feedTo = newStream;
      newNode.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        if (event.data.kind === 'level') {
          setLevel(event.data.rms);
          setSpeaking(event.data.speaking);
          return;
        }
        void feedTo.feed(event.data.audio);
      };

      context = newContext;
      node = newNode;
      source = newSource;
      stream = newStream;
      setStatus('listening');
    } catch (cause) {
      await unwind();
      // A start that was already superseded must not repaint the panel — the run that replaced it
      // owns the status now, and an error from an abandoned attempt is noise.
      if (mine !== generation) return;
      setStatus('error');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /**
   * Tear down whatever is running, and cancel whatever is starting.
   *
   * `resting` is where the status lands afterwards. It is a parameter because "off" and "on but with
   * nothing to listen to" are different things to say, and teardown is async — a caller that set the
   * status itself would have it overwritten when this finished.
   */
  async function stop(resting: TranscribeStatus = 'idle'): Promise<void> {
    // Bumped first: a start still in flight is now stale, and will discard rather than publish.
    const mine = ++generation;

    /*
      Release the audio graph *before* awaiting anything, and null the handles in the same tick.

      It used to flush first and tear down after, which left `context` non-null across an await. The
      start guard is `if (!context)`, so audio returning inside that window found a context that was
      already on its way out, skipped, and then watched `stop` null it. Recording was dead with the
      button lit and no dependency left to change, so nothing re-triggered the effect: the only way
      back was to leave the space.

      Flushing after closing the port is also the more correct order — `buffer` already holds what
      was said, and a closed port cannot race it with one more message.
    */
    const closing = { node, source, context, stream };
    node = null;
    source = null;
    context = null;
    stream = null;
    setLevel(0);
    setSpeaking(false);

    closing.node?.port.close();
    closing.node?.disconnect();
    closing.source?.disconnect();

    // Neither waits on the other: the flush writes text, the closes release devices.
    await Promise.all([flush(), closing.context?.close().catch(() => {}), closing.stream?.close().catch(() => {})]);

    // The record is deliberately *not* released here. Stopping the recording is not leaving the
    // call, and someone who switches it off and on again is still in the same meeting — dropping the
    // id would give that meeting two transcripts. The claim stays published for the same reason: a
    // peer who starts recording later must adopt this record rather than create a second one.
    //
    // Releasing is the call ending's business, and the effect below owns it. The panel reads the
    // record rather than this session, so a transcript stays readable after recording stops.
    // Only if nothing started in the meantime. Releasing the graph early is what makes a restart
    // during this window possible at all, and a late `setStatus('idle')` would then describe the
    // session that replaced this one.
    if (mine === generation && status() !== 'error') setStatus(resting);
  }

  /**
   * Let go of the record when the call it belongs to is over.
   *
   * Keyed on the call rather than on recording, which is the distinction `stop` deliberately does not
   * make: leaving is what ends a transcript, and withdrawing the claim as we go stops a peer still in
   * the space from adopting a collection nobody is writing to.
   */
  /**
   * Take up a record somebody asked to continue, once there is a call to continue it in.
   *
   * This is the whole of "continue this call". A transcript's record is otherwise reachable only
   * while somebody who was in the call is still publishing a claim to it, so once everyone has left
   * it can never be added to again — which is the correct default, since the next conversation in
   * that space is a different meeting, but leaves no way back into one that ended by accident.
   *
   * Announcing it is what makes this converge for everyone else: peers adopt an announced record in
   * preference to the one the call names, so a single agent pressing Continue is enough to pull the
   * whole call back onto the old transcript.
   *
   * Deliberately does not start recording. Continuing a call is a decision about *which record* the
   * words go into; whether this agent's microphone is producing any is a separate decision, and the
   * same one the join prompt refuses to take on someone's behalf.
   */
  /**
   * Say "I was here" as soon as there is a transcript to say it on.
   *
   * This is what keeps the roster about *presence* rather than about contribution, now that each
   * agent writes only its own entry. It is deliberately not tied to recording or to speaking: the
   * record's id is published on presence by whoever owns it, so any agent in the call can read it
   * and add itself — including one who never turns transcription on and never says a word, which is
   * exactly the participant a transcript would otherwise quietly omit.
   *
   * Reactive on the roster, so an agent who joins a call already in progress lands here on the next
   * heartbeat rather than only if somebody happens to speak afterwards.
   */
  effect?.(() => {
    const call = myCall();
    if (!call) return;
    const collection = collectionId() ?? call.recordId;
    if (collection) void recordSelfParticipation(collection);
  });

  /*
    Keep a standing interpretation watch on whatever collection this call is writing into.

    Driven off `collectionId` rather than off the record button, because the collection is what a
    watch is *about* and it appears late: it is the call's own record, published on the call's
    presence activity. Registering on the button press would mean registering before there is
    anything to name.

    Every recorder runs this, and that is intended rather than tolerated — the registration is one
    row in the shared perspective keyed by collection id, so peers converge on it instead of
    stacking up watches. Whoever gets there first writes it; the rest write the same thing.

    Best-effort throughout. A backend that cannot hold a watch, a space with the setting off, a
    node that is simply offline — none of those are worth interrupting a call for, and the Extract
    button remains the whole feature without them.
  */
  let watched: string | null = null;

  /**
   * Set the collection, and move the watch with it.
   *
   * One function rather than an effect over the signal, because the watch has to follow every
   * assignment — adopting the call's record, resuming onto an older one, and the call ending are
   * three separate paths, and an effect that missed any of them would leave a watch pointed at a
   * call that is over. Pairing the two here makes that structural rather than remembered.
   */
  function useCollection(next: string | null): void {
    // Nothing to reset: what a call extracts is recorded beside the call, so a different
    // conversation reads its own list — or the space's, when nobody has touched it.
    setCollectionId(next);
    void syncWatch(next);
    // Repair anything a standing pass minted while nobody was here to attach it — see
    // `reconcileCollection`. Adopting a collection is the moment somebody is about to look at it.
    if (next && typeof interpretation?.reconcileCollection === 'function') {
      // The host resolves what to repair, as it does for every other pass over this collection.
      void interpretation.reconcileCollection(next).catch(() => 0);
      // And whatever a standing pass staged while nobody was here to see it. The settled-pass effect
      // covers a call being watched right now; the activity feed expires, so opening an older call
      // needs its own read.
      void loadProposals();
    }
  }

  /**
   * The class list the live watch was last registered with, joined — see {@link syncWatch}.
   *
   * Kept because the list is no longer a constant: a community adopting a model changes what this
   * space may extract, mid-call, and a watch registered before that would go on looking for the old
   * set forever. Joined rather than held as an array so the comparison is a string equality against
   * a list the host already returns in a stable order.
   */
  let watchedClasses = '';

  /**
   * Whether this community has automatic extraction on.
   *
   * Feature-tested like every other interpretation call — the host publishes a forwarding wrapper
   * that is always present, so `interpretation?.` only answers "is there a wrapper". A host that
   * predates this reads as *on*, which keeps its behaviour exactly as it was: the host's own gate
   * still refuses the registration, and the panel still reports it.
   */
  const autoEnabled = (): boolean =>
    typeof interpretation?.autoEnabled === 'function' ? interpretation.autoEnabled() : true;

  async function syncWatch(next: string | null): Promise<void> {
    // Keyed on what this call currently extracts, so a group changing it mid-call moves the watch.
    // The host owns the list; this only has to notice when the answer changed.
    const key = next
      ? targetsFor(next)
          .filter((t) => t.selected)
          .map((t) => t.entity)
          .join(',')
      : '';
    if (watched === next && watchedClasses === key) return;
    const previous = watched;
    /*
      A class-set change re-registers the *same* collection, so the teardown below has to run for it.

      Not an optimisation — a correctness requirement of the executor's own contract.
      `addAutoProcessor` writes `interpretationClasses` through the shape's `addLink` setter, so
      registering twice under one processor id **unions** the two lists rather than replacing them.
      Re-registering to narrow a set would therefore widen it, permanently, for the whole
      neighbourhood, with no way back. The counterpart is `removeAutoProcessor`
      (`coasys/ad4m` #931), and `unwatchCollection` is how this host reaches it — so remove-then-add
      is the only way to change what a running watch looks for.
    */
    const reregistering = previous !== null && previous === next;
    watched = next;
    watchedClasses = next ? key : '';

    /*
      Two independent attempts, and that separation is the whole point.

      They were one `try` block, which meant a teardown that threw took the next registration with
      it — so the first failed `unwatch` silently stopped every later call from ever being watched.
      The two have nothing to do with each other: stopping a watch on a call that ended and starting
      one on the call that just began are different operations on different collections, and either
      is worth doing when the other cannot be.

      Feature-tested per method rather than per object: the host publishes a forwarding wrapper that
      is always present, so `interpretation?.` only answers "is there a wrapper".
    */
    if (previous && typeof interpretation?.unwatchCollection === 'function') {
      try {
        await interpretation.unwatchCollection(previous);
      } catch (error) {
        // A watch left running keeps interpreting a call that is over, which costs an LLM call per
        // pass — worth a warning, and worth not letting it block what comes next.
        // On a re-registration the stakes are higher: a removal that did not happen leaves the old
        // class list to be unioned with the new one, so say which case this was.
        console.warn(
          reregistering
            ? '[transcribe] could not clear this call’s watch before re-registering it'
            : '[transcribe] could not stop the watch on the previous call',
          error,
        );
      }
    }

    if (next && !autoEnabled()) {
      // Not a failure and not a capability — a decision, stated as one. The host would refuse the
      // registration anyway; saying it here is what makes the sentence on screen the true one, and
      // what stops a pointless call to a backend that is going to throw. The unwatch above has
      // already run, so switching the setting off mid-call stops the watch rather than leaving it
      // spending an LLM call per pass for a community that just said stop.
      setWatchProblem('Automatic extraction is off for this space.');
      return;
    }

    if (next && key && typeof interpretation?.watchCollection === 'function') {
      try {
        await interpretation.watchCollection(next);
        setWatchProblem('');
        // `debug` is filtered out of most consoles by default, so this said nothing to the person
        // it was for. Watching is worth one line: it is the moment auto-extraction starts.
        console.info('[transcribe] watching collection for auto-extraction', next);
      } catch (error) {
        /*
          Recorded, not just logged.

          This swallowed the one failure worth reporting. A watch is registered without anyone
          asking for it, so when it fails there is nothing on screen that was waiting on a result —
          which meant a node whose executor could not auto-extract was indistinguishable, for three
          days, from a call in which nobody happened to say anything extractable.

          Still not thrown. The caller is a call starting, and a watch that cannot be registered is
          not a reason to interrupt one — the Extract button remains the whole feature without it.
          So it goes somewhere a surface can choose to show.
        */
        setWatchProblem(error instanceof Error ? error.message : String(error));
        console.warn('[transcribe] could not watch this call for auto-extraction', error);
      }
    } else if (next && !key) {
      // Not a failure, and worth saying in its own words: the node can watch perfectly well and
      // this space has declared nothing for it to look for. The fix is in the space's own models,
      // which is somewhere a person can go — unlike every other reason a watch does not run.
      setWatchProblem('This space has no models marked for AI extraction.');
      console.info('[transcribe] no extraction targets in this space — nothing to watch for');
    } else if (next) {
      setWatchProblem('This host cannot run a standing extraction watch.');
      console.info('[transcribe] host has no watchCollection — auto-extraction unavailable');
    }
  }

  /*
    Move the watch when what this call extracts changes, not only when the call does.

    Two things change it mid-meeting and both have to land: a community adopting a model, and the
    participants toggling one for this conversation. Until this existed the watch registered at the
    start of a call went on looking for the old set for the rest of it. `syncWatch` short-circuits
    when the answer has not changed, so this is a no-op on every other re-run.

    The list is a *group* fact rather than this agent's, and it has to be: the registration is one
    row in the shared perspective and whichever peer runs the pass spends its own LLM call writing
    into everyone's copy, so every peer must compute the same list or they would each
    remove-then-add over the other's in a loop.
  */
  effect?.(() => {
    const live = collectionId();
    if (!live) return;
    // Read inside the effect so a change to the list re-runs it.
    void targetsFor(live);
    /*
      And the space's own switch, for the same reason and a longer story.

      Nothing used to read it here. The only thing that did was a throw inside the host's
      `watchCollection`, so turning automatic extraction *on* during a call changed nothing at all:
      the watch had already failed to register, no effect depended on the setting, and the panel went
      on saying auto-extraction was unavailable until everybody left the call and rejoined. Turning
      it off mid-call was worse — the watch stayed registered and kept spending an LLM call per pass
      on a community that had just said stop.

      Read here, both directions land while the call is running, which is the only behaviour anybody
      would predict from a switch.
    */
    void autoEnabled();
    void syncWatch(live);
  });

  effect?.(() => {
    const wanted = pendingResume();
    const call = myCall();
    if (!wanted || !call) return;
    setPendingResume('');
    useCollection(wanted);
    collectionCallId = call.id;
    announce(call.id, enabled(), wanted);
  });

  effect?.(() => {
    const current = myCall()?.id ?? null;
    if (!collectionCallId || current === collectionCallId) return;
    presence?.clearActivity(TRANSCRIBE_ACTIVITY);
    useCollection(null);
    collectionCallId = null;
  });

  /**
   * A new call is a new decision.
   *
   * Keyed on the call this agent is in rather than on the record, which is what the effect above is
   * keyed on. The difference matters: the record is only created once somebody speaks, so an agent
   * who left a silent call and joined another would have carried their refusal into it — and would
   * then never be joined to anything, for a reason nothing on screen could explain.
   *
   * Leaving a call clears it too, by way of the same transition through no-call. That is right even
   * for a space-wide call, whose id is derived from the space and so is the same id every time:
   * "not now" is about the conversation happening, not about the room it happens in.
   */
  let decidedForCall: string | null = null;
  effect?.(() => {
    const current = myCall()?.id ?? null;
    if (current === decidedForCall) return;
    decidedForCall = current;
    setOptedOut(false);
    setAutoJoined(false);
    setAutoJoinFailed(false);
  });

  /**
   * Join a transcript somebody else has already started.
   *
   * The module's one piece of policy, and the reasoning is narrower than "transcription should be
   * on". Nothing here decides to record a call that nobody is recording — that is a decision about
   * the conversation, it belongs to a space's settings rather than to this effect, and this does not
   * make it. All this answers is what happens once a peer has *already* made it.
   *
   * Declining that used to be the default, by way of a prompt people did not answer. It reads like a
   * privacy decision and is not one: the call is being transcribed either way, so the only thing a
   * refusal changes is whether this agent's own words are in the record of a conversation they are
   * part of. What that produced was a transcript of a five-person meeting containing one person,
   * which is not a smaller record than the real one — it is a wrong one, and nothing about it says
   * so to whoever reads it later.
   *
   * So the default flips, and the notice changes job with it: the prompt asked, and this tells. What
   * survives is the way out — `optedOut` is checked first here, and pressing Leave or stopping
   * recording by hand sets it for the rest of the call.
   *
   * Four guards before it fires, and each of them is a case where starting would be wrong rather
   * than merely unhelpful:
   * - no dataset: there is nowhere for the words to go. Also the one that must be tested rather than
   *   left to the teardown effect below, which switches recording off whenever the space is gone:
   *   that effect and this one would take turns for as long as no dataset was bound.
   * - no audio: there is nothing to record, and `enabled` would sit true against silence.
   * - a backend that cannot transcribe: caught here because `available` is answerable synchronously.
   *   Having no *model* is not, so that one is caught in `start` — see `giveUpAutoJoin`.
   * - no peer recording: the whole condition. Being first to record is not this effect's decision.
   *
   * Deliberately not routed through `toggle`, which opens the panel: a person pressing record wants
   * to see what it produces, and a call that opens a panel on its own every time is chrome nobody
   * asked for. The notice in the call bar is what announces this instead.
   */
  effect?.(() => {
    if (enabled() || optedOut() || autoJoinFailed()) return;
    if (!dataset?.()) return;
    const call = myCall();
    if (!call) return;
    if ((audioInput?.() ?? null) === null) return;
    if (transcription?.available?.() === false) return;
    if (peerRecordersOf(call.id).length === 0) return;

    setAutoJoined(true);
    setEnabled(true);
    // Published straight away, exactly as the button press is, so peers see this agent recording
    // before it has anything to show for it.
    announce(call.id, true);
  });

  /**
   * Follow the audio.
   *
   * Keyed on the stream's presence rather than on the call's state, because this module has no view
   * of calls — it listens to whatever the host is capturing, and stops when that goes away. Which
   * also means it does the right thing if audio ever comes from somewhere other than a call.
   */
  effect?.(() => {
    const audio = audioInput?.() ?? null;
    const on = enabled();

    if (!on || !audio) {
      // Unconditional rather than gated on `context`: a start may be in flight with nothing
      // published yet, and `stop` is the only thing that cancels one. It is a no-op when idle.
      void stop(on && !audio ? 'no-audio' : 'idle');
      return;
    }

    if (!context) void start(audio);
  });

  /**
   * Losing the module ends the session.
   *
   * Same class as the call module's camera: without teardown in the contract, unregistering — or
   * re-registering, which a hot reload does — dropped the only reference to a live `AudioContext`
   * and a backend transcription stream, with nothing able to close them.
   */
  onDispose?.(() => {
    setEnabled(false);
    setAutoJoined(false);
    void stop();
  });

  /*
    Having nowhere to write ends the session — but a call is somewhere to write.

    This used to stop the moment `dataset()` went null, on the grounds that "the blocks belong to
    the space that was being spoken in, and continuing to write into a perspective the user has
    navigated away from would be wrong". The premise was true and the conclusion followed from a
    second, unstated one: that the only perspective this module could write to was the one on
    screen. It no longer is — every write now names the call's own dataset — so navigating away is
    not a reason to stop transcribing a call that is still running, any more than it is a reason to
    hang up. #161 made the call survive navigation; this is the rest of that.

    What is left is the case the effect was really for: nowhere to write *at all*. No dataset and no
    call is the boot frame, a logged-out agent, and the moment after leaving a call — all of them
    "stop", and none of them "the reader wandered off".
  */
  effect?.(() => {
    if (!dataset?.() && !myCall()) {
      setEnabled(false);
      setAutoJoined(false);
      if (context) void stop();
      // A Continue that never reached a call goes with the space it was pressed in. Held, it would
      // wait indefinitely and then attach that space's old transcript to whatever call happened to
      // start next — the request is only meaningful for the join it was pressed to accompany.
      setPendingResume('');
    }
  });

  /*
    Signing out stops the microphone.

    The same latch as the call module's, and for the same reason: `logout` locks the agent and
    returns to the sign-in screen without unregistering anything, so on desktop — which does not
    reload — an open audio graph carried on through the login screen. Watched through `selfId`
    because that is what signing out *is* from here; the latch keeps it quiet on the boot frames
    before the first login, where `selfId` is null and always was.
  */
  let hadIdentity = false;
  effect?.(() => {
    if (selfId?.()) {
      hadIdentity = true;
      return;
    }
    if (!hadIdentity) return;
    setEnabled(false);
    setAutoJoined(false);
    if (context) void stop();
    setPendingResume('');
  });

  return {
    // ── State ────────────────────────────────────────────────────────────────
    status,
    error,
    pending,
    enabled,
    open,
    /**
     * The record this call's transcript lives in, or `null` when there is not one yet.
     *
     * Published so the panel can *read the transcript* rather than a list of what this session
     * happened to write. Everything a reader wants is in that record already — every agent's
     * utterances, not only this one's, each carrying its author and the moment it was said — and it
     * outlives the session, the call and the app being closed. `spaceStore.exportCallTranscript`
     * has been reading it all along.
     *
     * Null is also the honest answer to "has anything been said": the collection is created on the
     * first utterance, so no collection means no transcript, and the panel can say so without
     * guessing. That is a better test than the one it replaced — a session-local buffer read as
     * empty after a reload, so re-opening the panel on a finished call offered to start recording
     * as though nothing had ever happened.
     */
    collectionId,

    /**
     * Where the host should put this panel — see `docks` in the module definition.
     *
     * `right` because that is the edge the module rail is on and where this has always opened; `md`
     * is an opening bid the user overrides by dragging. Never floating: a transcript you read
     * alongside the space is the case docking exists for.
     */
    dockEdge: () => (open() ? 'right' : null),
    dockSize: () => 'md',
    dockFloat: () => false,
    level,
    speaking,
    /**
     * The level and the onset threshold as CSS widths, ready to bind.
     *
     * Scaled here rather than in the schema because the alternative was a `$multiply` operator
     * existing for one caller — and the scale is a property of how loud speech is, which is knowledge
     * this file already has and a template has no business carrying.
     *
     * The threshold is published rather than restated in the panel for the same reason the whole
     * meter exists: a marker at a number that had drifted from the one the VAD compares against would
     * be confidently wrong about exactly the thing someone consults it to understand.
     */
    levelPercent: () => asPercent(level()),
    thresholdPercent: () => asPercent(VAD.speechOnsetThreshold),
    /** True only while actually producing — what the call bar's record button highlights on. */
    listening: () => status() === 'listening',

    /**
     * Recording was started by a peer's transcript rather than by this agent — see the auto-join
     * effect. What the call bar reads to announce it, since being switched on by somebody else is
     * not something an agent should have to notice for themselves.
     */
    autoJoined,
    /**
     * Whether somebody else in this call is recording and this agent is not — the offer's condition.
     *
     * Rare now, and that is the point: the ordinary path is that this agent has already been joined
     * to their transcript by the effect above. What is left is the cases where joining could not
     * happen and a person could still fix it — chiefly a node with no speech model, where the offer
     * is worth making precisely because pressing it produces the explanation that auto-join swallows.
     *
     * False once this agent has opted out, and false while already recording — there is nothing to
     * offer someone who is already in.
     */
    invited: () => {
      const call = myCall();
      if (!call || enabled() || optedOut()) return false;
      return peerRecordersOf(call.id).length > 0;
    },
    /**
     * Who to name in the notice, joined or merely offered.
     *
     * One agent rather than the list: it is a single line in a call bar, and "Ana is transcribing" is
     * the part that makes it mean something. Their DID rather than their name, because this module
     * holds no profiles — the fragment resolves it with `$agent`, the same way the calls list puts a
     * face on an utterance.
     *
     * Empty once no peer is recording any more, which the call bar tests before drawing the notice:
     * this agent may still be recording after the peer who started it stopped, and a chip reading
     * " is transcribing" is worse than no chip.
     */
    invitedBy: () => {
      const call = myCall();
      if (!call) return '';
      return peerRecordersOf(call.id)[0] ?? '';
    },
    /**
     * Everyone recording this call, this agent included — the numerator of coverage.
     *
     * Transcription is per microphone: each agent records their own and writes into the shared
     * record, so a call where two of five are recording produces a transcript of two people that
     * reads exactly like a transcript of the call. Published so the panel can say which it is, while
     * the meeting is still happening and somebody can still do something about it.
     */
    transcribers: () => {
      const call = myCall();
      return call ? recordersOf(call.id) : [];
    },
    /** Everyone in this call — the denominator. Empty outside a call, which is what hides coverage. */
    callAgents: () => {
      const call = myCall();
      return call ? agentsInCall(call.id) : [];
    },
    /** Someone in this call is not being transcribed. The gap coverage exists to report. */
    partialCoverage: () => {
      const call = myCall();
      if (!call) return false;
      const present = agentsInCall(call.id).length;
      return present > 0 && recordersOf(call.id).length < present;
    },
    /** There is audio to listen to. Without it, offering to record is offering nothing. */
    available: () => (audioInput?.() ?? null) !== null,

    // ── Extraction ───────────────────────────────────────────────────────────
    extractStatus,
    extractCount,
    extractError,
    extractingId,
    extractedId,
    extractTurns,
    /**
     * Whether there is anything to extract *from* and anything to extract *with*.
     *
     * Both halves matter and they fail differently: no collection means nothing has been said yet,
     * no port means this node has no LLM. The panel tells those apart; this is the guard that stops
     * the button being offered when neither can be fixed by pressing it.
     */
    canExtract: () =>
      Boolean(collectionId()) && (interpretation?.available() ?? false) && hasTargets(collectionId() ?? ''),
    /**
     * What this call can have extracted, and whether each is on — `{ entity, label, selected }`.
     *
     * One list rather than two, because a schema renders it as a row of toggles and cannot join two
     * lists to decide which are ticked. Empty in a space that has marked no models for extraction,
     * which is a real state worth saying rather than an error.
     */
    extractionTargets: () =>
      targetsFor(collectionId() ?? '').map((target) => ({ ...target, label: humanise(target.entity) })),
    /**
     * Include or exclude one model from what **this call** extracts, for everyone in it.
     *
     * A group decision recorded beside the call, not a private preference: the standing watch is one
     * registration the whole neighbourhood shares, so per-agent lists would have peers overwriting
     * each other's. Turning the last one off is allowed and leaves `canExtract` false, so the button
     * says what is wrong rather than running a pass that asks the model for nothing.
     *
     * Applies to what is said from here on — a watch keeps a processed-turn cursor. The one-shot
     * button carries none, so pressing Extract is how the rest of the conversation gets swept with
     * the new list.
     */
    toggleExtractionTarget: async (entity: string) => {
      const live = collectionId();
      if (!live || typeof interpretation?.setTarget !== 'function') return;
      const current = targetsFor(live).find((target) => target.entity === entity);
      try {
        await interpretation.setTarget(live, entity, !current?.selected);
      } catch (error) {
        console.warn('[transcribe] could not change what this call extracts', error);
      }
    },
    /** True when the backend could interpret but there is no transcript yet — a waiting state. */
    extractable: () => interpretation?.available() ?? false,
    /**
     * The record the call this agent is in is writing into — the id, so a list can pick it out.
     *
     * Exists so a card can ask "is this one live?" and answer it without knowing anything about
     * transcription. A calls list otherwise cannot tell the conversation happening right now from
     * one that finished last month, which is the difference that decides what its own Continue
     * button should offer — and without it, that button had to treat both the same and got the live
     * case badly wrong.
     *
     * `''` rather than `null` when there is nothing, because the only thing a template does with
     * this is `$eq` it against a record id: an empty string can never match one, where `null` and a
     * missing field are the same falsy value and would make an unrelated absent id look live.
     */
    liveCollectionId: () => collectionId() ?? '',
    /** Suggestions staged for review. Empty is the ordinary case — see `refreshProposals`. */
    proposals,
    /**
     * Why auto-extraction is not running here, or empty when it is.
     *
     * Distinct from `extractable`, which answers whether the node can interpret at all. A watch can
     * fail on a node that interprets perfectly well — the host may simply not coordinate standing
     * watches — and the two want different sentences.
     */
    watchProblem,

    /*
      ── Live extraction ──────────────────────────────────────────────────────

      The feed, its two halves, its counts and the sharing footnote used to be published here, as
      pass-throughs to the host's own interpretation state. They are `interpretationStore`'s now,
      and this module names none of them.

      Not tidying: they were a *second* publisher of one capability's state, so the same rows had
      two addresses and nothing chose which was canonical — and re-exporting another capability is
      how a module comes to depend on one. What is left below is transcription: a microphone, a
      buffer, the record this session writes into, and who else is recording.
    */

    /**
     * The band this module's chrome adds to the top of the window, for panels to keep clear of.
     *
     * The status panel is contributed into the call bar's own fixed column, *below* the bar, so what
     * a floating panel has to clear at the top is the two of them stacked — which is why the host
     * sums reservations at an edge rather than taking the largest.
     *
     * Its **collapsed** height, deliberately, and this is the one number here that is a judgement
     * rather than a measurement. The panel is a set of disclosures: open a pass and it grows, open
     * the prompt inside it and it grows again. Reporting its live height would push any panel
     * snapped below it down the screen on every one of those.
     *
     * That is no longer a compromise, because the signal cannot change size: what used to expand is
     * in the transcript panel now. So this reserves the whole of it, and a panel snapped beneath the
     * call bar never overlaps it.
     *
     * Gated on a pass actually *running* rather than on any activity existing, matching what the
     * signal shows — reserving a band for settled rows nobody can see would push panels down for a
     * strip that is not on screen.
     */
    chromeReserve: () =>
      (interpretation?.activity() ?? []).some((pass) => pass.running)
        ? { bottom: STATUS_RESERVE_PX, width: STATUS_WIDTH_PX }
        : { bottom: 0, width: 0 },

    // ── Actions ──────────────────────────────────────────────────────────────
    /**
     * Start or stop recording.
     *
     * Separate from {@link togglePanel} because they are different questions — "capture this call"
     * and "show me what was captured" — and fusing them meant the transcript vanished the moment you
     * stopped recording, which is exactly when you want to read it.
     *
     * Turning it on opens the panel too, the once: starting something invisible and saying nothing
     * about it is how a feature comes to look broken. Auto-join deliberately does not go through
     * here for that reason — a panel this agent did not ask for is chrome, not feedback.
     *
     * Either direction is a decision, and both are recorded as one. Turning it *off* is what the
     * Leave button calls, and it has to stick: without `optedOut` the auto-join effect would see an
     * agent who is simply not recording while a peer is, and switch them straight back on. Turning
     * it *on* clears the same flag, because pressing record is unambiguous about wanting to be in.
     */
    toggle: () => {
      const next = !enabled();
      setEnabled(next);
      setAutoJoined(false);
      setOptedOut(!next);
      if (next) setOpen(true);
      /*
        Publish the decision immediately, before a word has been said.

        This is the signal the other agents' prompt reads, and it is what makes coverage honest:
        announcing only at the first flush meant nobody knew who else was recording until somebody
        had already finished speaking, so "1 of 4" was shown for a call three people were
        transcribing.

        Turning it off publishes `recording: false` rather than withdrawing the activity, because the
        collection claim rides on the same entry and outlives the recording — see `announce`.
      */
      const call = myCall();
      if (call) announce(call.id, next);
    },
    /**
     * Continue an existing call's transcript rather than starting a new one.
     *
     * Takes the record's own id, not a call id: the call id a space-wide call publishes is derived
     * from the space and never changes, so it identifies the *place* calls happen rather than any
     * one of them, and could not tell this morning's meeting from this afternoon's.
     *
     * Applied when there is a call to apply it to — see the effect that consumes it.
     */
    resume: (collection: string) => setPendingResume(collection ?? ''),
    /*
      There is no `dismissInvite` any more, and nothing replaced it.

      It existed to close an offer without answering it, which was a third state worth having while
      the notice was a question. It is not one now: the notice reports that recording is already
      running, so the only answer to it is to stop — which is `toggle`, doing exactly what the record
      button beside it does. A separate action would have been the same three writes under a second
      name, and a way to hide the notice while still being recorded.
    */
    togglePanel: () => setOpen(!open()),
    closePanel: () => setOpen(false),
    /**
     * Text heard, from wherever it came.
     *
     * The store's actual input. Normally the transcription port calls it, but it is on the interface
     * rather than closed over because nothing about buffering, grouping or writing depends on the
     * words having come from Whisper — a different recogniser, or a test, feeds the same door.
     */
    receiveText: (text: string) => onText(text),
    /**
     * Read this call's transcript back and turn it into typed records.
     *
     * Flushes first, deliberately. The buffer holds up to a thousand characters or three seconds of
     * speech, and the last thing said before pressing the button is usually the reason for pressing
     * it — extracting without flushing would reliably miss it.
     *
     * One shot, driven by a press rather than a timer. A standing watch is a better *feature* and a
     * worse thing to demonstrate: a button has a visible cause and a visible result, can be pressed
     * again when a pass disappoints, and cannot quietly run up a bill while nobody is looking.
     *
     * Re-running is safe and expected. The engine dedups against instances already in the graph, so
     * a second press over the same conversation updates what it found rather than duplicating it.
     */
    extract: () => runExtraction(collectionId() ?? ''),
    /**
     * The same pass over any call's record, named by id.
     *
     * The reachable form, and the one the calls list uses. {@link extract} can only ever mean "the
     * call I am in and transcribing", because `collectionId` is cleared the moment the call ends —
     * so a finished call, or one somebody else recorded, had no way to be extracted at all. The
     * gathering was never the limit: it drills down through the collection's children and so has
     * always read every agent's utterances, not only this one's.
     */
    extractCollection: (collection: string) => runExtraction(collection),
    /** Re-read what is staged. Called after a pass; exposed so a panel can refresh on open. */
    refreshProposals: () => loadProposals(),
    /**
     * Keep a suggestion, or drop it.
     *
     * Removed from the list on success rather than by re-reading it. A re-read is a second round
     * trip during which the row a person is looking at can move, and the answer is already known:
     * a resolved overlay is gone. `false` means somebody else resolved it first — the record is
     * still out of the list either way, so it drops locally without complaint.
     */
    acceptProposal: async (id: string) => {
      if (!interpretation) return;
      await interpretation.accept(id, undefined, callTarget());
      setProposals(proposals().filter((p) => p.id !== id));
    },
    rejectProposal: async (id: string) => {
      if (!interpretation) return;
      await interpretation.reject(id, undefined, callTarget());
      setProposals(proposals().filter((p) => p.id !== id));
    },
    /** Write what has been heard so far without waiting for the buffer to fill. */
    flushNow: () => flush(),
    /** End the session now, flushing and releasing the audio graph. Exposed for tests. */
    stopNow: () => stop(),
  };
}
