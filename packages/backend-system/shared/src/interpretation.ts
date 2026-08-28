/**
 * Turning what was said into typed records — as a capability, not a model to administer.
 *
 * `RuntimeAdminPort` already knows about LLMs: it lists them, adds them, downloads them and picks a
 * default. What it cannot do is *use* one against a dataset's own schema. That is the same gap
 * {@link TranscriptionPort} was created to close for speech, and it has the same consequence — the
 * transcribe module cannot reach interpretation without importing `@coasys/ad4m` directly and
 * declaring `backends: ['ad4m']`, which is the coupling the module contract exists to prevent.
 *
 * ## Why the caller supplies the turns
 *
 * The obvious shape — `interpret(dataset)` — would have the backend find the text itself. It is
 * wrong for the same reason `TranscriptionPort` does not own utterance segmentation: only the
 * caller knows what it is pointing at. A transcript is a call's children; a channel is a query; a
 * document is a subtree. Encoding any one of those here would make the port mean "interpret the
 * thing the transcribe module happens to write", and the second caller would need a second method.
 *
 * The backend can also gather its own turns on a standing watch — see {@link InterpretationPort.watch}
 * — but that is a different operation with different failure modes, not this one with a default.
 *
 * ## Why `classes` is required
 *
 * The class list is the real control surface, and making it optional would invite the one call
 * nobody should make. Every selected class puts its **whole shape** into the prompt — every
 * property, hinted or not — so cost and quality both degrade with the size of the list, and a class
 * carrying layout fields (a text block's `style`, `level`, `marks`) offers the
 * model a dozen fields it should never fill. "Interpret against everything installed" is not a
 * convenient default; it is the failure mode.
 *
 * ## Proposals, not writes
 *
 * A backend that supports provenance may stage the model's output rather than committing it, when a
 * value already has a human author. Those staged values surface through {@link InterpretationPort.proposals}
 * and are resolved with {@link InterpretationPort.accept} / {@link InterpretationPort.reject}. A
 * backend without that gate returns an empty proposal list and writes directly — callers must treat
 * an empty list as "nothing pending", never as "not supported", because the two are indistinguishable
 * and only one of them is worth telling a user about.
 */

import type { DatasetHandle } from './dataSource';
import type { InterpretationActivity } from './interpretationActivity';

/**
 * One thing somebody said.
 *
 * `timestamp` is not decoration: it is what makes a turn *identifiable*, so a backend keeping a
 * processed-turn cursor can tell a re-gathered turn from the same words said again an hour later.
 * Sent as an ISO-8601 string rather than a number because that is what both sides already store.
 */
export interface TranscriptTurn {
  /** Who said it — an agent id (DID). */
  speaker: string;
  text: string;
  /** ISO-8601. */
  timestamp: string;
}

/** Where interpreted instances go, and what may be created. */
export interface InterpretationRequest {
  /**
   * Entity names to materialise, by the host's vocabulary (`'TaskBlock'`) rather than a backend URI —
   * the adapter resolves them, exactly as the query layer resolves entity names.
   *
   * Required, and deliberately so; see the note on the module docs.
   */
  classes: string[];
  /**
   * Attach what gets created to an existing node, through one of its to-many relations.
   *
   * Without this, interpretation produces valid records that no route lists — a task with no parent
   * is real, queryable, and invisible in a UI that reaches content by traversal. Mirrors the
   * `parent` option on the module contract's `createEntity` for the same reason.
   */
  parent?: { id: string; predicate: string };
  /**
   * URI namespace new instances are minted under. Backend-specific and usually best left to the
   * adapter, which derives one from `parent` so a call's extractions are confined to that call.
   */
  basePrefix?: string;
}

export interface InterpretationResult {
  /**
   * How many turns the pass actually read.
   *
   * Reported because without it "nothing was extracted" and "there was nothing to extract from" are
   * the same empty result, and they need opposite responses from a user: one means the conversation
   * had no commitments in it, the other means the transcript never arrived. Every layer between the
   * transcript and the model can drop turns silently — a wrong containment predicate, an unreadable
   * timestamp, a collection that is not the one being displayed — and each of those failures looks
   * exactly like a quiet meeting.
   */
  turns: number;
  /** Ids of the instances created or updated by this pass. Empty is a valid, common answer. */
  ids: string[];
  /**
   * Ids among {@link ids} whose values are staged rather than committed, awaiting accept/reject.
   * Always a subset of `ids`; empty from a backend with no provenance gate.
   */
  proposed: string[];
}

/** A staged suggestion waiting on a human. */
export interface InterpretationProposal {
  /** The instance the suggestion sits on. */
  id: string;
  /** Whether the model authored the whole instance, or proposed changes to an existing one. */
  kind: 'create' | 'update';
  /**
   * Proposed values, keyed by the host's property name (`'title'`) rather than the backend
   * predicate — so a UI can render "title: Ship the docs" without knowing what `we://title` is.
   * Properties the adapter cannot map back to a name are omitted rather than shown raw.
   */
  values: Record<string, unknown>;
}

/** A standing watch that interprets new turns as they arrive, without anyone pressing anything. */
export interface WatchRequest extends InterpretationRequest {
  /** Stable id for this watch, unique within the dataset. Re-registering the same id is idempotent. */
  watchId: string;
  /** Quiet window (ms) after the last new turn before a pass runs. */
  debounceMs?: number;
  /** Wait for at least this many new turns before running. */
  batchMin?: number;
  /** Cap on turns per pass. */
  batchMax?: number;
}

export interface InterpretationPort {
  /**
   * Whether this backend can interpret at all — as opposed to being able to, with no model
   * configured. Two different sentences to a user: "this node cannot do that" and "set up an LLM".
   *
   * Optional for the same reason as {@link TranscriptionPort.available}: the host always hands
   * modules a forwarding wrapper, which would otherwise make every "cannot interpret" branch dead
   * code.
   */
  available?(): boolean;

  /**
   * Ask the **backend** whether it can interpret, rather than asking the client library.
   *
   * Exists because `available()` cannot answer honestly on its own. A client bundles a library
   * whose methods exist whether or not the node it dials implements them, so a synchronous probe
   * can only ever report "my own code has this function" — which is true on every node, including
   * one that will refuse the call. That is not a hypothetical: it shipped, and a WE deployment
   * offered Extract against a node whose executor predated the feature, failing with a raw RPC
   * error where the whole point of `available()` was to prevent exactly that.
   *
   * Asynchronous because the only honest answer involves a round trip. Implementations should make
   * that trip with the cheapest *read* in the same feature set — never by starting a real pass,
   * which on this port means an LLM call — and should cache it, since the answer is a property of
   * the node and changes only when it is rebuilt.
   *
   * A host calls this when the dataset changes and feeds the result back through `available()`.
   * Optional, and a backend that omits it is taken at its word: absent, `available()` is all there
   * is, which is the pre-existing behaviour.
   *
   * Returning `false` means "this node cannot interpret at all" — a different sentence from "no
   * model is configured", which remains `available()`'s to report.
   */
  checkAvailability?(dataset: DatasetHandle): Promise<boolean>;

  /**
   * Run one interpretation pass over turns the caller supplies.
   *
   * Rejects rather than returning empty when the backend has no usable model, so a caller can tell
   * "no LLM configured" from "nothing worth extracting was said" — indistinguishable from the result
   * alone, and only one of them is the user's problem to fix.
   */
  interpret(
    dataset: DatasetHandle,
    turns: TranscriptTurn[],
    request: InterpretationRequest,
    ctl?: { signal?: AbortSignal },
  ): Promise<InterpretationResult>;

  /** Everything currently staged in this dataset. Empty means nothing pending — see the module docs. */
  proposals(dataset: DatasetHandle): Promise<InterpretationProposal[]>;

  /**
   * Commit a staged suggestion: the whole instance, or one property of it by host-facing name.
   *
   * Returns whether anything changed, so a UI acting on a proposal another agent already resolved
   * can say so instead of silently doing nothing.
   */
  accept(dataset: DatasetHandle, id: string, property?: string): Promise<boolean>;

  /**
   * Drop a staged suggestion. Rejecting a `'create'` removes the instance; rejecting an `'update'`
   * leaves the existing value alone.
   */
  reject(dataset: DatasetHandle, id: string, property?: string): Promise<boolean>;

  /**
   * Report passes as they run, rather than only when they finish.
   *
   * Covers both surfaces: a pass started by {@link interpret} and a pass a standing {@link watch}
   * ran on its own. That is the point of it being one subscription rather than a callback on each
   * — a UI showing "what is being extracted right now" should not care which of the two started
   * the work, and a user watching a call cannot tell anyway.
   *
   * Returns an unsubscribe. Optional, and feature-detected separately from everything else here: a
   * backend can interpret perfectly well and have no event stream at all, in which case a host
   * falls back to the local spinner it had before.
   *
   * ## Scope
   *
   * Only what this node can see. On a backend whose event streams are local to the executor — AD4M
   * is one — that means this peer's own passes, even for a watch shared across a neighbourhood.
   * Making peers visible to each other is a *host* concern, layered on top: see
   * `createInterpretationRelay`, which broadcasts what this returns and merges what peers send
   * back. Pushing it down here would ask every backend to reimplement a fan-out it may have no
   * primitive for.
   *
   * @param detail Ask for the raw prompt and response on {@link InterpretationActivity.llm}.
   *   Off by default: it is tens of KB per pass and only worth carrying while somebody is looking
   *   at it. A backend that cannot supply it — or that is reporting somebody else's pass, where the
   *   payload never left the other machine — omits it, so a consumer must treat an absent exchange
   *   as "not available" rather than as an empty prompt.
   *
   *   Note that on some backends this is a *registration-time* switch on the watch rather than a
   *   per-subscriber one, so a host that wants it available on demand enables it when the watch is
   *   created and decides here whether to forward it. That is a cost worth paying once: it is
   *   local traffic, while the alternative is re-registering a shared watch to answer one person
   *   opening a disclosure triangle.
   */
  observe?(
    dataset: DatasetHandle,
    cb: (activity: InterpretationActivity) => void,
    options?: { detail?: boolean },
  ): Promise<() => void>;

  /**
   * Register a standing watch. Optional and separately feature-detected from `interpret`, because a
   * backend can plausibly do one-shot interpretation and not the coordination a shared watch needs
   * (deciding which peer runs a pass, and not running it twice).
   */
  watch?(dataset: DatasetHandle, request: WatchRequest): Promise<void>;
  /** Stop a watch registered with {@link watch}. */
  unwatch?(dataset: DatasetHandle, watchId: string): Promise<void>;
  /**
   * Attach anything a watch produced that is not attached yet, and report how many were.
   *
   * Exists because a standing pass can complete with nobody there to finish it: a backend whose
   * engine mints instances without linking them relies on a client to write the edge, and the
   * client that would have done it may simply not have been running. Optional, because a backend
   * that parents server-side has nothing to reconcile.
   */
  reconcile?(dataset: DatasetHandle, request: InterpretationRequest): Promise<number>;
}
