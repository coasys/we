import { activitiesOfType } from '@we/backend-shared';
import type { ModuleStoreDeps, RecordsKernel } from '@we/module-shared';
import { namespace } from '@we/schema-shared';

import { WORKLET_NAME, WORKLET_SOURCE } from './workletSource';

/**
 * How eagerly the backend closes an utterance.
 *
 * This is the transcript of record, so it would rather wait and be right. On AD4M it is currently
 * inert — the executor applies its own fixed voice-activity gate and ignores what it is sent — and
 * the segmenting that actually decides an utterance is the worklet's, tuned by `VAD` below. Kept so
 * the intent survives into a backend that honours it.
 *
 * There is no second, faster preview stream beside this one, and that is a decision rather than a
 * gap. Flux runs one, but since utterances are cut on the client both streams receive the same
 * finished utterance, so a preview arrives only a moment before the real line — at the cost of a
 * second model competing for the same CPU and no way to match a preview to the line that replaces
 * it. `transcribing` says "heard, working on it" instead, for nothing.
 */
const TUNING = { startThreshold: 0.8 };

/** How often the model list is re-read while a download runs, or while recording waits for one. */
const MODEL_POLL_MS = 3_000;

/**
 * How long an utterance may be in the backend before `transcribing` stops claiming it is coming.
 *
 * Not every utterance produces text: the backend drops one its own voice gate rejects, and Whisper
 * returns nothing for a cough. Nothing reports those, so a count of utterances awaiting text never
 * reaches zero on its own. A grace beyond the utterance's own length — a model on a CPU takes
 * roughly as long as the audio — is what ends the claim.
 */
const TRANSCRIBING_GRACE_MS = 5_000;

/**
 * How long to wait before each attempt to re-establish a dropped stream.
 *
 * A single retry was the whole recovery once, and it is not enough against a node reached over the
 * network: every utterance is an HTTP request carrying up to a minute of audio, so a dropped
 * connection, a proxy hiccup or a node with its hands full is ordinary rather than exceptional. One
 * of those ended recording for the rest of the call, and the person it happened to had no way to
 * know except to notice the transcript had stopped — the panel is rarely on screen, and the record
 * button stayed lit.
 *
 * Six attempts across roughly a minute, starting immediately because the common case is a blip that
 * is already over. The backoff is what keeps a node that is genuinely struggling from being asked
 * once a second by every member of the call at once.
 */
const RECONNECT_DELAYS_MS = [0, 1_000, 3_000, 8_000, 15_000, 30_000];

/**
 * How much unsent speech is kept while the stream is down — 60 s, at the 16 kHz the worklet sends.
 *
 * Somebody talking through a reconnection is the case this exists for: their words are held and land
 * in the transcript once it is back, in the order they were said. Bounded because a reconnection
 * that never succeeds must not grow without limit, and the *oldest* is dropped first — the longer an
 * outage runs, the more the recent speech is the part still worth having.
 */
const MAX_HELD_SAMPLES = 16_000 * 60;

/**
 * How many freshly-opened streams may refuse the same utterance before it is dropped.
 *
 * Not every failure is about the stream. An utterance too large for whatever proxy fronts the node
 * is refused on its own merits, and resending it is what the first version of this did — for ever,
 * until it gave up and stopped the session. One bad utterance must cost one utterance.
 *
 * Counted only against a stream that was *just opened successfully*, so this cannot fire while the
 * node is simply unreachable: an open that fails never reaches the send, and the count never moves.
 * Two, because one refusal is not evidence and the second one is.
 */
const REFUSALS_BEFORE_DROPPING = 2;

/** A download size as a person reads it — "970 MB", "1.5 GB". */
function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(10, Math.round(bytes / 1e7) * 10)} MB`;
}

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
 * How many lines a transcript opens with.
 *
 * Small, and smaller than it was. The figure used to be the same as the growth step below, and was
 * argued for on the grounds that a reader scrolling back a little should never meet a button —
 * which stopped being a reason the moment there was no button: earlier lines now load as the reader
 * reaches them. What is left is the cost of opening, and that is paid by everybody on every call.
 *
 * Two hundred rows arriving at once is also a hundred-odd custom elements laying out in one pass,
 * which is what made the panel open a couple of lines short of the bottom — see `SETTLE_MS` in
 * `we-scroll-area`. That has its own fix, and this makes the case rarer as well as cheaper.
 */
const TRANSCRIPT_FIRST_PAGE = 50;

/**
 * How many more lines each load adds.
 *
 * Deliberately larger than the first page, and the asymmetry is the point. The window grows by
 * re-running the query at a bigger `limit` rather than by fetching a page and appending — the
 * backend has no cursor and a module's data surface is write-only, so there is nowhere to
 * accumulate pages. That makes reading backwards quadratic in the number of loads: at fifty a step,
 * reaching a thousand lines fetches ten and a half thousand rows across twenty re-renders; at two
 * hundred it fetches three thousand across five.
 *
 * So the two numbers answer different questions. The first page is how much opening costs, and
 * wants to be small. The step is how much scrolling back costs, and wants to be large.
 */
const TRANSCRIPT_PAGE = 200;

/** The predicate `CollectionBlock.children` is minted under — how an utterance attaches to its call. */
export const CHILDREN_PREDICATE = 'we://children';

/**
 * How a line in a transcript came to be — the three values of `TextBlock.source`.
 *
 * Named here rather than written as literals because three surfaces have to agree on them: the
 * transcriber writes one, the panel draws by them, and an edit moves between them. See the field's
 * own note for why a transcript that cannot tell speech from typing is making a claim.
 */
export const SPOKEN = 'spoken';
export const TYPED = 'typed';
export const CORRECTED = 'corrected';

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

/** One proposed value, as a row a schema can render and an edit control can write back to. */
export interface ProposalField {
  /** The model's own property name — what an edit writes to, so it must not be prettified. */
  name: string;
  /** The name for a person to read — `dueDate` as "Due date". Derived, since a proposal carries no labels. */
  label: string;
  /** Ready to print: stringified and bounded. See {@link MAX_SUMMARY_VALUE}. */
  value: string;
}

/**
 * One staged suggestion, in the pieces a card is built from.
 *
 * ## Why this is a list and not the value map
 *
 * A schema `$each` cannot iterate an object's entries, so a map of proposed values is unrenderable
 * however well-shaped it is. The list is ordered here rather than in the panel because "lead with
 * what identifies it" is knowledge about models, not about layout — see {@link SUMMARY_FIELDS}.
 *
 * ## Why `summary` survives alongside it
 *
 * It is the degraded rendering, not a duplicate. A card draws a title, a badge and a description by
 * asking `recordStore.displays[entity]` which property plays each role — and {@link entity} is
 * absent whenever the backend could not classify the base, which is every proposal on an executor
 * predating `subjectClassesOf`. One flat line is a worse card and a much better outcome than a blank
 * one, so the panel falls back to it rather than refusing to draw a decision somebody has to make.
 */
export interface ProposalView {
  id: string;
  /** `create` proposed a whole record; `update` proposed changes to one that exists. */
  kind: string;
  /**
   * Which model this is a suggestion of, or `''` when the backend could not say.
   *
   * Empty rather than absent so a schema can test it — an expression reads a missing property as
   * undefined and a card would branch correctly either way, but every other string on this view is
   * always present and one that sometimes is not invites a template to read it without checking.
   */
  entity: string;
  /** The proposed values, identifying field first. */
  fields: ProposalField[];
  /** All of it on one line, for a card with no model to draw from. */
  summary: string;
}

/**
 * Field names worth leading with, most identifying first. Anything else follows in map order.
 *
 * `label` is here because two models genuinely call their title that — `EmbedBlock` and
 * `Relationship` — and a proposal of one used to lead with whatever came first in the map instead.
 * It read as a bug in the ordering and was one in the *naming*: the backend resolved every
 * `we://title` to `label` regardless of model, so a task's title never matched `title` either. That
 * is fixed where it arose (see `NameTables` in `interpretationAdapter.ts`); this entry is what the
 * list should always have said, for the two models where `label` is the honest word.
 */
const SUMMARY_FIELDS = ['title', 'label', 'text', 'name', 'startDate', 'dueDate', 'assignee', 'location'];

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

const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/** The proposed values as rows, identifying field first — the ordering `summarise` then prints in. */
function fieldsOf(values: Record<string, unknown>): ProposalField[] {
  const named = SUMMARY_FIELDS.filter((field) => values[field] !== undefined && values[field] !== '');
  const rest = Object.keys(values).filter((field) => !SUMMARY_FIELDS.includes(field));
  return [...named, ...rest].map((name) => ({
    name,
    label: labelOf(name),
    value: cut(String(values[name]), MAX_SUMMARY_VALUE),
  }));
}

/** `dueDate` → "Due date". A proposal names fields as the model does; a change line is read by a person. */
function labelOf(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

function summarise(fields: ProposalField[]): string {
  return cut(fields.map((f) => `${cut(f.name, 40)}: ${f.value}`).join(' · '), MAX_SUMMARY_LENGTH);
}

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

/**
 * What the session is doing. `downloading` is recording that wants to run and is waiting for a
 * model's weights to arrive — distinct from `starting`, which is seconds, where this can be minutes.
 */
export type TranscribeStatus =
  'idle' | 'no-backend' | 'no-model' | 'no-audio' | 'downloading' | 'starting' | 'listening' | 'error';

/**
 * What is known about the models this node has, independent of whether anything is recording.
 *
 * Separate from the status because the panel needs it when nothing is: an auto-join that found no
 * model gives up silently and lands on `idle`, and a panel opened outside a call has never asked —
 * yet both are exactly where somebody would want the one-click install.
 */
type ModelState = 'unknown' | 'none' | 'downloading' | 'ready';

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
 * The call's own microphone, borrowed through the `media` kernel (`deps.kernels.media.input`) rather
 * than opened here. That is what makes muting the call stop the transcript: a muted track is
 * disabled rather than removed, so the worklet receives silence, the VAD never fires, and nothing is
 * produced. A second `getUserMedia` would have kept listening through the mute.
 *
 * ## What is public
 *
 * Members are private to this module's own chrome unless marked with `deps.state` or `deps.action`
 * — see `store.ts` in `@we/module-shared`. Everything a template can reasonably want is marked: the
 * transcript's live state, the recording controls, the extraction surface and the review actions.
 * What stays unmarked is plumbing a test or the port feeds (`receiveText`, `markUtteranceSent`,
 * `stopNow`), which no template has any business calling.
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
  const { signal, effect, settings, dataset, selfId, notify, onDispose, state, action } = deps;
  /*
    The kernels this module declared in `manifest.requires.kernels`, and no others. Each may still be
    absent — a host that implements none of one refuses the module at registration, but a test, or a
    host between boot and bind, hands over a partial bag — so everything below degrades rather than
    throws when one is missing, exactly as it did when these were optional fields on the bag.
  */
  const { records, presence, media, transcription, interpretation } = deps.kernels;
  /*
    The three record writes, as the local names the rest of this file was written against.

    Wrapped rather than detached: a kernel is an interface of function-typed members, and nothing
    says the host's implementation does not read `this`. Feature-tested per member rather than per
    kernel, the way every `interpretation` call below is — a host lending a records kernel with no
    `update` is a host with no record-update surface, and `canEditProposals` and `editUtterance`
    have to read it that way rather than throw. `undefined` where a member is missing, so every
    `createEntity?.(…)` below keeps its meaning.
  */
  const createEntity: RecordsKernel['create'] | undefined =
    typeof records?.create === 'function' ? (...args) => records.create(...args) : undefined;
  const linkEntity: RecordsKernel['link'] | undefined =
    typeof records?.link === 'function' ? (...args) => records.link(...args) : undefined;
  const updateEntity: RecordsKernel['update'] | undefined =
    typeof records?.update === 'function' ? (...args) => records.update(...args) : undefined;
  const findEntity: RecordsKernel['find'] | undefined =
    typeof records?.find === 'function' ? (...args) => records.find(...args) : undefined;
  /** What some module is capturing right now, or `null` — the call's microphone, in practice. */
  const audioInput = typeof media?.input === 'function' ? () => media.input() : undefined;

  const [status, setStatus] = signal<TranscribeStatus>('idle');
  /** Whether we are recording. Independent of the panel — see the two toggles at the bottom. */
  const [enabled, setEnabled] = signal(false);
  /** Whether the transcript panel is showing. Independent of recording, so a finished session can be read. */
  const [open, setOpen] = signal(false);
  /**
   * Whether the extraction panel is showing — its own flag, because it is its own surface.
   *
   * Separate from `open` for the reason the two panels are separate: a transcript is read while
   * somebody talks and extraction is read afterwards, so wanting one on screen says nothing about
   * wanting the other. Sharing a flag would mean opening either opened both, which is the bundled
   * panel again with two titlebars.
   */
  const [extractionOpen, setExtractionOpen] = signal(false);

  /*
    How much of the transcript is loaded, and which end it is anchored to.

    A transcript is two documents with opposite anchors. **Live**, it is a tail: what matters is the
    last thing said, it grows at the bottom, and reading back a little is an excursion. **Afterwards**
    it is a document: it has a beginning, and somebody reads it forwards. One window cannot serve both
    — anchored to the end you cannot reach the start without loading everything in between, and
    anchored to the start you are not following the call.

    So the window names its anchor, and the two modes are the same query with the order flipped:
    `desc` + reverse for the tail, `asc` for the document. Either way `shown` bounds it, which is the
    whole point — before this the query had no limit at all and every utterance re-fetched, re-hydrated
    and re-fingerprinted the entire transcript, so the cost of saying one more word grew with
    everything already said.

    In the store rather than `$localState` because `transcriptLines` is placed as a part on its own,
    while `pin` lives on the scroll area *around* it — two nodes that have to agree, with no common
    local scope. See `transcriptFeed`.
  */
  const [transcriptShown, setTranscriptShown] = signal(TRANSCRIPT_FIRST_PAGE);
  const [transcriptFromStart, setTranscriptFromStart] = signal(false);

  /*
    A different conversation is a different document, so the window starts again: one page, anchored
    to the live end.

    Without this it is a high-water mark across calls — read six hundred lines of one conversation
    and the next opens by loading six hundred of its own, which is the cost the window exists to
    bound, arriving one call late. Compared rather than written blind so this does not fight a reader
    who has just pressed for more in the call they are already in.
  */
  let windowedCall: string | null = null;
  effect?.(() => {
    const record = deps.callOnScreen?.() ?? null;
    if (record === windowedCall) return;
    windowedCall = record;
    setTranscriptShown(TRANSCRIPT_FIRST_PAGE);
    setTranscriptFromStart(false);
  });

  const [error, setError] = signal<string>('');
  /** What has been heard but not yet written — shown live, so the user can see it working. */
  const [pending, setPending] = signal<string>('');
  /**
   * Words that have left the buffer and are being written, held until the write lands.
   *
   * The preview used to clear the instant a flush began, and the row it becomes does not exist until
   * a create has gone to the backend and come back through the feed's subscription. Between those
   * two moments the transcript said nothing at all — a sentence vanishing and reappearing somewhere
   * else, which reads as a glitch rather than as saving.
   *
   * Separate from the buffer rather than a delayed clear of it, because speech does not stop for a
   * write: anything said during one accumulates in `buffer` as usual, and the two are shown in
   * whichever order they will be written.
   */
  const [settling, setSettling] = signal<string>('');
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
  /**
   * Staged suggestions, per conversation — `''` holding the whole dataset's, for outside a call.
   *
   * ## Why this is keyed, and why it fetches on being read
   *
   * It was one flat list loaded from two places: a pass settling in the activity feed, and the
   * transcriber adopting a call's record. Both are *events during a session*, and neither happens on
   * a fresh boot — the activity feed is a live subscription that starts empty, and a collection is
   * adopted only when this agent is about to write into it. So reopening a call after a restart
   * showed no suggestions at all: the records were on the board looking settled, and the review list
   * was empty. They had not been accepted; nothing had asked for them.
   *
   * Keyed, because the surface reading it is about whichever call is *on screen* — the live one
   * usually, and a past one whenever somebody opened it from a link — and there is no way for an
   * expression to pass an argument to a store member. The same reason `extractionFor` is keyed, and
   * the same `namespace` mechanism.
   *
   * Fetched on first read of a key rather than from an effect, because only the reader knows which
   * call it is asking about: a past call named in the address is not a fact the store has any other
   * way to learn. `$agent` demand-fetches a profile from a DID for exactly this reason.
   */
  const [proposalsByCall, setProposalsByCall] = signal<Record<string, ProposalView[]>>({});
  /** Keys already asked about, so a read in a render loop is one fetch and not one per frame. */
  const proposalsRequested = new Set<string>();
  /**
   * Which suggestion is being edited, and what has been typed into it.
   *
   * ## Why the draft lives here and not in the panel's `$localState`
   *
   * The fields come from the model, so there is no set of names a schema could declare. A community
   * defines a shape in the morning and a pass proposes one that afternoon; `$localState` names its
   * fields when the template is *written*, which is strictly too early. This is the same reason
   * `recordStore` holds its draft in a store and writes it with `setRecordField(name, value)` — one
   * action serving every control is the only shape that works when the controls come from data.
   *
   * One draft rather than one per row: only one card is open at a time, and a map keyed by id would
   * make "discard what was typed" ambiguous between closing a card and resolving it.
   */
  const [editingProposal, setEditingProposal] = signal('');
  const [proposalDraft, setProposalDraft] = signal<Record<string, string>>({});
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
   * Recording is running because the call is, not because this agent said so.
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
  /** See {@link ModelState}. Updated by every read of the model list, whoever made it. */
  const [modelState, setModelState] = signal<ModelState>('unknown');
  /** The most advanced download's progress, 0–100, or null when the backend reports none. */
  const [modelProgress, setModelProgress] = signal<number | null>(null);
  /** A one-click install is registering its model — seconds, before the download itself begins. */
  const [installingModel, setInstallingModel] = signal(false);
  const [installError, setInstallError] = signal('');
  /**
   * Utterances handed to the backend that have not produced text yet, as far as anyone can tell.
   *
   * What `transcribing` reads. A count rather than a flag because speech does not wait: somebody who
   * says two things in a row has two in flight, and the first line landing does not mean the second
   * has. Approximate by necessity — see {@link TRANSCRIBING_GRACE_MS}.
   */
  const [inFlight, setInFlight] = signal(0);
  /**
   * The stream is gone and a new one is being opened in its place.
   *
   * Public, and said out loud in the panel, because this is the one state where the microphone is
   * live and the words are going nowhere yet. Silence here is what made a dropped stream read as a
   * working session that had stopped hearing anything.
   */
  const [reconnecting, setReconnecting] = signal(false);
  let inFlightTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlightDeadline = 0;
  let modelPoll: ReturnType<typeof setTimeout> | null = null;

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
    continued: boolean;
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
      // Published by the call module when the call was picked back up on a record that already
      // existed — see `continuedRecord` there. What lets the record be adopted before anybody speaks.
      continued: (mine.activity as { continued?: boolean }).continued === true,
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
   * remains because a continued call's record is adopted before anybody has spoken into it, and a
   * peer has to be able to see that somebody is writing into an old transcript.
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
  function closeProposalEdit(): void {
    setEditingProposal('');
    setProposalDraft({});
  }

  /**
   * What the reviewer actually changed, or null if nothing.
   *
   * Only the differences, so accepting an untouched card writes nothing — the draft is seeded from
   * the proposal, so sending it wholesale would rewrite every field with the value it already had.
   * That would be invisible on screen and wrong underneath: each write is a link the whole
   * neighbourhood syncs, and a record would look edited by whoever merely opened it.
   *
   * Compared against the *displayed* value, which is truncated (see {@link MAX_SUMMARY_VALUE}). A
   * value long enough to have been cut therefore reads as changed the moment the card is opened and
   * accepted — the ellipsis would be committed as the real value. So a field is only counted when
   * what was typed differs from what was shown **and** what was shown is not itself an elision.
   */
  function changedFields(id: string): Record<string, string> | null {
    const proposal = allProposals().find((p) => p.id === id);
    if (!proposal) return null;
    const draft = proposalDraft();
    const changed: Record<string, string> = {};
    for (const field of proposal.fields) {
      const typed = draft[field.name];
      if (typed === undefined || typed === field.value) continue;
      if (field.value.endsWith('…') && typed === field.value.slice(0, -1)) continue;
      changed[field.name] = typed;
    }
    return Object.keys(changed).length ? changed : null;
  }

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
   * Show the extraction panel when a pass starts — anybody's, not only this agent's.
   *
   * The same rule recording follows, and the reason the one-line signal in the call bar can go:
   * starting something invisible and saying nothing about it is how a feature comes to look broken.
   * A pass takes minutes and spends somebody's tokens, and most of them are started by a standing
   * watch rather than by a press — so the four people in five who did not start it are exactly the
   * ones who need telling.
   *
   * Once, on the edge. Re-opening a panel somebody has deliberately closed, every time a pass
   * settles and another begins, is chrome arguing with its reader.
   */
  let sawRunning = false;
  effect?.(() => {
    const running = (interpretation?.activity?.() ?? []).some((row) => row.running);
    if (running && !sawRunning) setExtractionOpen(true);
    sawRunning = running;
  });

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
    /*
      `targetCollection`, not `collectionId`, when the caller names nothing.

      `collectionId` is what this agent is *writing into* and stays null until somebody speaks, so a
      refresh during a call that had not been talked in yet fell through to the unscoped key — and
      asked about the whole space. `targetCollection` falls back to the call's own record, which
      exists from its first second and is the id every surface here already keys on.
    */
    const key = collection ?? targetCollection();
    /*
      No call, nothing to review.

      An empty key used to ask the backend for everything staged in the dataset. The port offers
      that, and it is the honest answer for a surface that is genuinely about a dataset — but there
      is no such surface here, and what it produced was a panel outside a call listing suggestions
      from every conversation the space has ever had, with no way to tell which was which. It is
      also the exact hazard `loadProposals` was narrowed to avoid: an unscoped read hands a stale
      proposal to a reader who has no way to act on it from where they are.
    */
    if (!key) return;
    proposalsRequested.add(key);
    try {
      // The call's space, for the same reason the writes use it: a call outlives the space on
      // screen, so "proposals here" was answering about wherever the reader had wandered to. The
      // collection narrows it from that space to one conversation.
      const staged = await interpretation.proposals(callTarget(), key);
      const rows = staged.map((p) => {
        const fields = fieldsOf(p.values);
        return { id: p.id, kind: p.kind, entity: p.entity ?? '', fields, summary: summarise(fields) };
      });
      setProposalsByCall({ ...proposalsByCall(), [key]: rows });
    } catch {
      /*
        Left as it was rather than emptied.

        This runs after a pass that already succeeded, and on a demand read that may be one of
        several. Clearing on a failed fetch would take a list somebody is part-way through reviewing
        off the screen because an unrelated read timed out — and the next settled pass, or the next
        time the key is asked about, refills it.
      */
      if (!(key in proposalsByCall())) setProposalsByCall({ ...proposalsByCall(), [key]: [] });
    }
  }

  /**
   * The suggestions staged on one conversation, fetching them the first time anybody asks.
   *
   * The read is what triggers the load, so a panel that opens on a call nobody has extracted this
   * session still fills — which is the whole point, and what a restart used to lose.
   */
  function proposalsFor(collection: string): ProposalView[] {
    const key = collection ?? '';
    // No call named, nothing to review — and nothing fetched. See `loadProposals`.
    if (!key) return [];
    if (!proposalsRequested.has(key)) void loadProposals(key);
    return proposalsByCall()[key] ?? [];
  }

  /**
   * Every id still awaiting a decision, across every call asked about so far.
   *
   * ## Why a card's marker is not keyed and the review list is
   *
   * They answer different questions. "Which decisions am I being asked to make" is about a
   * conversation, and belongs to whichever call is on screen. "Has anybody agreed to this record
   * yet" is about the **record**, and is true or false wherever it is drawn.
   *
   * Keying the marker made switching calls flash: the outgoing call's cards stay on the board for
   * the moment its replacement is being queried, and against the incoming call's list — empty, since
   * nothing has fetched it yet — every one of them rendered as settled. They were never settled;
   * they were being asked the wrong question. Answered from the union they stay marked until they
   * leave the board, which is what somebody watching them expects.
   *
   * Only ever loses an entry when it is genuinely resolved, so nothing here can un-mark a card that
   * is still waiting.
   */
  const pendingIds = (): string[] => allProposals().map((p) => p.id);

  /**
   * Records a pass **made** that nobody has kept yet — `create` proposals, by id.
   *
   * The narrower half of {@link pendingIds}, and the one that means "not agreed". The record is in the
   * graph from the moment the pass ran, so it is drawn wherever records of its kind are; whether it
   * should look provisional, or be shown at all, is this question.
   */
  const unconfirmedIds = (): string[] =>
    allProposals()
      .filter((p) => p.kind === 'create')
      .map((p) => p.id);

  /**
   * Agreed records a pass has **suggested changing** — `update` proposals, by id.
   *
   * The other half, and never provisional: the record is somebody's, the executor would not overwrite
   * what a person owns, so it staged the change beside it instead. A surface marks these rather than
   * fading them, and a "hide suggestions" never hides one.
   */
  const changedIds = (): string[] =>
    allProposals()
      .filter((p) => p.kind === 'update')
      .map((p) => p.id);

  /**
   * Take one resolved field off a suggestion, and the suggestion with it once nothing is left.
   *
   * Locally rather than by re-reading, for `forgetProposal`'s reason. Fields a surface never showed
   * — a proposed value equal to what the record already holds — stay on the row, so the record keeps
   * its marker until the whole suggestion is applied or dismissed; see `applyAllChanges`.
   */
  function forgetField(id: string, field: string): void {
    const next: Record<string, ProposalView[]> = {};
    for (const [key, rows] of Object.entries(proposalsByCall())) {
      next[key] = rows
        .map((p) => {
          if (p.id !== id) return p;
          const fields = p.fields.filter((f) => f.name !== field);
          return { ...p, fields, summary: summarise(fields) };
        })
        .filter((p) => p.fields.length > 0);
    }
    setProposalsByCall(next);
  }

  /** Drop a resolved suggestion from wherever it was listed — see `acceptProposal`. */
  function forgetProposal(id: string): void {
    const next: Record<string, ProposalView[]> = {};
    for (const [key, rows] of Object.entries(proposalsByCall())) next[key] = rows.filter((p) => p.id !== id);
    setProposalsByCall(next);
  }

  /**
   * Every suggestion currently known about, across the calls that have been asked about.
   *
   * What `acceptProposal` looks an id up in: the id arrives from a card, and which key that card was
   * rendered under is not something the action is told.
   */
  const allProposals = (): ProposalView[] => Object.values(proposalsByCall()).flat();

  /**
   * The predicate `CollectionBlock.amendments` is written under. See `ExtractionAmendment`.
   *
   * Spelled here rather than derived, the same way {@link OVERLAY_KIND_PREDICATE} is in the adapter:
   * the records kernel parents by predicate, and a module cannot ask the manifest what a relation's
   * predicate is without importing the entity layer it is deliberately not coupled to.
   */
  const AMENDMENT_PREDICATE = 'we://extraction_amendment';

  /**
   * The record a change is about, as it stands *before* the change is applied.
   *
   * Read rather than taken from the card, although the card has it on screen: the panel holds it
   * only because it happens to be rendering a diff, and the "Accept all" path goes through
   * `acceptProposal`, which is also how a whole *create* is kept and knows nothing about diffs.
   * One read here answers for both, and neither action's signature has to grow a parameter whose
   * correctness depends on a schema passing the right expression.
   *
   * Timing is the whole point and there is no second chance at it: `accept` overwrites the value,
   * so the last moment the old one exists is before the call that discards it. Hence read-then-accept
   * rather than the other order, and hence this being worth a round trip at all.
   *
   * Never throws, and answers `null` for every way of not knowing — no records kernel, an
   * unclassified proposal, a record that has since been deleted, a failed read. A null means the
   * amendments simply are not written: losing the log is a smaller harm than a suggestion somebody
   * pressed accept on not being applied, which is what letting this fail would cost.
   */
  async function readBeforeChange(proposal: ProposalView): Promise<Record<string, unknown> | null> {
    if (!findEntity || !proposal.entity) return null;
    try {
      const rows = await findEntity(proposal.entity, { where: { id: proposal.id }, limit: 1 }, callTarget());
      return (rows?.[0] as Record<string, unknown> | undefined) ?? null;
    } catch (error) {
      console.warn('transcribe: could not read the record a change is about —', error);
      return null;
    }
  }

  /**
   * Write down the changes that were just accepted, one record per property.
   *
   * ## Why after the accept rather than as part of it
   *
   * The accept is the thing somebody asked for; this is the account of it. Written first, a failed
   * accept would leave a log claiming a change that never happened — the one error this cannot be
   * allowed to make, because the log's whole purpose is to be believed about what is in the record.
   * Written after and failing, the change is applied and unrecorded, which is exactly where this
   * started and no worse.
   *
   * ## Why unchanged values are skipped
   *
   * A staged update carries every value the pass proposed, including ones equal to what the record
   * already held — the panel filters those out of the diff for the same reason. Keeping them would
   * fill the log with "Fri → Fri" rows and bury the two lines somebody actually decided.
   *
   * `before` being null is not the same as a record with no values: the previous values could not be
   * read at all, so nothing here can honestly say what changed. Nothing is written, rather than a
   * row per property claiming it came from nothing.
   */
  async function recordAmendments(
    proposal: ProposalView,
    names: string[],
    before: Record<string, unknown> | null,
    /**
     * What was typed into the card instead of what the pass proposed, where somebody edited it.
     *
     * No surface offers this today — the pencil is on a *suggestion*, and this only ever runs for a
     * change — so it is here to keep the function honest rather than to serve a caller. A log that
     * records a value nobody chose is the one mistake worth pre-empting in something whose whole job
     * is to be believed.
     */
    edited: Record<string, string> | null = null,
  ): Promise<void> {
    const collection = targetCollection();
    if (!createEntity || !collection || !before) return;
    for (const name of names) {
      const field = proposal.fields.find((f) => f.name === name);
      if (!field) continue;
      const held = before[name];
      // Absent and empty are one case here: both read as "nothing there before", which is what a
      // property being filled in for the first time is, and it is the common amendment.
      const previousValue = held === undefined || held === null ? '' : String(held);
      const newValue = edited?.[name] ?? field.value;
      if (previousValue === newValue) continue;
      try {
        await createEntity(
          'ExtractionAmendment',
          {
            property: name,
            previousValue,
            newValue,
            nodeType: proposal.entity,
            // A to-one relation, written as the single-entry list the model layer takes.
            node: [proposal.id],
          },
          {
            // Parented on creation, as every other write here is: unparented then linked leaves a
            // window in which a crash orphans the record into the space.
            parent: { id: collection, predicate: AMENDMENT_PREDICATE },
            // The call's space, exactly as the accept just used — a call outlives the space on screen.
            ...callTarget(),
          },
        );
      } catch (error) {
        // One property's log, not the accept and not the others. See the docblock.
        console.warn(`transcribe: applied the change to "${name}" but could not record it —`, error);
      }
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
    /*
      And the same for the board. A fresh call is adopted *before* it has produced anything, so the
      hook on adoption finds nothing to arrange and does nothing — which left an auto-extracted call
      showing an empty tasks route and an offer to make a board by hand. This is the moment the work
      exists, and it is the same moment this effect already exists to notice.
    */
    void settleCollection(collectionId() ?? '');
  });

  /*
    Re-read every conversation on screen when the staged suggestions change — whoever changed them.

    The effect above catches suggestions *arriving*, since a pass settling is when they do. It could
    not catch them *leaving*: accepting or rejecting one is not a pass, so a card a peer accepted
    stayed pending here — faded on the canvas, still offering its buttons — until the next extraction
    or a restart. The host now reports that the set moved, from the graph rather than from the
    member who moved it, so a reader who was offline at the time still catches up when the change
    syncs.

    Every key asked about rather than only the call in progress, because `pendingIds` answers from
    all of them: a card is pending wherever it is drawn, and a list left stale for a call somebody
    looked at earlier would keep marking it.
  */
  let revisionSeen: number | undefined;
  effect?.(() => {
    const revision = typeof interpretation?.proposalsRevision === 'function' ? interpretation.proposalsRevision() : 0;
    // The first read is the baseline, not a change: whatever is on screen was fetched on demand.
    if (revisionSeen === undefined || revision === revisionSeen) {
      revisionSeen = revision;
      return;
    }
    revisionSeen = revision;
    for (const key of proposalsRequested) void loadProposals(key);
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
   * Whether anything has been written into this record that a pass could read.
   *
   * The one record we know is empty is the *live* call's, before the transcriber has adopted it —
   * `startCall` writes the record from the first second and nobody has said anything into it yet, so
   * offering Extract there spends an LLM call on an empty transcript. Any other id was named by
   * somebody who had it, which means it exists and has children.
   *
   * Kept apart from `targetCollection`, which deliberately answers for that same empty record:
   * choosing what a meeting will look for, before the meeting, is exactly when somebody wants to.
   * The two questions had one answer between them until extraction became per-call, and collapsing
   * them would have put the Extract button on an empty call.
   */
  const hasTranscript = (collection: string): boolean =>
    Boolean(collection) && (collection !== myCall()?.recordId || collectionId() === collection);

  /**
   * The record a decision about what to extract is written against.
   *
   * `collectionId` is what this agent is *writing into*, and it is null until somebody speaks — the
   * transcriber adopts the call's record on the first flush. So a call that had just started had no
   * collection, which meant the chips saying what would be extracted rendered against `''`: every
   * candidate came back unnarrowed and looking selected, and every press was refused by a guard that
   * said nothing. Choosing what a meeting looks for, before the meeting, is exactly when somebody
   * wants to.
   *
   * The call's own record is there from the first second — `startCall` writes it and publishes it on
   * presence — which is the same correction `CALL` in the workshop template already makes for the
   * same reason. Falling back to it rather than replacing `collectionId`, because once there *is* a
   * transcript the two are the same record and the adopted one is the more direct answer.
   */
  const targetCollection = (): string => collectionId() ?? myCall()?.recordId ?? '';

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
      /*
        A pass that produced something is a pass the host may want to act on — attach what it left
        loose, give the call a board once it holds a task. What exactly follows is the host's rule
        and lives in one place; this only says that a pass settled here.

        Not awaited into the status: the pass is done and reported, and whatever follows failing is
        not a failed extraction. Deliberately here rather than when somebody opens a route: a pass
        runs on one node, where opening a route runs on everybody's.
      */
      if (result.ids.length) void interpretation.passSettled?.(collection);
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
    // Out of the buffer, not yet a row. Cleared in `finally`, so every exit from here — written,
    // refused, or thrown — puts the preview back in agreement with what the feed can show.
    setSettling(text);

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
        // Back in the buffer, so they are pending again rather than in flight — without this the
        // same words would be shown twice while the record was awaited.
        setSettling('');
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
        // `spoken`, because a recogniser heard it — the one writer that may say so. Everything else
        // in this timeline is a person typing, and a transcript that cannot tell them apart claims
        // somebody said what they wrote. See `TextBlock.source`.
        { text, source: SPOKEN },
        { parent: { id: slot.id, predicate: CHILDREN_PREDICATE }, ...(dataset ? { dataset } : {}) },
      );
      await recordSelfParticipation(slot.id, dataset);
    } catch (cause) {
      // Reported but not surfaced as a failed state: the transcript continues, and losing one block
      // is better than stopping a call's transcription over a single write.
      console.error('transcribe: could not write block', cause);
    } finally {
      setSettling('');
    }
  }

  /** Forget every utterance in flight — the session ended, or the grace ran out. */
  function clearInFlight(): void {
    if (inFlightTimer) clearTimeout(inFlightTimer);
    inFlightTimer = null;
    inFlightDeadline = 0;
    setInFlight(0);
  }

  /**
   * An utterance has gone to the backend. It counts as being transcribed until text arrives or its
   * grace runs out, and the grace is the longest any utterance in flight has asked for — so a short
   * remark sent after a long one does not cut the long one's claim short.
   */
  function noteFed(samples: number): void {
    const durationMs = (samples / 16_000) * 1000;
    inFlightDeadline = Math.max(inFlightDeadline, Date.now() + durationMs + TRANSCRIBING_GRACE_MS);
    setInFlight(inFlight() + 1);
    if (inFlightTimer) clearTimeout(inFlightTimer);
    inFlightTimer = setTimeout(clearInFlight, Math.max(0, inFlightDeadline - Date.now()));
  }

  /**
   * Read the model list and record what it says, for the panel as much as for `start`.
   *
   * Swallows a failure and keeps whatever was known: a diagnostic read that fails once should not
   * flip the panel to "no model installed" on a node that has one.
   */
  async function readModels(): Promise<Awaited<ReturnType<NonNullable<typeof transcription>['models']>> | null> {
    if (!transcription || transcription.available?.() === false) return null;
    try {
      const models = await transcription.models();
      const downloading = models.filter((m) => !m.ready);
      setModelState(models.length === 0 ? 'none' : models.some((m) => m.ready) ? 'ready' : 'downloading');
      const known = downloading.map((m) => m.progress).filter((p): p is number => typeof p === 'number');
      setModelProgress(known.length ? Math.max(...known) : null);
      return models;
    } catch (cause) {
      console.warn('transcribe: could not read the model list', cause);
      return null;
    }
  }

  /**
   * Keep reading the model list while there is something to wait for.
   *
   * Three things are worth waiting for, and they overlap: a download the panel is showing progress
   * on, recording that is switched on with nothing it can run yet, and an open panel saying there is
   * no model. The second is what makes "it will start on its own" true — a model added in settings,
   * or by the button, is picked up here without anybody pressing record again.
   *
   * One timer at a time, re-armed from its own tick, so the reads never overlap however many callers
   * ask for a poll.
   */
  function pollModels(): void {
    if (modelPoll) return;
    modelPoll = setTimeout(async () => {
      const models = await readModels();
      modelPoll = null;
      const waiting = () => enabled() && !context && (status() === 'no-model' || status() === 'downloading');
      if (waiting() && models?.some((m) => m.ready)) {
        const audio = audioInput?.() ?? null;
        if (audio) {
          void start(audio);
          return;
        }
      }
      // A panel showing "no model" keeps asking too, so a model added in settings clears the note —
      // and hides the install button — without the panel being closed and opened again.
      if (modelState() === 'downloading' || waiting() || (open() && modelState() === 'none')) pollModels();
    }, MODEL_POLL_MS);
  }

  /**
   * Install the model the backend offers, from the panel, and carry on as though it had always been
   * there.
   *
   * Recording that gave up for want of a model is re-armed: an auto-join that failed silently is
   * allowed to try again — the call is still on, and the reason it stopped is gone — and a press
   * that found no model is already polling and picks the download up from there.
   */
  async function installModel(): Promise<void> {
    if (installingModel() || !transcription?.offeredModel?.()) return;
    setInstallingModel(true);
    setInstallError('');
    try {
      await transcription.installOfferedModel?.();
      await readModels();
      if (autoJoinFailed()) setAutoJoinFailed(false);
      pollModels();
    } catch (cause) {
      console.error('transcribe: could not install the offered model', cause);
      setInstallError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstallingModel(false);
    }
  }

  function onText(text: string): void {
    // Text is the answer to one utterance in flight, whatever it says.
    if (inFlight() > 0) setInFlight(inFlight() - 1);
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
      // Through `readModels`, so the panel learns what this start learned — including a failure,
      // which is rethrown below as the start's own.
      const models = (await readModels()) ?? (await transcription.models());
      if (mine !== generation) return await unwind();

      // `no-model` means *there is no model*, and nothing else. It used to also fire when a model
      // was installed but reported not-ready, which told the user to go and install the thing they
      // had already installed.
      if (models.length === 0) {
        if (autoJoined()) return giveUpAutoJoin('no-model');
        // Distinguished from a silent failure on purpose: no model and nobody talking look identical
        // from here, and only one of them is something the user can act on.
        setStatus('no-model');
        // And kept waiting, so adding one — here or in settings — starts recording without a second
        // press. The panel has said "it will start on its own" for a long time; this makes it so.
        pollModels();
        return;
      }

      /*
        Wait for a model that is still downloading rather than opening it.

        This used to open it anyway, on the reasoning that the executor loads on demand and a model
        that cannot run makes `open` fail and say why. Neither half survives contact with the
        executor: opening a stream on weights it does not have downloads them *inside that call*,
        holding a lock every other open waits on and reporting no progress, so the call times out at
        thirty seconds while the download carries on — an error that names nothing, for a model that
        is working. Waiting costs a poll, and says what is happening.
      */
      const ready = models.filter((m) => m.ready);
      if (ready.length === 0) {
        setStatus('downloading');
        pollModels();
        return;
      }
      const model = ready.find((m) => m.isDefault) ?? ready[0];

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
      // Closes over this run's session rather than the module's fields, so an utterance in flight
      // during a teardown feeds the stream it was captured for instead of whatever happens to be
      // current.
      const session = {
        stream: newStream,
        /**
         * Utterances with nowhere to go yet, oldest first — see {@link MAX_HELD_SAMPLES}. Each
         * counts the streams that have refused it, so one the far end will never accept is dropped
         * rather than retried into the ground; see {@link REFUSALS_BEFORE_DROPPING}.
         */
        held: [] as { audio: Float32Array; refusals: number }[],
        /** The reconnection in progress, so every utterance that fails joins the same one. */
        reconnecting: null as Promise<void> | null,
      };

      /** Keep an utterance until there is a stream to send it to, dropping the oldest past the cap. */
      const hold = (audio: Float32Array): void => {
        session.held.push({ audio, refusals: 0 });
        let total = session.held.reduce((sum, one) => sum + one.audio.length, 0);
        // Never empties: the utterance just held is the one worth keeping if it alone is over the cap.
        while (total > MAX_HELD_SAMPLES && session.held.length > 1) {
          total -= (session.held.shift() as { audio: Float32Array }).audio.length;
        }
      };

      /*
        Open a new stream in place of one that is gone, and send what was said meanwhile.

        A feed fails for reasons that have nothing to do with this session being over: the node was
        unreachable for a moment, a request timed out, the executor let the stream go, or the
        utterance itself was refused by something between here and the node. None of them is a reason
        to stop recording, and stopping is what used to happen — one failed retry ended transcription
        for the rest of the call, with no way back but a press nobody knew to make.

        The last of those is worth naming, because it is the one that was actually happening and the
        one a retry cannot fix: a proxy refusing an utterance too large for it, the same way every
        time. Resending it is what turned a refused utterance into a dead session. The drain below
        drops one the far end will not take, so it costs an utterance rather than the call.

        So it keeps trying, on a backoff, while the microphone stays open and what is said is held.
        Only when a minute of attempts has failed does it call it an outage, say so and stop: by then
        something is wrong that this cannot fix, and a lit record button over silence is worse than
        an error somebody can act on.

        Utterances that fail together share one reconnection rather than starting one each.
      */
      const reconnect = (cause: unknown): void => {
        if (session.reconnecting) return;
        console.info('[transcribe] the stream was dropped; re-establishing it', cause);
        setReconnecting(true);
        let last = cause;
        session.reconnecting = (async () => {
          for (const delay of RECONNECT_DELAYS_MS) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            if (mine !== generation) return;
            try {
              const fresh = await transcription.open(model.id, onText, TUNING);
              if (mine !== generation) {
                await fresh.close().catch(() => {});
                return;
              }
              const previous = session.stream;
              session.stream = fresh;
              stream = fresh;
              // Closed for tidiness; whatever dropped it has usually forgotten it already.
              void previous.close().catch(() => {});
              // One at a time, each removed only once it has landed — so a stream that dies again
              // part way through a drain loses nothing, and the next attempt carries on from there.
              while (session.held.length > 0) {
                const next = session.held[0];
                try {
                  await session.stream.feed(next.audio);
                  session.held.shift();
                } catch (refused) {
                  next.refusals += 1;
                  if (next.refusals < REFUSALS_BEFORE_DROPPING) throw refused;
                  /*
                    A stream that had just opened would not take it twice, so it is the utterance
                    that is being refused rather than the connection that is failing — most likely
                    it is larger than something between here and the node will carry.

                    Dropped, and the rest of the queue goes on. The same call as a failed block
                    write: losing one utterance is better than losing the transcript, and this is
                    the retry that used to end the session instead.
                  */
                  console.warn('transcribe: this utterance was refused twice and has been dropped', refused);
                  session.held.shift();
                }
              }
              setReconnecting(false);
              return;
            } catch (again) {
              if (mine !== generation) return;
              last = again;
              console.info('[transcribe] could not re-establish the stream; trying again', again);
            }
          }
          console.error('transcribe: gave up re-establishing the transcription stream', last);
          setReconnecting(false);
          setStatus('error');
          setError(
            `Transcription stopped: the speech model could not be reached again (${last instanceof Error ? last.message : String(last)}).`,
          );
          void stop();
        })().finally(() => {
          session.reconnecting = null;
        });
      };

      /** Feed one utterance, or hold it and start putting the stream back. */
      const feed = async (audio: Float32Array): Promise<void> => {
        noteFed(audio.length);
        // Held rather than raced: while a reconnection is running there is nothing to feed it to,
        // and sending into the old stream would only fail again and say so a second time.
        if (session.reconnecting) {
          hold(audio);
          return;
        }
        const tried = session.stream;
        try {
          await tried.feed(audio);
        } catch (cause) {
          if (mine !== generation) return;
          // Held too, so the sentence that discovered the problem is not the one lost.
          hold(audio);
          reconnect(cause);
        }
      };

      newNode.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        if (event.data.kind === 'level') {
          setLevel(event.data.rms);
          setSpeaking(event.data.speaking);
          return;
        }
        void feed(event.data.audio);
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
    // Whatever was in flight answers into a closed stream now, so nothing is still being transcribed.
    clearInFlight();
    // A reconnection in progress belongs to the session being torn down: the generation bump above
    // is what ends it, and nothing should still be claiming the words are on their way.
    setReconnecting(false);

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
   * Tell the host a pass has settled on this collection, so it can do whatever follows.
   *
   * Two moments make a pass known to this client and they cover opposite orderings, so both call
   * this. **Adopting** a collection catches a pass that ran while nobody was here. A pass
   * **settling** catches one that runs while somebody is — which is the ordinary case for a fresh
   * call, where adoption happens before there is anything to arrange.
   *
   * What follows is the host's — see `passSettled` on the contract — and it is idempotent, so
   * calling this more often than strictly necessary costs a round trip and changes nothing.
   */
  async function settleCollection(collection: string): Promise<void> {
    if (!collection) return;
    try {
      await interpretation?.passSettled?.(collection);
    } catch {
      // Best-effort: the pass itself already succeeded, and the host reports its own failures.
    }
  }

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
    // Tell the host a pass may have settled here while nobody was watching — see `passSettled`.
    // Adopting a collection is the moment somebody is about to look at it.
    if (next && typeof interpretation?.passSettled === 'function') {
      // The host decides what follows, as it does for every other pass over this collection.
      void settleCollection(next);
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
   * Whether automatic extraction was on when the watch was last decided — the third half of the key
   * below, and the one that was missing. Without it a call that started with the watch registered
   * short-circuited every later run, so switching automatic extraction off mid-call never reached
   * the unwatch and the watch kept spending a model call per pass.
   */
  let watchedAuto = true;

  /**
   * The collection this agent has already been told has nothing selected to extract — see the toast
   * in `syncWatch`. `syncWatch` re-runs on every change to the target list, and somebody unticking
   * the last chip should hear about it once rather than on every press afterwards.
   */
  let warnedEmpty: string | null = null;

  /**
   * Whether this community has automatic extraction on.
   *
   * Feature-tested like every other interpretation call — the host publishes a forwarding wrapper
   * that is always present, so `interpretation?.` only answers "is there a wrapper". A host that
   * predates this reads as *on*, which keeps its behaviour exactly as it was: the host's own gate
   * still refuses the registration, and the panel still reports it.
   */
  const autoEnabled = (collection?: string): boolean =>
    typeof interpretation?.autoEnabled === 'function' ? interpretation.autoEnabled(collection) : true;

  async function syncWatch(next: string | null): Promise<void> {
    // Keyed on what this call currently extracts, so a group changing it mid-call moves the watch.
    // The host owns the list; this only has to notice when the answer changed.
    const key = next
      ? targetsFor(next)
          .filter((t) => t.selected)
          .map((t) => t.entity)
          .join(',')
      : '';
    const auto = next ? autoEnabled(next) : true;
    if (watched === next && watchedClasses === key && watchedAuto === auto) return;
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
    watchedAuto = auto;

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

    if (next && !auto) {
      /*
        Nothing said, because nothing is wrong.

        This set "Automatic extraction is off for this call." and the panel printed it under the
        controls — a sentence restating the switch immediately above it, permanently, for everyone
        who had deliberately turned it off. `watchProblem` is for the cases somebody cannot see and
        cannot fix from here; a setting they just changed is neither.

        The early return stays, and does the work: the host would refuse the registration anyway, and
        the unwatch above has already run, so switching off mid-call stops the watch rather than
        leaving it spending a model call per pass for a community that just said stop.
      */
      setWatchProblem('');
      /*
        Nothing is registered, so nothing is remembered as watched.

        This left `watched` set, and the short-circuit at the top of this function keys on it — so
        the effect that re-runs on the setting changing got here and returned on its first line,
        both directions. Switched back on, no watch was ever registered and this sentence stayed on
        screen for the rest of the call; started on and switched off, the unwatch never ran and the
        watch kept spending a model call per pass on a community that had just said stop.
      */
      watched = null;
      watchedClasses = '';
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
      /*
        Said once, out loud, rather than printed under the controls for the rest of the call.

        The node can watch perfectly well and nothing has been marked for it to look for, so this is
        worth mentioning — but it was a permanent sentence describing a state the chips above it
        already show, which is the definition of clutter. A toast says it at the moment it starts to
        matter and then gets out of the way.

        Keyed on the collection so it is once per call and not once per re-registration: `syncWatch`
        re-runs whenever the target list changes, and somebody unticking the last chip should be told
        once, not on every press after it.
      */
      if (warnedEmpty !== next) {
        warnedEmpty = next;
        notify?.('warning', 'No models selected for extraction');
      }
      setWatchProblem('');
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
    void autoEnabled(live);
    void syncWatch(live);
  });

  /**
   * Adopt a continued call's record straight away.
   *
   * A fresh call's record is empty until somebody speaks, so it is adopted on the first flush and
   * `canExtract` says no until then — correct, since a pass over nothing spends a model call to find
   * nothing. A *continued* call is the opposite case: its record already holds last time's words,
   * and the same rule left Extract disabled and the panel empty until this agent said something. The
   * transcript panel's own Continue button worked around it with a `resume` action chained after
   * `continueCall`; the rail's path into the same call could not, so the two disagreed about
   * whether the call had a transcript.
   *
   * The call module says which case this is, on the activity it already publishes the record in —
   * `continued` — so nothing here names it and no query is needed, and `resume` is gone. Guarded
   * on the record itself, so a republish of the same activity does not adopt twice.
   */
  effect?.(() => {
    const call = myCall();
    if (!call?.continued || !call.recordId) return;
    if (collectionId() === call.recordId) return;
    useCollection(call.recordId);
    collectionCallId = call.id;
    announce(call.id, enabled(), call.recordId);
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
   *
   * ## And leaving switches recording off
   *
   * The microphone being recorded was the call's, so there is nothing left to record. Nothing said
   * so before: the only effect that cleared `enabled` wanted *no dataset and no call*, which is the
   * boot frame and a logged-out agent, and inside a space the dataset is always there. So leaving a
   * call left this agent flagged as recording for the rest of the session.
   *
   * Three things followed from that one stale flag, all of them reported as separate bugs. The
   * level meter is drawn on `enabled`, so it stayed on screen with no call. The record button reads
   * `enabled || available`, so it offered to *stop* transcribing a call that had ended. And the
   * audio effect below reports `on && !audio` as `no-audio`, which parked the status at "Nothing to
   * listen to" — invisible while a past call was on screen, since the status notes are hidden
   * there, and revealed the instant somebody continued that call, as a flash before the microphone
   * arrived.
   *
   * Setting it here rather than teaching those three to ask a second question: they are each
   * reading `enabled` correctly, and what was wrong is that `enabled` was.
   */
  let decidedForCall: string | null = null;
  effect?.(() => {
    const current = myCall()?.id ?? null;
    if (current === decidedForCall) return;
    decidedForCall = current;
    setOptedOut(false);
    setAutoJoined(false);
    setAutoJoinFailed(false);
    // The audio effect does the teardown: it reads `enabled`, so this re-runs it, and it lands on
    // `idle` rather than the `no-audio` it would otherwise have reported.
    if (!current) setEnabled(false);
  });

  /**
   * Record the call you are in.
   *
   * The module's one piece of policy, and it is now the whole of it: being in a call is what starts
   * recording, whether or not anybody else is already doing it.
   *
   * It used to stop short of that on purpose — joining a transcript somebody else had started was
   * held to be a different question from starting one, and starting one was left to a space setting
   * that did not exist. In practice the two are the same question asked at different
   * moments, and splitting them made the ordinary case the unreliable one: whether a meeting was
   * recorded depended on whether whoever happened to arrive first remembered to press a button. A
   * transcript that exists for four meetings out of five is worse than either alternative, because
   * nothing distinguishes "we chose not to record that one" from "nobody pressed it".
   *
   * The argument for joining carries over unchanged, and it is not a privacy argument: a refusal
   * does not stop the conversation being recorded, it only removes this agent's own words from the
   * record of a conversation they are part of, which produces a wrong transcript rather than a
   * smaller one. What survives from the old shape is the way out — `optedOut` is checked first, and
   * pressing Leave or stopping recording by hand sets it for the rest of the call.
   *
   * Three guards, and each is a case where starting would be wrong rather than merely unhelpful:
   * - no dataset: there is nowhere for the words to go. Also the one that must be tested rather than
   *   left to the teardown effect below, which switches recording off whenever the space is gone:
   *   that effect and this one would take turns for as long as no dataset was bound.
   * - no audio: there is nothing to record, and `enabled` would sit true against silence.
   * - a backend that cannot transcribe: caught here because `available` is answerable synchronously.
   *   Having no *model* is not, so that one is caught in `start` — see `giveUpAutoJoin`.
   *
   * A fourth guard is the space's, and the agent's: `recordCalls`, declared on the module and
   * resolved by the host across every level that had an opinion — so a community that does not want
   * its calls recorded, or somebody who does not want their own recorded here, is answered without
   * this effect knowing that either exists. Defaulted true where a host has no settings layer at
   * all, which is the behaviour every deployment had before there was one.
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
    if (settings?.().recordCalls === false) return;

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
    if (modelPoll) clearTimeout(modelPoll);
    modelPoll = null;
    void stop();
  });

  /*
    Opening the panel asks what models there are, once.

    Everything else learns it by trying to record, and the panel is where somebody goes *before*
    that — to see whether this works here at all. Without it the one-click install would appear only
    after a failed attempt, which is the wrong order for a download that size.
  */
  effect?.(() => {
    if (open() && modelState() === 'unknown') {
      void readModels().then(() => {
        if (modelState() === 'downloading' || modelState() === 'none') pollModels();
      });
    }
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
  });

  return {
    // ── State ────────────────────────────────────────────────────────────────
    status: state(
      status,
      'What the session is doing — idle, no-backend, no-model, no-audio, downloading, starting, listening or error.',
    ),
    error: state(error, 'Why the session stopped, when status is error; empty otherwise.'),
    /**
     * The stream dropped and is being put back, with the microphone still open.
     *
     * Its own member rather than a status, because `status` says what the *session* is doing and the
     * session is still listening: the record button stays lit, the meter keeps moving, and what is
     * said is held rather than lost. What a reader needs to know is that the words are waiting.
     */
    reconnecting: state(
      reconnecting,
      'The link to the speech model dropped and is being re-established; what is said meanwhile is held.',
    ),
    /**
     * What has been heard and is not yet a row in the transcript — buffering, or being written.
     *
     * The union of the two, because from the reader's side they are one state: these words are not
     * in the record yet. Splitting them would put a seam in the middle of a sentence, and there is
     * nothing a panel could usefully do differently either side of it.
     *
     * Newest last, matching the order they will be written in. Both are non-empty only while
     * somebody carries on talking through a write, which is the case the join exists for.
     */
    pending: state(
      () => [settling(), pending()].filter(Boolean).join(' '),
      'Words heard that are not yet a row in the transcript — buffered or being written, newest last.',
    ),
    /**
     * Speech has gone to the model and its text has not come back yet.
     *
     * The gap between somebody stopping and their words appearing — a second or several on a CPU —
     * during which, without this, a panel looks exactly like one that did not hear them.
     */
    transcribing: state(() => inFlight() > 0, 'Speech has gone to the model and its text has not come back yet.'),
    /**
     * Something has been said that the record does not hold yet: words buffered or being written,
     * or speech still with the model. What decides whether the unsaved box shows, and whether the
     * empty feed may still claim nothing has been said.
     */
    heard: state(
      () => Boolean(settling() || pending() || inFlight() > 0),
      'Something has been said that the record does not hold yet — buffered, being written or still with the model.',
    ),
    enabled: state(enabled, 'Whether this agent is recording their own microphone into the call.'),
    /**
     * No transcription model is installed, as last read. True outside a recording too — see
     * {@link ModelState} for why that matters.
     */
    modelMissing: state(
      () => modelState() === 'none',
      'No transcription model is installed on this node, as last read.',
    ),
    /** A model is installed and its weights are still arriving. */
    modelDownloading: state(
      () => modelState() === 'downloading',
      'A transcription model is installed and its weights are still arriving.',
    ),
    /** The download line, ready to show: "Downloading the speech model — 45%". */
    modelDownloadText: state(() => {
      const progress = modelProgress();
      return progress === null ? 'Downloading the speech model…' : `Downloading the speech model — ${progress}%`;
    }, 'The download line, ready to show — "Downloading the speech model — 45%".'),
    /** Whether this connection may install the backend's offered model. */
    canInstallModel: state(
      () => Boolean(transcription?.offeredModel?.()),
      'Whether this connection may install the model the backend offers.',
    ),
    /** The install button's words, naming the size before anybody agrees to it. */
    installModelLabel: state(() => {
      const offer = transcription?.offeredModel?.();
      return offer ? `Download ${offer.name} (${formatBytes(offer.downloadBytes)})` : '';
    }, 'The install button’s words, naming the offered model and its size; empty when none is offered.'),
    installingModel: state(installingModel, 'A one-click model install is registering its model.'),
    installError: state(installError, 'Why the last model install failed; empty otherwise.'),
    installModel: action(
      () => installModel(),
      'Installs the model the backend offers and resumes recording that was waiting on one.',
    ),
    /**
     * Whether the transcript panel is up — and this module's to say, not the host's.
     *
     * The contract lets the host hold a panel's openness by default, and for most panels that is the
     * right owner. Not this one: `toggle` opens it when somebody presses record, because starting
     * something invisible and saying nothing about it is how a feature comes to look broken, and the
     * model poll below reads it to keep asking while a panel says "no model". Both are facts about
     * this module, so it names the key on its panel and owns closing it too — see `panels` in
     * `index.ts`.
     */
    open: state(open, 'Whether the transcript panel is open.'),
    // The panel's `show` and `close`: what the rail and the titlebar call, since the module owns
    // the flag.
    openPanel: action(() => setOpen(true), 'Opens the transcript panel.'),
    closePanel: action(() => setOpen(false), 'Closes the transcript panel.'),
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
    collectionId: state(
      collectionId,
      'The record this call’s transcript lives in, or null until something has been said.',
    ),

    /*
      The transcript's window — see the signals for why a transcript is two documents, not one.
    */
    transcriptShown: state(transcriptShown, 'How many transcript lines are loaded right now.'),
    transcriptFromStart: state(
      transcriptFromStart,
      'Whether the transcript is being read from its beginning rather than following the live end.',
    ),
    showMoreTranscript: action(
      () => setTranscriptShown(transcriptShown() + TRANSCRIPT_PAGE),
      'Loads one more page of the transcript, in whichever direction it is being read.',
    ),
    /**
     * Read from the beginning — a different query, not a scroll.
     *
     * The window is anchored to the live end, so "the top of what is loaded" is not the start of the
     * conversation and a scroll cannot reach one from the other. Asking for the oldest page instead
     * is cheap, exact, and needs no cursor — which matters, because the backend has none.
     *
     * It arrives as a cut rather than a journey. That is the honest rendering: the content between
     * the two ends was never on screen to travel through, and `we-scroll-area` already takes the
     * same view of any move too long to sit through.
     */
    readTranscriptFromStart: action(() => {
      setTranscriptFromStart(true);
      setTranscriptShown(TRANSCRIPT_FIRST_PAGE);
    }, 'Shows the beginning of the transcript, to be read forwards.'),
    readTranscriptLive: action(() => {
      setTranscriptFromStart(false);
      setTranscriptShown(TRANSCRIPT_FIRST_PAGE);
    }, 'Goes back to following the end of the transcript.'),

    /*
      Where a panel opens is no longer answered here.

      `dockEdge` / `dockSize` / `dockFloat` and their extraction twins were six accessors returning
      constants — `right`, `md`, `false` — with `edge` doubling as "whether" by answering null while
      closed. A panel's opening bid is data, so it is declared on the `PanelContribution` in
      `index.ts`; whether the panel is up is the one thing left that is genuinely state, and that is
      `open` above and `extractionOpen` below.
    */
    /**
     * Whether the extraction panel is up — its own flag, and module-owned for its own reason.
     *
     * Separate from `open` because a transcript is read while somebody talks and extraction is read
     * afterwards, so wanting one on screen says nothing about wanting the other. Module-owned
     * because a *pass starting* opens it — anybody's, not only this agent's — and so does switching
     * automatic extraction on: the four people in five who did not start a pass are the ones who
     * need telling, and a host-held flag would leave the module no way to tell them.
     */
    extractionOpen: state(extractionOpen, 'Whether the extraction panel is open.'),
    openExtractionPanel: action(() => setExtractionOpen(true), 'Opens the extraction panel.'),
    closeExtractionPanel: action(() => setExtractionOpen(false), 'Closes the extraction panel.'),
    level: state(level, 'Microphone loudness as the voice detector measures it, 0–1.'),
    speaking: state(speaking, 'Whether the microphone level currently counts as speech.'),
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
    levelPercent: state(() => asPercent(level()), 'The microphone level as a CSS width for a meter.'),
    thresholdPercent: state(
      () => asPercent(VAD.speechOnsetThreshold),
      'The speech-onset threshold as a CSS width, to mark on the same meter.',
    ),
    /** True only while actually producing — what the call bar's record button highlights on. */
    listening: state(
      () => status() === 'listening',
      'True only while actually transcribing — what a record button highlights on.',
    ),

    /**
     * Recording was started by a peer's transcript rather than by this agent — see the auto-join
     * effect. What the call bar reads to announce it, since being switched on by somebody else is
     * not something an agent should have to notice for themselves.
     */
    autoJoined: state(autoJoined, 'Recording was started by the call rather than by this agent pressing record.'),
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
    invited: state(() => {
      const call = myCall();
      if (!call || enabled() || optedOut()) return false;
      return peerRecordersOf(call.id).length > 0;
    }, 'Somebody else in this call is recording and this agent is not, having not opted out.'),
    /**
     * The first peer recording this call, for a surface that names who started it.
     *
     * One agent rather than the list, and their DID rather than their name, because this module
     * holds no profiles — a fragment resolves it with `$agent`, the same way the calls list puts a
     * face on an utterance.
     *
     * Empty once no peer is recording any more: this agent may still be recording after the peer who
     * started it stopped, so test it before drawing a name.
     */
    invitedBy: state(() => {
      const call = myCall();
      if (!call) return '';
      return peerRecordersOf(call.id)[0] ?? '';
    }, 'The agent id of the first peer recording this call, or empty when none is.'),
    /**
     * Everyone recording this call, this agent included — the numerator of coverage.
     *
     * Transcription is per microphone: each agent records their own and writes into the shared
     * record, so a call where two of five are recording produces a transcript of two people that
     * reads exactly like a transcript of the call. Published so the panel can say which it is, while
     * the meeting is still happening and somebody can still do something about it.
     */
    transcribers: state(() => {
      const call = myCall();
      return call ? recordersOf(call.id) : [];
    }, 'Everyone recording this call, this agent included — the numerator of coverage.'),
    /** Everyone in this call — the denominator. Empty outside a call, which is what hides coverage. */
    callAgents: state(() => {
      const call = myCall();
      return call ? agentsInCall(call.id) : [];
    }, 'Everyone in this call, recording or not — the denominator of coverage; empty outside a call.'),
    /** Whether this agent is in a call at all — what decides between "join" and "continue" wording. */
    inCall: state(() => myCall() !== null, 'Whether this agent is in a call right now.'),
    /**
     * Whether somebody is in the call the address names, read off presence rather than off the call
     * module's roster. The panel used to read `modules.call.liveCalls` for this, which was the one
     * place this module named that one; presence is the medium the two are meant to meet in.
     */
    callOnScreenLive: state(() => {
      const record = deps.callOnScreen?.() ?? null;
      if (!record || !presence) return false;
      return activitiesOfType(presence.peers(), 'call').some(
        ({ activity }) => (activity as { record?: string }).record === record,
      );
    }, 'Somebody is in the call the address names right now.'),
    /** Someone in this call is not being transcribed. The gap coverage exists to report. */
    partialCoverage: state(() => {
      const call = myCall();
      if (!call) return false;
      const present = agentsInCall(call.id).length;
      return present > 0 && recordersOf(call.id).length < present;
    }, 'Someone in this call is not being transcribed.'),
    /** There is audio to listen to. Without it, offering to record is offering nothing. */
    available: state(
      () => (audioInput?.() ?? null) !== null,
      'There is audio to listen to — a microphone the host is capturing.',
    ),

    // ── Extraction ───────────────────────────────────────────────────────────
    extractStatus: state(extractStatus, 'How the last one-shot extraction pass went — idle, running, done or error.'),
    extractCount: state(extractCount, 'How many records the last pass wrote.'),
    extractError: state(extractError, 'Why the last pass failed; empty otherwise.'),
    extractingId: state(extractingId, 'The collection a pass is running on right now, or empty.'),
    extractedId: state(extractedId, 'The collection the last finished pass ran on, or empty.'),
    extractTurns: state(extractTurns, 'How many transcript turns the last pass read.'),
    /**
     * The record this call's extraction decisions are written against.
     *
     * `collectionId` is what the transcriber is *writing into*, and it is null until somebody
     * speaks; the call's own record exists from the first second. Choosing what a meeting looks for,
     * before the meeting, is exactly when somebody wants to — so this is the id an extraction
     * surface names, and the one a `subject` expression falls back to.
     */
    callId: state(
      () => targetCollection(),
      'The record extraction decisions for this call are written against — the call’s own record from its first second.',
    ),

    /**
     * What can be extracted from **one named call**, indexed by its record id.
     *
     * `modules.transcribe.extractionFor[<id>].canExtract`, and the same for `targets` and
     * `canChoose`. Keyed rather than three accessors about the live call, because the panel that
     * reads them is about whichever call is *on screen* — which is the live one most of the time and
     * a past one whenever somebody opened it from a link, and there is no way for an expression to
     * pass an argument to a store member. Same shape as `recordStore.displays[row.type]`.
     *
     * That gap is not hypothetical: the workshop template's own extraction panel asked these three
     * about the live call and drew the results of the addressed one, so the chips said what one call
     * was looking for above a list of what a different call had found — and its Extract button was
     * hidden by a `canExtract` about the wrong record even though the action it guards takes an id
     * and would have worked.
     *
     * The three answers travel together because they fail differently and a surface has to tell them
     * apart. `canExtract` false with `targets` empty is a space that has marked no models; with
     * `canChoose` false it is a call nothing has been said in yet; with both true it is a node with
     * no model at all, which `extractable` answers.
     */
    extractionFor: state(
      () =>
        /*
        A `namespace`, not a plain object and not a `Proxy`.

        A plain object cannot hold an entry per call — the ids are not enumerable from here, and a
        past call's is whatever the address names. A `Proxy` looks like the answer and is not: the
        evaluator guards every property read with `property in base` for prototype safety, and a
        proxy over an empty target answers `false` to that for every key, so the whole lookup came
        back `undefined` with nothing said. `namespace` is the mechanism the expression layer
        already provides for a keyed lookup, and `readProperty` reaches it before that guard.
      */
        namespace((key: string) => {
          {
            {
              const collection = key;
              return {
                /**
                 * What this call can have extracted, and whether each is on —
                 * `{ entity, label, selected }`.
                 *
                 * One list rather than two, because a schema renders it as a row of toggles and cannot
                 * join two lists to decide which are ticked. Empty in a space that has marked no models
                 * for extraction, which is a real state worth saying rather than an error.
                 */
                targets: targetsFor(collection).map((target) => ({ ...target, label: humanise(target.entity) })),
                /**
                 * Whether a press on one of those would actually record anything.
                 *
                 * Both halves fail silently and differently: no call means there is nothing to record a
                 * choice against, and a host with no `setTarget` cannot record one at all. Published so
                 * a surface can say which rather than offering chips that absorb the click — which is
                 * what they did, and what made this look broken rather than unavailable.
                 */
                canChoose: Boolean(collection) && typeof interpretation?.setTarget === 'function',
                /**
                 * Whether there is anything to extract *from* and anything to extract *with*.
                 *
                 * Both halves matter and they fail differently: no collection means nothing has been
                 * said yet, no port means this node has no LLM. The panel tells those apart; this is
                 * the guard that stops the button being offered when neither can be fixed by pressing
                 * it.
                 */
                canExtract:
                  hasTranscript(collection) && (interpretation?.available() ?? false) && hasTargets(collection),
              };
            }
          }
        }),
      'What one call can extract, by record id — { targets, canChoose, canExtract }, read as extractionFor[id].',
    ),
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
    toggleExtractionTarget: action(async (entity: string, collection?: string) => {
      // Named, or the one this agent is in — the same pair `extractCollection` and `extract` are,
      // so a panel about a call somebody opened from a link changes *that* call's list.
      const target = collection || targetCollection();
      if (!target || typeof interpretation?.setTarget !== 'function') return;
      const current = targetsFor(target).find((entry) => entry.entity === entity);
      try {
        await interpretation.setTarget(target, entity, !current?.selected);
      } catch (error) {
        console.warn('[transcribe] could not change what this call extracts', error);
      }
    }, 'Includes or excludes one model from what a call extracts, for everyone in it; defaults to the live call.'),
    /**
     * Whether this call is extracted as it happens — its participants' answer, else the space's.
     *
     * What a switch in the extraction panel binds to. Absent a call it answers for the space, which
     * is the honest reading of "does this happen here" when there is no conversation to be about.
     */
    autoExtract: state(
      () => autoEnabled(collectionId() ?? myCall()?.recordId ?? undefined),
      'Whether this call is extracted as it happens — its participants’ answer, else the space’s.',
    ),
    /**
     * Whether any pass is running right now, this node's or a peer's — what the rail's Extraction
     * launcher spins on, via `busyWhen`.
     *
     * Read off the host's activity feed rather than `extractStatus`, which only knows about the
     * one-shot pass this agent pressed for. The four people in five who did not start a pass are the
     * ones this exists for, and their node is not the one running it. Feature-tested for the reason
     * the settled-count effect above is: the forwarding wrapper is always present, the feed is not.
     */
    passRunning: state(
      () =>
        typeof interpretation?.activity === 'function' ? interpretation.activity().some((pass) => pass.running) : false,
      'Whether any extraction pass is running right now, this node’s or a peer’s.',
    ),
    /**
     * Turn it on or off for **this call**, for everyone in it.
     *
     * A group decision beside the call, like `toggleExtractionTarget` — the standing watch is one
     * registration the whole neighbourhood shares. It leaves the space's own default alone, so a
     * conversation that has wandered somewhere nobody wants records of can be stopped without the
     * community changing its mind about every future call.
     *
     * Refused quietly where there is no call to record it against, in the same shape and for the
     * same reason as `toggleExtractionTarget` — pair it with `canChooseTargets`, which answers the
     * same question about the same record.
     */
    toggleAutoExtract: action(async () => {
      const live = collectionId() ?? myCall()?.recordId ?? '';
      if (!live || typeof interpretation?.setAuto !== 'function') return;
      const next = !autoEnabled(live);
      // Switching it on shows what it makes, once — the same rule `toggle` follows for recording,
      // and for the same reason: starting something invisible and saying nothing about it is how a
      // feature comes to look broken. Switching it off leaves the panel alone, since what it already
      // found is still worth reading.
      if (next) setExtractionOpen(true);
      try {
        await interpretation.setAuto(live, next);
      } catch (error) {
        console.warn('[transcribe] could not change whether this call extracts as it happens', error);
      }
    }, 'Turns automatic extraction on or off for this call, for everyone in it.'),
    /** True when the backend could interpret but there is no transcript yet — a waiting state. */
    extractable: state(
      () => interpretation?.available() ?? false,
      'Whether this node can interpret at all — false when it has no language model.',
    ),
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
    liveCollectionId: state(
      () => collectionId() ?? '',
      'The record the call this agent is in is writing into, or empty when there is none.',
    ),
    /**
     * Suggestions staged on one conversation — `modules.transcribe.proposalsFor[<id>]`.
     *
     * Keyed for `extractionFor`'s reason: the surface asking is about whichever call is on screen,
     * and an expression cannot pass an argument to a store member. Reading a key it has not seen
     * fetches it, which is what makes a review list fill after a restart — see `proposalsByCall`.
     *
     * An empty key asks about the whole space, which is the honest answer outside a call.
     */
    proposalsFor: state(
      () => namespace((key: string) => proposalsFor(key)),
      'Suggestions staged on one conversation, by record id — read as proposalsFor[id].',
    ),
    /**
     * Every record still awaiting a decision, by id — what marks a card as a suggestion.
     *
     * Not keyed, deliberately, and `pendingIds` in the store says why at length: whether anybody has
     * agreed to a record is a fact about the record, where which decisions somebody is being *asked*
     * for is a fact about a conversation. A board asks the first question and a review list the
     * second, and keying the first made switching calls flash every outgoing card as settled.
     */
    pendingIds: state(pendingIds, 'Every record still awaiting a decision, by id, across every call asked about.'),
    /**
     * The same suggestions as rows rather than ids, for a surface that has to *read* one.
     *
     * A card marker asks "is this waiting?" and wants {@link pendingIds}; a card that shows what was
     * proposed has to find the proposal and read it, which ids cannot answer. Both are the union
     * across every call asked about, for the reason `pendingIds` gives at length.
     */
    pendingProposals: state(allProposals, 'The same suggestions as rows — { id, kind, entity, fields, summary }.'),
    /**
     * Records a pass made that nobody has kept — draw them as provisional, and let a reader hide them.
     * See {@link pendingIds} for why this is a union across calls rather than keyed by one.
     */
    unconfirmedIds: state(unconfirmedIds, 'Records a pass made that nobody has kept yet, by id.'),
    /** Agreed records carrying a suggested change — mark them, never fade or hide them. */
    changedIds: state(changedIds, 'Agreed records carrying a suggested change, by id.'),
    /**
     * The same, for the call this agent is in.
     *
     * Nothing in this repo reads it any more — both surfaces that did now name the call they are
     * about. It stays because this is the spelling a template already installed would be using, and
     * it is the one that was *wrong* in the way this keying fixes: pointed at the live call it is
     * now correct rather than merely unscoped, so an old template improves instead of breaking.
     *
     * Not a member to reach for in something new. A surface that can be about a past call should say
     * which call it means, which is `proposalsFor`.
     */
    proposals: state(
      () => proposalsFor(targetCollection()),
      'Suggestions staged on the live call — prefer proposalsFor with the call named.',
    ),
    /** The suggestion open for editing, or '' when none is. Compare it against a row's own id. */
    editingProposal: state(editingProposal, 'The suggestion open for editing, or empty when none is.'),
    /**
     * What has been typed into the open draft, keyed by the model's property name.
     *
     * Read a field with an index — `modules.transcribe.proposalDraft[field.name]` — because the keys
     * come from the model and a template cannot name them. Empty when nothing is being edited.
     */
    proposalDraft: state(proposalDraft, 'What has been typed into the open suggestion, keyed by property name.'),
    /**
     * Whether an edited suggestion can actually be written back on accept.
     *
     * False where the host lends no record-update surface, or where the backend could not say which
     * model the suggestion is of — an edit needs the entity name to write to. Gate the edit control
     * on it rather than offering one whose Keep would silently discard what was typed.
     */
    canEditProposals: state(() => !!updateEntity, 'Whether an edited suggestion can be written back on accept.'),
    /**
     * Why auto-extraction is not running here, or empty when it is.
     *
     * Distinct from `extractable`, which answers whether the node can interpret at all. A watch can
     * fail on a node that interprets perfectly well — the host may simply not coordinate standing
     * watches — and the two want different sentences.
     */
    watchProblem: state(watchProblem, 'Why the standing extraction watch is not running here; empty when it is.'),

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

    /*
      No band of its own, and this used to reserve one.

      There was a strip under the call bar reporting a running pass, and this held room for it — so
      while a pass ran, everything on screen moved up to clear a band. The strip is gone: what it
      reported lives in the extraction panel, and what is left in the bar is the record button, one
      square in the bar's own row, which the call module already accounts for.

      The reservation outlived it, so the content still moved for a strip that was not there. Left
      out entirely rather than returned as zeroes, because a module with no fixed chrome should not
      be answering the question — see `chromeReserve` in the module contract.
    */

    // ── Actions ──────────────────────────────────────────────────────────────
    /**
     * Start or stop recording.
     *
     * Separate from the panel's own `open` / `openPanel` / `closePanel` because they are different
     * questions — "capture this call" and "show me what was captured" — and fusing them meant the
     * transcript vanished the moment you stopped recording, which is exactly when you want to read it.
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
    toggle: action(() => {
      const next = !enabled();
      /*
        `optedOut` **before** `enabled`, and that ordering is the whole of a two-press bug.

        The auto-join effect reads both, and a signal write runs it synchronously. Written the other
        way round, `setEnabled(false)` ran the effect while `optedOut` still said false — so it saw
        an agent in a call who was not recording and had not declined, which is exactly the state it
        exists to answer, and turned recording straight back on. The press after it worked, because
        by then the opt-out had landed.

        Setting the refusal first means every run of that effect sees a decision that is already
        whole: on the way out `enabled` is still true and it returns, and on the write after it
        `optedOut` is true and it returns again.
      */
      setOptedOut(!next);
      setAutoJoined(false);
      setEnabled(next);
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
    }, 'Starts or stops recording this agent’s microphone into the call, and opens the transcript when starting.'),
    /*
      There is no `dismissInvite` any more, and nothing replaced it.

      It existed to close an offer without answering it, which was a third state worth having while
      the notice was a question. It is not one now: the notice reports that recording is already
      running, so the only answer to it is to stop — which is `toggle`, doing exactly what the record
      button beside it does. A separate action would have been the same three writes under a second
      name, and a way to hide the notice while still being recorded.
    */
    /*
      No `togglePanel` or `toggleExtractionPanel` any more.

      They were the launchers' actions, and a launcher exists now only for a press that does
      something other than open one panel. A panel's rail button is derived from the panel: the host
      reads `open` and calls `show` or `close`, so a toggle here would be a third spelling of the
      same two writes. `openPanel` / `closePanel` above are those two keys.
    */
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
    extract: action(
      () => runExtraction(collectionId() ?? ''),
      'Runs one extraction pass over the call this agent is transcribing.',
    ),
    /**
     * The same pass over any call's record, named by id.
     *
     * The reachable form, and the one the calls list uses. {@link extract} can only ever mean "the
     * call I am in and transcribing", because `collectionId` is cleared the moment the call ends —
     * so a finished call, or one somebody else recorded, had no way to be extracted at all. The
     * gathering was never the limit: it drills down through the collection's children and so has
     * always read every agent's utterances, not only this one's.
     */
    extractCollection: action(
      (collection: string) => runExtraction(collection),
      'Runs one extraction pass over any call’s record, by id.',
    ),
    /** Re-read what is staged. Called after a pass; exposed so a panel can refresh on open. */
    /**
     * Re-read what is staged on a call, or on the live one when given nothing.
     *
     * Rarely needed now that reading a key fetches it: this is for asking *again* — after a pass
     * somebody else ran, or a card that looks stale. It bypasses the once-per-key guard on purpose.
     */
    refreshProposals: action(
      (collection?: string) => loadProposals(collection),
      'Re-reads what is staged on a call, or on the live one.',
    ),
    /**
     * Keep a suggestion, or drop it.
     *
     * Removed from the list on success rather than by re-reading it. A re-read is a second round
     * trip during which the row a person is looking at can move, and the answer is already known:
     * a resolved overlay is gone. `false` means somebody else resolved it first — the record is
     * still out of the list either way, so it drops locally without complaint.
     */
    /**
     * Keep a suggestion — as proposed, or as edited.
     *
     * ## Why the edit is applied *after* the accept, never before
     *
     * Accepting means "the LLM's staged value becomes the real, human-owned value, and the overlay
     * is deleted". So a write made first is a write the accept then overwrites, silently, with the
     * model's version — the edit would appear to work and be gone a tick later.
     *
     * Ordering it this way also lands on the right side of the executor's own rule: deleting the
     * overlay *is* the lock. Once it is gone the divergence gate treats the record as human-owned,
     * so a later pass over the same conversation will not quietly overwrite what was typed here.
     *
     * There is no window worth worrying about for a `create`, which is the common case: the engine
     * writes real values whenever no human owns them, so the record has been on the board with the
     * model's wording since the pass ran. The accept changes nothing visible and the edit lands
     * immediately after it.
     *
     * A failed update leaves the suggestion accepted rather than rolling back, and says so. That is
     * the honest state — the decision was recorded and only the wording did not land — and the
     * record is now an ordinary one the reviewer can edit anywhere it appears.
     */
    acceptProposal: action(async (id: string) => {
      if (!interpretation) return;
      const edited = editingProposal() === id ? changedFields(id) : null;
      /*
        "Accept all" on a change comes through here too, so the same read has to happen first —
        and only for a change: a *create* has no previous values, and reading a record that does not
        exist yet would be a round trip to learn nothing.
      */
      const proposal = allProposals().find((p) => p.id === id);
      const amending = proposal?.kind === 'update' ? proposal : null;
      const before = amending ? await readBeforeChange(amending) : null;
      await interpretation.accept(id, undefined, callTarget());
      const entity = proposal?.entity;
      forgetProposal(id);
      if (amending) {
        await recordAmendments(
          amending,
          amending.fields.map((f) => f.name),
          before,
          edited,
        );
      }
      // Only if the draft belonged to *this* card. Keeping one suggestion must not throw away what
      // was typed into another one that happens to be open beside it.
      if (editingProposal() === id) closeProposalEdit();
      if (!edited || !entity || !updateEntity) return;
      try {
        // The call's space, exactly as the accept just used — a call outlives the space on screen.
        await updateEntity(entity, id, edited, callTarget());
      } catch (error) {
        console.warn('transcribe: kept the suggestion but could not apply the edit —', error);
      }
    }, 'Keeps a suggestion, as proposed or as edited.'),
    /** Open one suggestion for editing, seeded with what the model proposed. */
    editProposal: action((id: string) => {
      const proposal = allProposals().find((p) => p.id === id);
      if (!proposal) return;
      setProposalDraft(Object.fromEntries(proposal.fields.map((f) => [f.name, f.value])));
      setEditingProposal(id);
    }, 'Opens one suggestion for editing, seeded with what the model proposed.'),
    /** Set one field of the open draft. Takes the name, so one action serves every control. */
    setProposalField: action(
      (name: string, value: string) => setProposalDraft({ ...proposalDraft(), [name]: value }),
      'Sets one field of the open draft, by property name.',
    ),
    /** Close the open draft, discarding what was typed. */
    cancelProposalEdit: action(() => closeProposalEdit(), 'Closes the open draft, discarding what was typed.'),
    /**
     * Apply one suggested change to an agreed record: the staged value becomes the real one.
     *
     * Per field, because a suggested change is often half right — the new due date, but not the
     * reassignment that came with it. The executor accepts a single property of an overlay, so the
     * rest stays staged for a separate answer.
     */
    applyChange: action(async (id: string, field: string) => {
      if (!interpretation) return;
      // Before the accept, which overwrites the value this is the only remaining copy of.
      const proposal = allProposals().find((p) => p.id === id);
      const before = proposal ? await readBeforeChange(proposal) : null;
      await interpretation.accept(id, field, callTarget());
      forgetField(id, field);
      if (proposal) await recordAmendments(proposal, [field], before);
    }, 'Applies one suggested change to an agreed record.'),
    /** Dismiss one suggested change, leaving the record's value as it was. */
    dismissChange: action(async (id: string, field: string) => {
      if (!interpretation) return;
      await interpretation.reject(id, field, callTarget());
      forgetField(id, field);
    }, 'Dismisses one suggested change, leaving the record as it was.'),
    rejectProposal: action(async (id: string) => {
      if (!interpretation) return;
      await interpretation.reject(id, undefined, callTarget());
      forgetProposal(id);
      // Whatever was typed into it went with it. Leaving the draft open would leave a card's worth
      // of edits attached to an id that no longer resolves.
      if (editingProposal() === id) closeProposalEdit();
    }, 'Drops a suggestion.'),
    /**
     * Write something a person typed into the transcript, at the moment they typed it.
     *
     * ## Why it is the same kind of record as an utterance
     *
     * A transcript is one timeline ordered by `createdAt`, and a schema cannot merge two queries
     * into one — so a message kept in its own entity could only ever be listed *beside* the
     * conversation rather than *in* it, which is not what somebody typing during a meeting means.
     * It is a `TextBlock` among the utterances, and `source` is what stops it passing as one.
     *
     * Attribution stays correct for free: the writer is the author, exactly as a speaker is the
     * author of what their own microphone heard.
     *
     * Written into the **call's** space rather than the space on screen, for the reason every other
     * write here is: a call outlives the reader's navigation, and a message landing in whichever
     * space somebody had wandered to would be a remark about a meeting, filed somewhere else.
     *
     * `collection` is named by the caller because the composer is no longer only about the call
     * being recorded: a transcript on screen is a transcript somebody can write into, and which one
     * that is, is a question the panel has already answered for every other row it draws. Omitted,
     * it falls back to the call in progress — the call's own record, which exists from its first
     * second, since a message does not need somebody to have spoken first and `collectionId` is
     * null until they have.
     */
    addMessage: action(async (collection: string, text: string) => {
      const words = String(text ?? '').trim();
      if (!words || !createEntity) return;
      const target = collection || targetCollection();
      if (!target) return;
      /*
        The call's dataset only when the target IS the call in progress.

        A live call in one space outlives a reader who walks to another, so `myCall().datasetUri`
        answers for the meeting being recorded rather than for the transcript on screen. Naming it
        unconditionally would send a message about a past call in *this* space to whichever space
        the live one is running in, where the record it names does not exist.
      */
      const dataset = target === targetCollection() ? (myCall()?.datasetUri ?? undefined) : undefined;
      await createEntity(
        'TextBlock',
        { text: words, source: TYPED },
        { parent: { id: target, predicate: CHILDREN_PREDICATE }, ...(dataset ? { dataset } : {}) },
      );
      /*
        Not awaited, because the composer is waiting on this promise to say it has finished.

        The roster entry is a second write, and nothing the person is looking at depends on it —
        where the standing effect on the call's roster already spells it `void` for that reason.
        Awaited here it put a whole extra round trip between the press and the spinner stopping, and
        on a shared remote executor that is the difference people notice.

        It only ever cost anything on the first message: the guard inside is keyed on the collection,
        so every message after the first returned immediately. But the first message is the one
        somebody is deciding whether the composer works at all.

        Losing it is not a risk worth carrying either way — it has its own try/catch, and a failure
        clears the guard so the next message retries.
      */
      void recordSelfParticipation(target, dataset);
    }, 'Writes something a person typed into a transcript, as a typed line.'),
    /**
     * Fix the words on a line of the transcript.
     *
     * ## Why anybody may, and what is recorded
     *
     * A recogniser mishears names, jargon and anybody with a cold, and the person best placed to
     * fix it is whoever notices — often not the speaker. A shared record every member can write to
     * makes that possible already; refusing it in the UI would only mean the transcript stays wrong.
     *
     * What is not acceptable is the correction being invisible. A mended line that still reads as a
     * verbatim quote is a claim nobody checked, so `spoken` becomes `corrected` and the panel says
     * so. Editing something `typed` leaves it `typed` — correcting your own writing is not a
     * correction *of a transcript* — and something already `corrected` stays that way.
     *
     * `was` is passed in rather than read, because a module's data surface is write-only by design
     * (see `transcriptTurns`) and the panel is holding the row already.
     */
    editUtterance: action(async (id: string, text: string, was?: string) => {
      const words = String(text ?? '').trim();
      if (!id || !words || !updateEntity) return;
      await updateEntity(
        'TextBlock',
        id,
        { text: words, ...(was === SPOKEN ? { source: CORRECTED } : {}) },
        // The call's space, as every other write here. `callTarget` answers with it or undefined.
        callTarget(),
      );
    }, 'Corrects the words on a line of the transcript, marking a spoken line as corrected.'),
    /** Write what has been heard so far without waiting for the buffer to fill. */
    flushNow: action(() => flush(), 'Writes what has been heard so far without waiting for the buffer to fill.'),
    /**
     * Count an utterance of `samples` 16 kHz samples as sent to the model. Exposed for tests, which
     * cannot run the audio graph that normally does it — the `receiveText` of `transcribing`.
     */
    markUtteranceSent: (samples: number) => noteFed(samples),
    /** End the session now, flushing and releasing the audio graph. Exposed for tests. */
    stopNow: () => stop(),
  };
}
