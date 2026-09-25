/**
 * The interpretation kernel — turning what was said into typed records, with the dataset bound.
 *
 * A **kernel** is a host capability a module asks for by name (`manifest.requires.kernels`) and is
 * handed through `deps.kernels`. This one grew inside the deps bag as fourteen members shaped by one
 * module, which is how the bag came to describe a boards concept in the middle of a contract about
 * transcription. It is the same fourteen members, in their own file, declared as what they are.
 *
 * Narrowed the way every kernel is: the host knows which space the module is running in, so a module
 * that had to pass a dataset handle could only get it wrong. What is left is what a feature actually
 * does — run a pass, keep one running, and resolve what a pass proposed.
 *
 * `watch` is deliberately absent. A standing watch is a *dataset-level* registration that outlives the
 * module instance that made it and coordinates across peers; handing that to a module store whose
 * lifetime is a panel being open invites a watch per mount. It belongs to the host, and
 * {@link InterpretationKernel.watchCollection} is a module *naming* a collection worth watching while
 * holding nothing.
 */
import type { InterpretationProposal, InterpretationResult } from '@we/backend-shared';

import type { DatasetTarget } from './module';

export interface InterpretationKernel {
  /** Whether interpretation can run at all — false when the backend has no model configured. */
  available: () => boolean;
  /**
   * Whether this community has automatic extraction switched on.
   *
   * A different question from {@link available}, and both have to be asked: `available` is what this
   * *node* can do, this is what the space has *decided*. Reactive, so a standing watch follows the
   * setting while a call is running.
   *
   * Takes a collection, because the answer is per call: the community's standing decision is the
   * default and the people in one conversation may turn it off for that conversation. Called with no
   * id it answers for the space.
   */
  autoEnabled: (collectionId?: string) => boolean;
  /**
   * Turn automatic extraction on or off for one call, for everyone in it.
   *
   * A **group** decision recorded beside the call, exactly as {@link setTarget} is and for the same
   * reason: the standing watch is one registration the whole neighbourhood shares. Does not stop a
   * pass already in flight. Rejects on a host that cannot record it, so a module can offer the
   * affordance only where it means something.
   */
  setAuto: (collectionId: string, on: boolean) => Promise<void>;
  /**
   * What this call extracts, and what else it could — one row per model, ticked when it is on.
   *
   * Handed the answer rather than the inputs: three layers decide it (which entities are candidates,
   * which the space starts with, which the call's participants chose) and a module has no read
   * surface for any of them. Reactive, and read on every call rather than captured. Empty means
   * nothing here may be extracted — an honest answer, to render as such.
   */
  targets: (collectionId: string) => { entity: string; selected: boolean }[];
  /**
   * Add or remove one model from what this call extracts — a group decision, taking effect from here
   * on. Rejects on a host that cannot record it.
   */
  setTarget: (collectionId: string, entity: string, on: boolean) => Promise<void>;
  /**
   * Interpret a collection's children, attaching what is created back onto that same collection.
   *
   * Takes an id rather than the turns themselves: the host gathers them, which is also where the
   * knowledge belongs, since assembling turns means knowing how a collection is laid out. Rejects
   * when there is no usable model, so a caller can tell "no LLM here" from "nothing worth extracting".
   */
  runOnCollection: (collectionId: string) => Promise<InterpretationResult>;
  /**
   * Keep interpreting a collection as it grows. A module names a collection and holds nothing: the
   * watch id, the dataset and the lifetime are the host's. Registering twice is one registration.
   * Rejects on a backend that cannot coordinate a shared watch.
   */
  watchCollection: (collectionId: string) => Promise<void>;
  /** Stop the watch on a collection. Safe to call when none was registered. */
  unwatchCollection: (collectionId: string) => Promise<void>;
  /**
   * Attach anything a standing pass produced but did not attach, and report how many. Returns 0 where
   * there was nothing to repair.
   */
  reconcileCollection: (collectionId: string) => Promise<number>;
  /**
   * A pass has left records on this collection; let the host do whatever follows from that.
   *
   * Named for what happened rather than for what follows, because what follows is the host's business
   * and changes. Called after a pass rather than when somebody opens a route, because what follows can
   * write records into a space everybody shares, and a pass runs on exactly one node. Idempotent.
   */
  passSettled: (collectionId: string) => Promise<void>;
  /**
   * What extraction is doing in this space right now — this agent's passes and its peers'.
   *
   * Read-only and reactive. Empty is the ordinary case and means "nothing is running" rather than
   * "not supported". A module may read this and cannot start, stop or subscribe to anything.
   */
  activity: () => InterpretationActivitySummary[];
  /**
   * A count that moves whenever the suggestions staged in this space may have changed. Read-only and
   * reactive; it says only *that*, never what. Optional so a host that predates it type-checks.
   */
  proposalsRevision?: () => number;
  /**
   * Suggestions staged in a dataset, awaiting a human.
   *
   * `target` names which dataset — absent means the space on screen. `collection` narrows it to what
   * was staged on that collection's contents, and a review surface about one conversation should
   * always pass it.
   */
  proposals: (target?: DatasetTarget, collection?: string) => Promise<InterpretationProposal[]>;
  /**
   * Commit a staged suggestion — the whole record, or one property by name. Resolves `false` when it
   * is no longer staged, which in a shared space usually means somebody else settled it first.
   */
  accept: (id: string, property?: string, target?: DatasetTarget) => Promise<boolean>;
  /** Drop a staged suggestion. Resolves `false`, like {@link accept}, when it is no longer staged. */
  reject: (id: string, property?: string, target?: DatasetTarget) => Promise<boolean>;
}

/**
 * One running or finished extraction pass, as a module sees it.
 *
 * Every field is a string or a boolean because the consumer is a schema, which has no arithmetic and
 * no date formatting — the host computes `label` and `elapsed`. Deliberately not the host's own view
 * type: this is the subset a module can act on, which is also all of it that means anything outside
 * the shell.
 */
export interface InterpretationActivitySummary {
  passId: string;
  /** The runner's agent id, or `''` when the backend could only say somebody is working. */
  runner: string;
  /** Their display name, never blank — a sentence subject, so it falls back to "Someone". */
  name: string;
  avatar: string;
  /** Whether this agent is running the pass. Only a pass of this agent's can carry `prompt` or `response`. */
  mine: boolean;
  /** True while the pass is in flight. */
  running: boolean;
  /** A whole clause: "Anna is waiting on the model", "Extracted 3 records". */
  label: string;
  /** `m:ss` since the pass started, empty once it has settled. */
  elapsed: string;
  /** When it settled, ISO-8601. Empty while running. */
  finishedAt: string;
  /** Why, for a pass that skipped or failed. Empty otherwise. */
  detail: string;
  prompt: string;
  response: string;
  /** Whether there is anything behind a disclosure. */
  hasDetail: boolean;
  /** Whether the row should offer to open — `hasDetail`, and settled or running long enough to matter. */
  openable: boolean;
}
