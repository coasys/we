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

/**
 * The `CollectionBlock.kind` marking a collection as one call's record.
 *
 * Replaces the old `TRANSCRIPT_TAG`, which wrote `'transcript'` into `TextBlock.tag` — a field that
 * carries the *Lexical* tag (`ul`, `h1`). Two things were wrong with that beyond the collision: the
 * value was written and never read back, and the blocks stayed loose in the space, so transcripts
 * turned up in the Cards route's Text list mixed in with authored prose.
 */
export const CALL_KIND = 'call';

/** The predicate `WeNode.calls` is minted under — how a call attaches to the node it is about. */
export const CALL_PREDICATE = 'we://call';

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
 * How long a non-elected agent will hold its first utterance waiting for the creator's record.
 *
 * The election needs a way out, because the agent it picks may simply never speak: whoever is
 * elected only creates the record on *their* first flush, and a silent creator would otherwise leave
 * everyone else buffering into a call that produces nothing. After this, whoever is waiting creates
 * one itself and announces it — a duplicate is recoverable, a lost transcript is not.
 *
 * Generous relative to a presence round trip and short relative to a conversation: long enough that
 * the ordinary case (creator speaks within a few seconds) converges on one record, short enough that
 * nobody notices the delay on the one utterance it applies to.
 */
const ELECTION_WAIT_MS = 5_000;

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
  /** 0.08 in the defaults. Onset is the one that decides whether normal speech registers at all. */
  speechOnsetThreshold: 0.04,
  /** 0.05 in the defaults. Too high and a sentence is cut at its quieter moments. */
  silenceThreshold: 0.025,
  /** 12 in the defaults — ~32ms of held speech rather than ~16ms. */
  onsetHoldFrames: 6,
  /** 8000 in the defaults. Largely academic either way, since pre-roll already fills the buffer. */
  minUtteranceSamples: 2400,
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
 * the leftmost few pixels and read as permanently empty. At ×400 the onset threshold sits at 16% and
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
 * A `CollectionBlock` with `kind: '{@link CALL_KIND}'` per call, holding the utterances as `children`.
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
  const { signal, effect, audioInput, transcription, createEntity, linkEntity, dataset, presence, selfId } = deps;

  const [status, setStatus] = signal<TranscribeStatus>('idle');
  /** Whether we are recording. Independent of the panel — see the two toggles at the bottom. */
  const [enabled, setEnabled] = signal(false);
  /** Whether the transcript panel is showing. Independent of recording, so a finished session can be read. */
  const [open, setOpen] = signal(false);
  const [error, setError] = signal<string>('');
  /** What has been heard but not yet written — shown live, so the user can see it working. */
  const [pending, setPending] = signal<string>('');
  /** The most recent blocks written this session, newest first. Display only. */
  const [recent, setRecent] = signal<string[]>([]);
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
   * The call the current collection belongs to.
   *
   * The record's lifetime is the *call's*, not the recording toggle's. Tying it to the toggle meant
   * switching recording off and back on in one meeting produced two records for it — and the whole
   * point of the collection is that a call has one.
   */
  let collectionCallId: string | null = null;
  /** Agents already appended to the collection's `participants`, so each is written once. */
  let recordedParticipants = new Set<string>();
  /** Guards the create, so two flushes racing at the start cannot produce two collections. */
  let creating: Promise<string | null> | null = null;
  /**
   * When this agent first deferred to an elected creator, or null when it is not waiting.
   *
   * Held rather than derived because the wait is bounded from the moment it *began*, not from the
   * current attempt — otherwise every retry would restart the clock and a silent creator would keep
   * a speaker waiting forever.
   */
  let deferredSince: number | null = null;
  /** Peers this agent has already been offered, so a dismissed prompt stays dismissed. */
  const [dismissedInvites, setDismissedInvites] = signal<string[]>([]);

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
  function myCall(): { id: string; anchorNodeId: string | null } | null {
    const me = selfId?.() ?? null;
    if (!me || !presence) return null;
    const mine = activitiesOfType(presence.peers(), 'call').find(({ peer }) => peer.agentId === me);
    if (!mine) return null;
    const anchor = (mine.activity as { anchor?: { nodeId?: string } }).anchor;
    return { id: mine.activity.id, anchorNodeId: anchor?.nodeId ?? null };
  }

  /** A collection some other agent has already announced for this same call, if any. */
  function announcedCollection(callId: string): string | null {
    if (!presence) return null;
    const me = selfId?.() ?? null;
    const claims = activitiesOfType(presence.peers(), TRANSCRIBE_ACTIVITY)
      .filter(({ peer, activity }) => peer.agentId !== me && (activity as { id?: string }).id === callId)
      .map(({ activity }) => (activity as { collection?: string }).collection)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    // Lowest id wins, so two agents adopting in the same heartbeat still pick the same one.
    return claims.sort()[0] ?? null;
  }

  /**
   * Everyone recording this call right now, this agent included, sorted.
   *
   * The basis for two things: the prompt shown to agents who are not recording, and the election
   * that decides which of those who are gets to create the record.
   */
  function recordersOf(callId: string): string[] {
    const me = selfId?.() ?? null;
    const peers = presence
      ? activitiesOfType(presence.peers(), TRANSCRIBE_ACTIVITY)
          .filter(
            ({ peer, activity }) =>
              peer.agentId !== me &&
              (activity as { id?: string }).id === callId &&
              (activity as { recording?: boolean }).recording === true,
          )
          .map(({ peer }) => peer.agentId)
      : [];
    return (enabled() && me ? [me, ...peers] : peers).sort();
  }

  /**
   * Publish what this agent is doing about this call's transcript.
   *
   * One activity carrying two separate facts, because they have different lifetimes. `recording` is
   * live — it goes true on the button press, which is what gives peers something to react to before
   * anybody has spoken, and false again on stop. `collection` is a claim about the call: once this
   * agent knows which record the call's transcript lives in, that stays published even after
   * recording stops, so a peer who starts later still adopts it rather than creating a second one.
   *
   * Publishing `recording` at the press rather than at the first flush is also what makes the
   * election below deterministic in the ordinary case: by the time anyone speaks, everybody
   * recording already knows who else is.
   */
  function announce(callId: string, recording: boolean, collection?: string | null): void {
    const claim = collection ?? collectionId();
    presence?.setActivity({
      type: TRANSCRIBE_ACTIVITY,
      id: callId,
      recording,
      ...(claim ? { collection: claim } : {}),
    });
  }

  /**
   * Append an agent to the call's roster, once each.
   *
   * Add-one rather than rewriting the list: several agents append concurrently with no coordination,
   * and a read-modify-write would drop whoever lost the race. Recorded even for agents who are not
   * transcribing, because the point of the list is *coverage* — a transcript that can show who was
   * present but silent is worth much more than one that quietly looks complete.
   */
  async function recordParticipants(collection: string, callId: string): Promise<void> {
    if (!linkEntity || !presence) return;
    const inCall = activitiesOfType(presence.peers(), 'call')
      .filter(({ activity }) => activity.id === callId)
      .map(({ peer }) => peer.agentId);

    for (const agentId of inCall) {
      if (recordedParticipants.has(agentId)) continue;
      recordedParticipants.add(agentId);
      try {
        await linkEntity('CollectionBlock', collection, 'participants', agentId);
      } catch (cause) {
        // Let it be retried on the next flush rather than losing the agent from the roster forever.
        recordedParticipants.delete(agentId);
        console.error('transcribe: could not record participant', cause);
      }
    }
  }

  /**
   * The collection to write into — adopted, or created if this agent is first to speak.
   *
   * Serialised through `creating` so two flushes arriving together cannot each create one. Returns
   * null when there is nothing to attach to, in which case the caller writes nothing: an utterance
   * with nowhere to belong is better dropped than scattered loose into the space.
   */
  async function ensureCollection(): Promise<CollectionSlot> {
    const call = myCall();
    if (!call || !createEntity) return { state: 'nowhere' };

    const existing = collectionId();
    if (existing && collectionCallId === call.id) return { state: 'ready', id: existing };
    if (creating) {
      const id = await creating;
      return id ? { state: 'ready', id } : { state: 'nowhere' };
    }

    /*
      Whoever is recording and sorts first creates the record; everyone else waits for them to
      announce it. Deterministic, because `recording` is published at the button press rather than at
      the first flush — so by the time anybody speaks, every recorder already knows who else is
      recording, and they all sort the same list.

      It replaces "whoever writes first creates", whose race was not the heartbeat the old comment
      described but the whole span before anyone had finished an utterance. Two agents starting
      together and then speaking together — the ordinary way a call begins — landed in it every time,
      and produced two records for one meeting.

      Losing the election is not refusing to write, only refusing to *create*: the caller re-buffers
      and tries again, and `ELECTION_WAIT_MS` is the point at which it gives up waiting for a creator
      who may never speak. A partition can still produce two records, and nothing here can prevent
      that — two agents who cannot see each other cannot agree on anything.
    */
    if (!announcedCollection(call.id)) {
      const me = selfId?.() ?? null;
      const recorders = recordersOf(call.id);
      const elected = recorders[0] ?? me;
      if (me && elected !== me) {
        if (deferredSince === null) deferredSince = Date.now();
        if (Date.now() - deferredSince < ELECTION_WAIT_MS) return { state: 'waiting' };
      }
    }
    deferredSince = null;

    creating = (async () => {
      // A different call from the one the current record belongs to — start clean rather than
      // appending this meeting's words to the last one's transcript.
      if (collectionCallId !== call.id) recordedParticipants = new Set();

      const adopted = announcedCollection(call.id);
      if (adopted) {
        setCollectionId(adopted);
        collectionCallId = call.id;
        announce(call.id, enabled(), adopted);
        return adopted;
      }

      // Parented straight onto the node the call is about, so `WeNode.calls` is written in the same
      // operation that creates the record — no window where a crash leaves the call orphaned. A
      // space-wide call has no anchor and simply lives in the space, found by `kind`.
      const created = await createEntity(
        'CollectionBlock',
        { kind: CALL_KIND, type: 'collection' },
        call.anchorNodeId ? { parent: { id: call.anchorNodeId, predicate: CALL_PREDICATE } } : undefined,
      );
      if (created) {
        setCollectionId(created);
        collectionCallId = call.id;
        announce(call.id, enabled(), created);
      }
      return created;
    })();

    try {
      const id = await creating;
      return id ? { state: 'ready', id } : { state: 'nowhere' };
    } finally {
      creating = null;
    }
  }

  /** Write what has accumulated, if anything. Safe to call at any point, including teardown. */
  async function flush(): Promise<void> {
    clearTimer();
    const text = buffer.trim();
    buffer = '';
    setPending('');
    if (!text) return;

    try {
      const slot = await ensureCollection();

      // Lost the election and the creator has not announced yet. Put the words back and come round
      // again — dropping them would lose the opening line of every call for everyone but one agent,
      // which is precisely the part of a conversation worth having.
      if (slot.state === 'waiting') {
        buffer = buffer ? `${text} ${buffer}` : text;
        setPending(buffer);
        clearTimer();
        flushTimer = setTimeout(() => void flush(), FLUSH_AFTER_MS);
        return;
      }

      if (slot.state === 'nowhere') {
        console.warn('transcribe: no call to attach this utterance to; not written');
        return;
      }

      await createEntity?.('TextBlock', { text }, { parent: { id: slot.id, predicate: CHILDREN_PREDICATE } });
      // After the write, not before. `recent` says these are the blocks written this session, and a
      // deferred utterance passes through here more than once — listed on the way in, it would show
      // up once per attempt.
      setRecent([text, ...recent()].slice(0, 20));
      const call = myCall();
      if (call) await recordParticipants(slot.id, call.id);
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
   * Build the session into locals, and publish it only once it is whole.
   *
   * Nothing is assigned to the module-level handles until every await has resolved and the run is
   * confirmed to still be the current one. That is what makes a cancelled start leave nothing
   * behind: a stale run closes what it built and returns, and `stop` never has to reason about a
   * half-constructed pipeline.
   */
  async function start(audio: MediaStream): Promise<void> {
    if (!transcription) {
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
    generation++;

    // Flush before teardown: whatever was said before hanging up is still worth keeping.
    await flush();

    node?.port.close();
    node?.disconnect();
    source?.disconnect();
    await context?.close().catch(() => {});
    await stream?.close().catch(() => {});
    node = null;
    source = null;
    context = null;
    stream = null;
    setLevel(0);
    setSpeaking(false);

    // The record is deliberately *not* released here. Stopping the recording is not leaving the
    // call, and someone who switches it off and on again is still in the same meeting — dropping the
    // id would give that meeting two transcripts. The claim stays published for the same reason: a
    // peer who starts recording later must adopt this record rather than create a second one.
    //
    // Releasing is the call ending's business, and the effect below owns it. `recent` stays either
    // way, so a session can be read after it stops.
    if (status() !== 'error') setStatus(resting);
  }

  /**
   * Let go of the record when the call it belongs to is over.
   *
   * Keyed on the call rather than on recording, which is the distinction `stop` deliberately does not
   * make: leaving is what ends a transcript, and withdrawing the claim as we go stops a peer still in
   * the space from adopting a collection nobody is writing to.
   */
  effect?.(() => {
    const current = myCall()?.id ?? null;
    if (!collectionCallId || current === collectionCallId) return;
    presence?.clearActivity(TRANSCRIBE_ACTIVITY);
    setCollectionId(null);
    collectionCallId = null;
    recordedParticipants = new Set();
    // Both belong to the call that just ended: an election deferred in it must not bound the wait in
    // the next one, and a prompt dismissed in it should not silence the next call's.
    deferredSince = null;
    setDismissedInvites([]);
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

  // Leaving the space ends the session — the blocks belong to the space that was being spoken in,
  // and continuing to write into a perspective the user has navigated away from would be wrong.
  effect?.(() => {
    if (!dataset?.()) {
      setEnabled(false);
      if (context) void stop();
    }
  });

  return {
    // ── State ────────────────────────────────────────────────────────────────
    status,
    error,
    pending,
    recent,
    enabled,
    open,

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
     * Whether somebody else in this call is recording and this agent is not — the prompt's condition.
     *
     * A prompt rather than starting on their behalf, and that is the whole point of it. Transcription
     * turns this agent's microphone into durable text in a space other people read; starting that
     * because a third party pressed a button somewhere else takes a decision that is theirs to make.
     * The module declares a `microphone` capability for the same reason.
     *
     * False once dismissed, and false while already recording — there is nothing to offer someone who
     * has already said yes.
     */
    invited: () => {
      const call = myCall();
      if (!call || enabled()) return false;
      const dismissed = new Set(dismissedInvites());
      return recordersOf(call.id).some((did) => !dismissed.has(did));
    },
    /**
     * Who to name in that prompt.
     *
     * One agent rather than the list: the prompt is a single line in a call bar, and "Ana started
     * transcribing" is the part that makes it act-on-able. Their DID rather than their name, because
     * this module holds no profiles — the fragment resolves it with `$agent`, the same way the calls
     * list puts a face on an utterance.
     */
    invitedBy: () => {
      const call = myCall();
      if (!call) return '';
      const dismissed = new Set(dismissedInvites());
      return recordersOf(call.id).find((did) => !dismissed.has(did)) ?? '';
    },
    /** Everyone recording this call, this agent included — coverage, for the panel to show. */
    transcribers: () => {
      const call = myCall();
      return call ? recordersOf(call.id) : [];
    },
    /** There is audio to listen to. Without it, offering to record is offering nothing. */
    available: () => (audioInput?.() ?? null) !== null,

    // ── Actions ──────────────────────────────────────────────────────────────
    /**
     * Start or stop recording.
     *
     * Separate from {@link togglePanel} because they are different questions — "capture this call"
     * and "show me what was captured" — and fusing them meant the transcript vanished the moment you
     * stopped recording, which is exactly when you want to read it.
     *
     * Turning it on opens the panel too, the once: starting something invisible and saying nothing
     * about it is how a feature comes to look broken.
     */
    toggle: () => {
      const next = !enabled();
      setEnabled(next);
      if (next) setOpen(true);
      /*
        Publish the decision immediately, before a word has been said.

        This is the signal the other agents' prompt reads, and it is also what makes the election
        deterministic: announcing only at the first flush meant nobody knew who else was recording
        until somebody had already finished speaking, by which point the record they were racing to
        create had usually been created twice.

        Turning it off publishes `recording: false` rather than withdrawing the activity, because the
        collection claim rides on the same entry and outlives the recording — see `announce`.
      */
      const call = myCall();
      if (call) announce(call.id, next);
    },
    /**
     * Stop offering to join the transcript this peer started.
     *
     * Per peer rather than per call: someone else starting later is a new thing to be told about,
     * and a single dismissal should not silence the rest of the call.
     */
    dismissInvite: () => {
      const call = myCall();
      if (!call) return;
      setDismissedInvites([...new Set([...dismissedInvites(), ...recordersOf(call.id)])]);
    },
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
    /** Write what has been heard so far without waiting for the buffer to fill. */
    flushNow: () => flush(),
  };
}
