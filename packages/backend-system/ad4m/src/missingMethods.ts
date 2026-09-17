/**
 * Which RPC methods this executor turned out not to have.
 *
 * ## Why this exists
 *
 * WE guards a handful of calls against "the node is running a build that predates this feature" and
 * degrades rather than failing — a review list with no model names is worth more than no review
 * list. That trade is right, and the way it was implemented threw away the only fact that made it
 * diagnosable: {@link recordMissingMethod} matched the executor's `Unknown type: <method>` and
 * returned a boolean, so the method name it had just read went nowhere.
 *
 * The cost was real. A workshop ran for a day against a host whose executor predated
 * `perspective.subjectClassesOf`, and every suggestion in the extraction panel rendered as a flat
 * `label: … · startDate: …` line instead of a card. Nothing anywhere said why — not a console line,
 * not a settings page — because a 404 was the one outcome the guard deliberately swallowed whole.
 *
 * ## Why it is a registry rather than a message per call site
 *
 * A line written for `subjectClassesOf` documents the gap somebody has already spent a day finding,
 * and predicts none of the next ones. The executor names the method in the error itself, so nothing
 * here has to be told about a method in advance: every guarded call feeds this by existing, and a
 * guard added in six months feeds it without touching this file.
 *
 * That also decides how much this claims. It records **what was asked for and refused**, not what
 * breaks as a result — WE genuinely does not know the blast radius of a missing method, and a
 * hand-written "this is why your cards look wrong" would be back to one sentence per known bug.
 * The method name is the actionable part: it maps to a commit in ad4m and to a decision about
 * rebuilding a node.
 *
 * ## What this cannot do
 *
 * It is **reactive**. A method nothing called this session is a method nothing knows is missing, so
 * an empty list means "nothing has been refused yet", never "this executor is current". The fix for
 * that is an executor that reports its own method set — the WS dispatcher already holds one, keyed
 * by exactly these names — which is written up in `notes/we/September-2026/ad4m-follow-ups.md` §12.
 * Until a node is new enough to answer that, this is what can be known from here, and it keeps
 * working against the old nodes that report nothing, which is the case that needs it most.
 *
 * Module-level rather than per connection: a session talks to one executor, and the alternative is
 * threading an instance through five call sites that each hold nothing else.
 */

/** A method this executor refused, and when it first did. */
export interface MissingExecutorMethod {
  /** The RPC name the executor did not recognise — `perspective.subjectClassesOf`. */
  method: string;
  /**
   * When it was first refused, ISO 8601.
   *
   * A string rather than epoch ms so it is the same shape as every other timestamp WE carries — a
   * record's `createdAt`, an utterance's — and so `we-timestamp` can render it with no conversion
   * anywhere between here and the screen. Later refusals do not move it: what matters is that it
   * happened, and a capability gap does not heal.
   */
  firstSeen: string;
}

/**
 * First-refusal time by method name.
 *
 * Insertion order is first-refusal order, which is the order worth reading: the earliest one is
 * usually the oldest feature, and a later entry is often a consequence of the same stale build.
 */
const missing = new Map<string, string>();

/**
 * Who to tell when a new one turns up.
 *
 * A gap is discovered by whichever call happened to need it, which is never the surface that
 * displays them: a review list refreshing in a docked panel is what learns that classification is
 * unavailable, minutes before anybody opens settings to find out why. Without this the reader gets
 * whatever the list held when their screen was built, which for the first gap of a session is
 * nothing at all — the one case that matters.
 *
 * Fired on a *new* method only. A method already recorded has told everyone once, and a listener
 * woken per call would be woken on every review-list read for the lifetime of the session.
 */
const listeners = new Set<() => void>();

/**
 * The method an `Unknown type: <method>` rejection names, or `''` when it names none.
 *
 * Tolerant about what wraps it. The client raises `RPC error 404: Unknown type: perspective.foo`,
 * but the same text arrives bare from a rewrapping layer, so the prefix is not anchored on.
 */
function methodNamed(message: string): string {
  return /unknown type:\s*([^\s'"]+)/i.exec(message)?.[1] ?? '';
}

/**
 * Whether a rejection means "this executor has never heard of that method" — and remember which.
 *
 * The WS dispatcher answers an unregistered method with a 404 whose message is
 * `Unknown type: <method>`, and that is a categorically different failure from the call being
 * attempted and going wrong: it says the node is running a build that predates the feature, and no
 * retry, model configuration or permission grant will change it.
 *
 * Both the status and the message are checked because only one of them is guaranteed to survive.
 * The client raises a typed error carrying `status`, but that type is not exported from the package
 * root, and an error crossing a transport or a rewrapping layer can arrive as a plain `Error` with
 * the text intact and the status gone.
 *
 * Deliberately narrow. Anything broader would let an unrelated outage — a busy node, a dropped
 * socket — be recorded as a permanent capability gap, which is the one mistake here that a user
 * cannot recover from without reloading.
 *
 * Recording is a side effect of the question every caller already asks, rather than a second call
 * for each of them to remember. A caller that forgets to record is a gap nobody hears about, which
 * is the failure this is here to stop.
 */
export function recordMissingMethod(error: unknown): boolean {
  const status = (error as { status?: unknown; code?: unknown })?.status ?? (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (status !== 404 && !/unknown type/i.test(message)) return false;

  /*
    A 404 whose message names nothing is still a missing handler and still returns true — the
    caller's degradation does not depend on knowing the name. It is simply not recorded, because an
    entry with no method is a row that tells a reader nothing they can act on.
  */
  const method = methodNamed(message);
  if (method && !missing.has(method)) {
    missing.set(method, new Date().toISOString());
    /*
      Once per method, not once per call. `proposals()` runs on every review-list read, so a line
      per call would be a console full of one fact — and a console full of one fact is read as
      noise and filtered out, which is how this stayed invisible in the first place.
    */
    console.warn(
      `[backend-ad4m] this executor does not support "${method}" — the feature that needs it is ` +
        `running degraded. See Settings → Network → Executor support.`,
    );
    /*
      Each listener in its own try. One that throws is a bug in that listener, and letting it out
      here would turn a capability gap into a failure of whatever call happened to discover it —
      which is the opposite of what every caller of this asked for.
    */
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[backend-ad4m] a missing-method listener threw —', error);
      }
    }
  }
  return true;
}

/** Be told when a method is refused for the first time. Returns the unsubscribe. */
export function onMissingMethod(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every method refused so far, first refusal first. Empty means nothing has been refused *yet*. */
export function missingExecutorMethods(): MissingExecutorMethod[] {
  return [...missing].map(([method, firstSeen]) => ({ method, firstSeen }));
}

/**
 * Forget everything recorded.
 *
 * For tests, and for a host that swaps the executor underneath a live session: the list is a claim
 * about one node, and carrying it across a reconnect would report the old node's gaps as the new
 * one's.
 */
export function resetMissingExecutorMethods(): void {
  missing.clear();
}

/** For tests: drop every listener, so one suite's subscriber is not woken by the next one's. */
export function clearMissingMethodListeners(): void {
  listeners.clear();
}
