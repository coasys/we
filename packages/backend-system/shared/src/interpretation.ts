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
 * carrying serialization fields (a Lexical block's `indent`, `textFormat`, `listType`) offers the
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
   * Register a standing watch. Optional and separately feature-detected from `interpret`, because a
   * backend can plausibly do one-shot interpretation and not the coordination a shared watch needs
   * (deciding which peer runs a pass, and not running it twice).
   */
  watch?(dataset: DatasetHandle, request: WatchRequest): Promise<void>;
  /** Stop a watch registered with {@link watch}. */
  unwatch?(dataset: DatasetHandle, watchId: string): Promise<void>;
}
