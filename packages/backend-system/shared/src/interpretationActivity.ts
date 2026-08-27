/**
 * What an interpretation pass is doing, while it is doing it.
 *
 * Sibling to `interpretation.ts`, which is the *verb* side of the same capability: `interpret()`
 * runs a pass and resolves when it is over. This is the running commentary — who started one, how
 * far it has got, and what the model was actually asked.
 *
 * ## Why a pass needs a commentary at all
 *
 * Because the wait is long enough to look like a hang. A pass on a local model is seconds to
 * minutes, almost all of it inside one LLM call, and both existing surfaces report only the ends:
 * `interpret()` resolves at the end, and a standing watch has no return value at all. A user who
 * pressed Extract sees a spinner; a user in a call whose neighbour pressed it sees nothing
 * whatsoever. Neither can tell a slow model from a dead one.
 *
 * ## Why `mine` exists, and why it is not a detail
 *
 * A pass runs on exactly one peer. In a shared space that peer is chosen by an *election* — whoever
 * wins the claim — so which member ends up holding the rich view of a pass is arbitrary. Everyone
 * sees the row; only the runner can see inside it, and only the runner's backend can produce the
 * inside. {@link InterpretationActivity.mine} is how a UI tells those apart without asking the
 * backend a second question, and it is the difference between "expand for details" being an
 * affordance and being a broken button for everybody but one person.
 *
 * The asymmetry is the backend's, not ours: AD4M's fine-grained step stream is DID-filtered while
 * its neighbourhood stream is perspective-scoped, and neither crosses machines on its own. A host
 * that wants peers to see each other's passes relays them — see `interpretationRelay.ts`, which
 * does exactly that over {@link EphemeralPort} and sets `mine: false` on what it receives.
 *
 * ## Why the LLM payload is separate from the phase
 *
 * {@link InterpretationActivity.llm} is tens of KB and interesting for about five minutes, while
 * the phase is a few dozen bytes and is what every viewer needs. Keeping them in one object but
 * populating the payload only on request is what lets a host broadcast the cheap half continuously
 * and fetch the expensive half when somebody actually opens the row.
 *
 * Worth saying plainly, because it is easy to assume otherwise: withholding the prompt from peers
 * is **not** a confidentiality measure. In a call the prompt is built from the transcript every
 * participant already holds. It is withheld because it is bulky and ephemeral, which means a host
 * may reasonably choose to share it — see `detail` on {@link InterpretationPort.observe}.
 */

/**
 * How far a pass has got, in terms a UI can render without knowing which backend produced it.
 *
 * Seven phases rather than AD4M's thirteen steps, and the collapsing is deliberate: a person
 * watching a bar wants to know whether to keep waiting, and `backedOff` / `notCandidate` /
 * `awaitingAuthor` are three ways of saying "not on this machine, nothing to watch here". A
 * backend with fewer states than this reports the ones it has; a backend with more maps them in.
 */
export type InterpretationPhase =
  /** A pass is starting — claimed, or about to be. Nothing has been read yet. */
  | 'queued'
  /** Reading the turns to interpret. Fast, and absent entirely on a one-shot pass where the caller
   *  supplied them. */
  | 'gathering'
  /**
   * Waiting on the model.
   *
   * The one phase that matters, because it is essentially the entire duration. A UI that
   * distinguishes no other phase should distinguish this one — it is the difference between "still
   * going" and "stuck", and it is where an elapsed timer earns its place.
   */
  | 'thinking'
  /**
   * The response arrived and is being planned and written.
   *
   * Usually brief, and not reliably so: on AD4M this spans dedup resolution, planning, a subject
   * write per instance, several batch commits and the provenance overlay, none of which reports
   * progress and all of which contend with whatever else is writing to the perspective — a live
   * transcription, say. A pass has sat here for minutes. A UI should keep the elapsed clock running
   * through it rather than treating it as the last frame before `done`.
   */
  | 'writing'
  /** Finished, and {@link InterpretationActivity.ids} says what it wrote. May be empty — a
   *  conversation with nothing extractable in it is an ordinary outcome, not a failure. */
  | 'done'
  /**
   * The pass correctly decided there was nothing to do: no turns, or a class shape that has not
   * synced yet. `detail` says which.
   *
   * Deliberately not merged with `failed`. "Nothing to extract" and "the model was unreachable"
   * look identical in a result and send a user to opposite places — one to re-read the
   * conversation, the other to their model settings.
   */
  | 'skipped'
  /** The pass ran and broke: the model errored, timed out, or a write failed. `detail` says why. */
  | 'failed';

/** The raw model exchange for one pass. Present only when a consumer asked for it. */
export interface InterpretationLlmExchange {
  /** What the model was asked, verbatim. Arrives at `thinking`. */
  prompt?: string;
  /** What it answered, verbatim and unparsed. Arrives at `writing`. */
  response?: string;
}

/** One pass, at one moment. Consumers replace the previous value for the same `passId`. */
export interface InterpretationActivity {
  /**
   * Stable identity for this pass, for as long as it runs.
   *
   * Every update for one pass carries the same value, so a consumer keeps a map rather than a log
   * — which is what makes "2 passes running" a count of rows rather than a count of events.
   */
  passId: string;
  /** The watch or collection this pass belongs to, where the backend knows. Lets a UI show only
   *  the passes relevant to what the user is looking at. */
  watchId?: string;
  /**
   * Who is running it, as an agent id.
   *
   * Absent when the backend can report that a pass is happening but not whose it is. A UI must
   * treat that as "somebody" rather than as "me" — defaulting the other way would put a stranger's
   * work under the current user's name.
   */
  runner?: string;
  /**
   * Whether this peer is the one running the pass.
   *
   * Not derivable from `runner` alone by a consumer that does not know its own id, and load-bearing
   * beyond display: only a pass with `mine: true` can ever populate {@link llm}, so this is what a
   * UI checks before offering to show the details. See the module docs.
   */
  mine: boolean;
  phase: InterpretationPhase;
  /** When this update was produced, as epoch ms. What an elapsed timer counts from, and what lets
   *  a consumer expire a row whose runner went offline mid-pass. */
  at: number;
  /** Ids written by the pass. Present on `done`; empty is valid and common. */
  ids?: string[];
  /** Human-readable context for `skipped` and `failed` — already a sentence, not a code. */
  detail?: string;
  /** The model exchange, when a consumer asked for it and this is its own pass. */
  llm?: InterpretationLlmExchange;
}

/**
 * How long a row may go without an update before a consumer should stop believing it.
 *
 * A pass is reported by the peer running it, so a runner that closes its laptop mid-pass takes the
 * `done` with it and every other peer shows work in progress forever. There is no way to
 * distinguish that from a slow model except by waiting, so this is a bound on how long "slow" is
 * allowed to look like "alive".
 *
 * Ten minutes, matching nothing in particular except the observation that a local model summarising
 * a long call can genuinely take that long, and that showing a stale row is a smaller failure than
 * clearing a live one out from under someone.
 */
export const INTERPRETATION_ACTIVITY_TTL_MS = 10 * 60 * 1000;

/**
 * Fold a newer exchange into an older one, keeping whatever the newer one does not supply.
 *
 * Object spread cannot do this, and the difference is not academic: it copies keys that are present
 * *and* undefined, so `{...{prompt:'x', response:undefined}, ...{prompt:undefined, response:'y'}}`
 * silently drops the prompt. That is exactly the shape the AD4M adapter produces — `llmRequestSent`
 * carries an input and no output, `llmResponseReceived` the reverse — so a plain spread lost the
 * prompt at the moment the response arrived to be compared against it.
 *
 * Worth stating because the naive version passes a test written with the keys absent rather than
 * undefined, which is a shape nothing actually emits.
 */
function mergeExchange(
  previous: InterpretationLlmExchange | undefined,
  update: InterpretationLlmExchange | undefined,
): InterpretationLlmExchange | undefined {
  if (!previous && !update) return undefined;
  const merged: InterpretationLlmExchange = { ...previous };
  if (update?.prompt !== undefined) merged.prompt = update.prompt;
  if (update?.response !== undefined) merged.response = update.response;
  return merged;
}

/** Whether a phase means the pass is over, whatever the outcome. */
export function isSettled(phase: InterpretationPhase): boolean {
  return phase === 'done' || phase === 'skipped' || phase === 'failed';
}

/**
 * Whether a row should still be believed at `now`.
 *
 * Settled rows never go stale — they are a result, and a result stays true. Only a pass still
 * claiming to be in flight can be lying about it.
 */
export function isStale(activity: InterpretationActivity, now: number, ttl = INTERPRETATION_ACTIVITY_TTL_MS): boolean {
  return !isSettled(activity.phase) && now - activity.at > ttl;
}

/**
 * Ordering for a list of passes: running first, then most recent.
 *
 * Running-first because a settled row is a receipt and a running one is a thing you are waiting on,
 * and the wait is the reason the surface exists. Within each group, newest first.
 */
export function byActivityInterest(a: InterpretationActivity, b: InterpretationActivity): number {
  const settled = Number(isSettled(a.phase)) - Number(isSettled(b.phase));
  return settled !== 0 ? settled : b.at - a.at;
}

/**
 * Fold an update into a keyed set of rows, and report what the set now holds.
 *
 * Shared by every consumer — the port adapter merging two backend streams, the relay merging peers,
 * the host store feeding the UI — because the merge rule is the same in all three and getting it
 * subtly different in each is how a row ends up flickering between two phases.
 *
 * ## The rule
 *
 * A later update replaces an earlier one for the same `passId`, **except** that a settled phase is
 * never overwritten by an unsettled one. Without that exception, ordinary event interleaving
 * reopens finished rows: AD4M emits `processed` on one stream and `finished` on the other, and the
 * relay can deliver a peer's `thinking` after its `done` on a lossy transport. Both would show a
 * completed pass as running again.
 *
 * Payload accumulates rather than replacing: `llm.prompt` arrives at `thinking` and
 * `llm.response` at `writing`, so a plain overwrite would drop the prompt at the moment the
 * response made it worth reading. Same for `ids` and `detail`, which arrive once and must survive
 * every later update for that pass.
 */
export function mergeActivity(
  rows: Map<string, InterpretationActivity>,
  update: InterpretationActivity,
): InterpretationActivity {
  const previous = rows.get(update.passId);

  if (previous && isSettled(previous.phase) && !isSettled(update.phase)) {
    // Keep the settled row, but still take any payload the late update carried — a `processed`
    // that arrives after a `finished` is exactly how the ids show up.
    const kept: InterpretationActivity = {
      ...previous,
      ids: update.ids ?? previous.ids,
      llm: mergeExchange(previous.llm, update.llm),
    };
    rows.set(kept.passId, kept);
    return kept;
  }

  const merged: InterpretationActivity = {
    ...previous,
    ...update,
    // `mine` is asserted by whoever produced the row and must not be downgraded by a later update
    // from a different source: the relay marks a peer's rows `mine: false`, and a runner's own
    // adapter marks the same pass `mine: true`. Once anything has claimed a pass as this peer's,
    // it stays that way — the runner's own stream is the authority on that, and it is the only
    // source that can populate `llm`.
    mine: previous?.mine || update.mine,
    ids: update.ids ?? previous?.ids,
    detail: update.detail ?? previous?.detail,
    llm: mergeExchange(previous?.llm, update.llm),
  };
  rows.set(merged.passId, merged);
  return merged;
}
