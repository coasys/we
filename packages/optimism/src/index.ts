/**
 * A write drawn before it has been seen come back, and the rules for when to stop believing it.
 *
 * Every write in WE goes the same way round: the change is sent, the executor applies it, a
 * subscription re-runs, and only then does the screen redraw. Measured against a real node that is
 * about a second — and the executor's subscription loop debounces for a further 250ms before it will
 * even look, so the floor is not something a caller can query its way under. For anything the person
 * is *watching* — a card dropped in a column, a tick in an assign menu, a star pressed — a second of
 * the old answer reads as the press having failed and then silently succeeding.
 *
 * So the value is held here and drawn at once. This package is the lifecycle: what is held, when it
 * is believed, and when the data has overtaken it.
 *
 * ## It is a promise about presentation, never a prediction of the merge
 *
 * What comes back may not be what was written, and that is not a bug to work around. An ordered
 * relation on AD4M is an RGA: the executor diffs the written list against what it holds and writes
 * an entry only for what moved, which is what stops one person's save clobbering another's — so
 * under concurrent drags the converged answer can legitimately be neither party's list. An overlay
 * that tried to be right about that would be re-implementing the executor on the client, would be
 * wrong for any backend that merges differently, and would turn a presentational promise into a
 * second, disagreeing source of truth.
 *
 * Nothing here indexes, renumbers, merges or breaks a tie. It shows what was asked for and defers
 * completely to the next authoritative answer.
 *
 * ## The five rules, and what each one is for
 *
 * These were arrived at four separate times in this repo — a board's arrangements, a card's state, a
 * canvas card's style, an involvement — and each implementation discovered a rule the ones before it
 * lacked. They live here once, and one consumer applies them to every write: `@we/entities`'
 * predictions, which hold a declared operation's speculative writes over every read until the real
 * ones arrive. This package is the three steps (`hold`, `done`, `reconcile`) and nothing else.
 *
 * 1. **Release only on failure.** A write that succeeded is *not* released when its promise
 *    resolves, because that is earlier than the data arriving — the value would go back for the
 *    rest of the round trip, which is the flash again with extra steps. What retires a successful
 *    hold is the data moving, which only whatever *draws* can see. A write that failed is the
 *    caller's to withdraw: it drops the hold.
 *
 * 2. **Settle on the data moving, not on it agreeing.** "Hold until it reads as I wrote it" can hang
 *    forever: under a concurrent write the converged answer may never equal it, and a peer can take
 *    an assignment straight back off. The question is causality — *has an answer later than my write
 *    arrived* — and the value the data held when the write was issued answers it. A peer whose write
 *    lands first therefore drops the hold too, and the screen shows where the merge put it. That is
 *    the right outcome and the honest one.
 *
 * 3. **The baseline is taken at the first draw, never at hold time.** Knowing it when the write goes
 *    out means reading first, and a read is a round trip — during which the thing sits unmoved,
 *    which is the flash this exists to remove wearing a smaller coat. So an entry goes up knowing
 *    only its destination, and takes its baseline from the data the very next draw was made from,
 *    which is the value a read would have returned, arriving without anyone paying for one.
 *
 * 4. **Nothing settles while a write is still going.** Pressing a tick on, off and on again is three
 *    writes for one thing, and the first one's echo can arrive while the third press is what is on
 *    screen. "The data moved" was then true of data the person had already changed their mind about:
 *    the hold lifted, the old answer was drawn, and the control blinked back and forward as the later
 *    writes landed. So a hold counts the writes behind it and is judged only once the last has
 *    returned — against a fresh baseline, since whatever the data said before that is the history of
 *    the earlier presses.
 *
 * 5. **A backstop.** Nothing should reach it: a write either lands, and the next push moves the data,
 *    or it fails, and the caller drops it. It exists because the failure it guards against is the
 *    worst available — a value pinned to something nothing agrees with, indefinitely, with no error
 *    anywhere — and the cost of being wrong the other way is one late frame.
 *
 * ## What this is not
 *
 * **Not a cache, and not a query-result patcher.** It holds a value that a *drawer* overlays; it
 * never answers a read, and it knows nothing about queries. Guessing "what would this write do to
 * that `$query`" is not its business. Where that is answered, it is answered exactly: a declared
 * operation run speculatively says which records it writes, by the ids the real run will give them,
 * and `@we/entities`' predictions lay those writes over each read — judging, per read, when to stop
 * with the rules here. That is the one place a write meets a query result; this package is the
 * lifecycle it uses.
 *
 * **Not part of the backend contract.** `@we/backend-shared` describes what is true; this describes
 * what is being shown while the truth is in transit. Filed apart on purpose: in the contract it
 * would read as data, and sooner or later something would trust it.
 *
 * ## When the backend does this itself
 *
 * AD4M may grow optimistic delivery, at which point every hold here retires on its first draw —
 * because the data moves immediately, which is exactly rule 2 — and this degrades to a no-op with
 * nothing to switch off. It stays useful for any backend that does not, which is why it is a package
 * rather than a flag.
 *
 * One thing worth knowing if that day comes: an overlay whose retirement condition is "the data
 * moved" is only sound if the write is *guaranteed* to move the data. Where a backend has a write
 * that changes the store and notifies nobody, a hold over it stands until its TTL and then snaps
 * back — visibly worse than the lag it replaced. (WE had one: an in-place property edit on a record
 * read through `include`, while a subscription's trigger did not follow the include tree.
 * `upsertSignal` deleted and re-created a reaction for exactly that reason until it did.)
 */
/** One held write, and what the data read as when it was issued. */
export interface Held<V> {
  /** What to draw until the data catches up. */
  value: V;
  /**
   * What the data read as at the first draw after the write — rule 3, so absent until then.
   *
   * An entry with no baseline is believed: a write issued moments ago cannot have been answered.
   */
  before?: V;
  /** When it was issued, for the backstop. */
  at: number;
  /** Writes for this key not yet returned. While any is, the hold stands whatever the data says. */
  writing: number;
}

/** Everything held, by key. A key is the caller's: a record's id, an invocation's. */
export type Holds<V> = Record<string, Held<V>>;

/** How a kind of value is compared, and how long a hold may stand. */
export interface Rules<V> {
  /**
   * Whether two values are the same answer.
   *
   * Given rather than assumed because the shapes differ and the comparison is what gets subtly
   * wrong: an order is compared element by element (never by joining into a string — any separator
   * can appear inside an id, and an AD4M id is a URI, so a join is *almost* always right and fails
   * only for ids nobody reproduces), where a status or a vote is compared by value.
   */
  same: (a: V, b: V) => boolean;
  /** The backstop, in milliseconds. Defaults to {@link DEFAULT_TTL_MS}. */
  ttlMs?: number;
}

/** How long a hold may stand before it is disbelieved regardless — rule 5. */
export const DEFAULT_TTL_MS = 10_000;

/**
 * Note that this key should be drawn as `value` until the data catches up.
 *
 * Counts the write, so pressing the same control three times leaves one hold with three writes
 * behind it rather than three holds racing each other — rule 4.
 */
export function hold<V>(holds: Holds<V>, key: string, value: V, now = Date.now()): Holds<V> {
  const writing = (holds[key]?.writing ?? 0) + 1;
  return { ...holds, [key]: { value, at: now, writing } };
}

/**
 * A write for this key has returned successfully.
 *
 * The hold stays — rule 1 — but stops being exempt from judgement once the last write is back, and
 * takes a fresh baseline when it does, because whatever the data said while writes were in flight is
 * the history of the earlier ones.
 */
export function done<V>(holds: Holds<V>, key: string): Holds<V> {
  const entry = holds[key];
  if (!entry) return holds;
  const writing = Math.max(0, entry.writing - 1);
  return { ...holds, [key]: { ...entry, writing, before: writing ? entry.before : undefined } };
}

/**
 * What the holds should be, having seen what a draw was actually made from.
 *
 * Two jobs, and they are the same job at two ages. An entry with no baseline **takes** one; an entry
 * that has one is **compared** against it and dropped the moment the data has moved — by this write
 * or by a peer's.
 *
 * Called by whatever just drew, not by whatever read: a read landing is not the same moment as
 * something being redrawn from it, and clearing at the read put the old value back for the rest of
 * the pass — an edit that flashed to its new value, snapped back, and arrived again.
 *
 * `observedBy` answers `undefined` for a key it did not draw, and **that is not evidence**: the
 * record may simply not be in view, and a column scrolled out of a filter is not a column whose
 * write has landed. A surface whose own query has not answered yet must report nothing at all rather
 * than reporting emptiness, or every hold reads as overtaken by data that has not arrived.
 *
 * Returns the same object when nothing changed, so a signal set from it does not re-render the world
 * on every push.
 */
export function reconcile<V>(
  holds: Holds<V>,
  observedBy: (key: string, entry: Held<V>) => V | undefined,
  rules: Rules<V>,
  now = Date.now(),
): Holds<V> {
  const ttl = rules.ttlMs ?? DEFAULT_TTL_MS;
  let next = holds;
  const change = (key: string, entry: Held<V> | null) => {
    if (next === holds) next = { ...holds };
    if (entry) next[key] = entry;
    else delete next[key];
  };

  for (const [key, entry] of Object.entries(holds)) {
    if (now - entry.at > ttl) {
      change(key, null);
      continue;
    }
    // Rule 4: judged only once the last write behind it is back.
    if (entry.writing > 0) continue;
    const observed = observedBy(key, entry);
    if (observed === undefined) continue;
    // It already says what was written — the write landed, or it changed nothing. Either way there
    // is nothing left to stand in for, and dropping now costs no movement on screen.
    if (rules.same(observed, entry.value)) {
      change(key, null);
      continue;
    }
    if (entry.before === undefined) {
      change(key, { ...entry, before: observed });
      continue;
    }
    if (!rules.same(observed, entry.before)) change(key, null);
  }
  return next;
}
