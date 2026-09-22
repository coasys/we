/**
 * Undo, for a data layer that is shared, eventually consistent and last-write-wins.
 *
 * Ctrl+Z on a single-user document is a solved problem: keep snapshots, put one back. None of that
 * survives contact with a neighbourhood. Two people are on the same canvas, the executor merges
 * whatever arrives, and "restore the state before my last change" would silently throw away a peer's
 * move that landed in between — an undo that destroys somebody else's work is worse than no undo.
 *
 * So this is the model Yjs's `UndoManager` uses, and for the same reason: **a stack of this agent's
 * own inverse operations, applied as new forward writes**. Undo is not a rollback. It is another
 * write, through the same store action every other write goes through, competing on exactly the same
 * terms. A peer's change to a different record is untouched; a peer's change to the *same* record
 * loses to my undo the way it would lose to any other write of mine, which is a rule people already
 * understand.
 *
 * Three consequences worth stating, because each one is a decision rather than a limitation:
 *
 * - **The stack is private and unshared.** Ctrl+Z means "what *I* just did". It is never written to
 *   the space, and a peer pressing undo on their machine walks their own list.
 * - **Undo is "put that back", not "rewind time".** If a peer moved card B while I moved card A, my
 *   undo puts A back and leaves B where they put it. Anything else is a whole-canvas snapshot, which
 *   is the version that destroys their work.
 * - **It cannot cover an irreversible write.** An AD4M delete drops the links and a re-create gets a
 *   new id, so everything pointing at the old one breaks. Deletion is deliberately outside the
 *   history rather than faked inside it — see `stale` for the weaker version of the same problem.
 *
 * ## What is in an entry
 *
 * Closures, not a diff. The store that made the write is the only thing that knows how to reverse
 * it — which action, which arguments, which dataset — and a generic diff format would mean this
 * package learning what a placement is. So an entry carries `undo` and `redo` as calls back into
 * the store, and this owns only the ordering, the scope and the staleness rule.
 *
 * ## `stale` is the rule that prevents the visible misbehaviour
 *
 * An entry says "it was at (100, 200) and I moved it to (400, 300)". If a peer has moved it since,
 * undoing teleports the card out from under them and discards what they did. So before applying
 * one, the stack asks whether the world still matches what the entry last left — and drops it if
 * not, rather than fighting for it. Cheap, because the value is already on screen; and it is the
 * same "has the data moved" question the optimistic layer and the manual layout each ask.
 *
 * ## Scope
 *
 * Entries belong to a scope — a canvas id, a board id — and changing scope clears both stacks.
 * Without it, pressing undo after switching canvases moves a card on a canvas nobody is looking at,
 * which is the most confusing thing an undo can do.
 */

/** One reversible act, as the store that performed it describes it. */
export interface HistoryEntry {
  /**
   * What this entry belongs to — a canvas id, a board id.
   *
   * Compared by equality and nothing else. A stack whose scope changes is a stack about somewhere
   * the reader is no longer looking, and replaying it there is never what Ctrl+Z meant.
   */
  scope: string;
  /** A short phrase naming the act, for a tooltip or a toast: "move 3 cards". */
  label: string;
  /** Put it back. Called with no arguments; the store closed over everything it needs. */
  undo: () => Promise<void> | void;
  /** Do it again, after an undo. */
  redo: () => Promise<void> | void;
  /**
   * Whether replaying in this direction would overwrite something this agent has not seen.
   *
   * **It takes the direction, and it has to.** Staleness is "does the world still match what this
   * entry last left behind", and what it left behind depends on which way it was last replayed: an
   * entry that has just been undone left the *old* value, so asking whether the world still holds
   * the new one would call every redo stale and make redo do nothing at all. That is exactly the
   * bug the first version of this had, and it is invisible from the store side — a redo that
   * silently drops its entry looks like a key that does not work.
   *
   * So: `undo` asks whether the world still holds what the entry wrote; `redo` asks whether it
   * still holds what the undo put back.
   *
   * Absent means "always applicable", which is right for an act nothing else can contend. For
   * anything on shared, last-write-wins data it should be supplied. Answering true drops the entry
   * and the press does nothing, because the alternative is quietly overwriting somebody else.
   */
  stale?: (direction: 'undo' | 'redo') => boolean;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  /** The label of the entry a press would undo, for a tooltip. Empty when there is none. */
  undoLabel: string;
  redoLabel: string;
}

export const EMPTY: HistoryState = { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };

/**
 * How many acts are remembered.
 *
 * Deep enough that nobody reaches the end by accident, shallow enough that a stack of closures over
 * record ids never becomes something worth thinking about. Each entry is a few hundred bytes.
 */
const DEFAULT_LIMIT = 50;

export interface History {
  /** Record an act that has just been performed. Clears the redo stack — see `push`. */
  push(entry: HistoryEntry): void;
  /** Undo the most recent act in scope, skipping any the world has moved past. */
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** Forget everything. Called when the scope changes, and on the way out of a canvas. */
  clear(): void;
  /**
   * Point the stacks at a new scope, clearing them if it differs.
   *
   * Idempotent, so a caller may hand it the current canvas on every render without thinking about
   * it — which is how it is actually used, since nothing else knows the moment a canvas changes.
   */
  scopeTo(scope: string): void;
  state(): HistoryState;
}

/**
 * A history whose state is held in whatever signal primitive the host injects.
 *
 * The same shape `@we/optimism` takes, and for the same reason: this package must not depend on a
 * framework, and its consumers are all reactive. A host passes `createSignal`; a test passes two
 * closures over a variable.
 */
export type SignalFactory = <T>(initial: T) => [() => T, (next: T) => void];

export function createHistory(signal: SignalFactory, options: { limit?: number } = {}): History {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const [state, setState] = signal<HistoryState>(EMPTY);

  let scope = '';
  let past: HistoryEntry[] = [];
  let future: HistoryEntry[] = [];
  /*
    One at a time.

    Undo issues a write and the write is asynchronous, so a reader holding Ctrl+Z down can start a
    second before the first has landed. Both would read the same "before" value, and the second
    would then be judged stale by a world the first had already changed — so the stack would eat an
    entry per keypress while only one of them did anything.
  */
  let running = false;

  function publish(): void {
    setState({
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoLabel: past.at(-1)?.label ?? '',
      redoLabel: future.at(-1)?.label ?? '',
    });
  }

  /** Drop entries the world has moved past, from the top down, and hand back the first that holds. */
  function nextApplicable(stack: HistoryEntry[], direction: 'undo' | 'redo'): HistoryEntry | undefined {
    while (stack.length) {
      const entry = stack[stack.length - 1];
      if (entry.scope !== scope || entry.stale?.(direction) === true) {
        stack.pop();
        continue;
      }
      return stack.pop();
    }
    return undefined;
  }

  async function step(from: HistoryEntry[], to: HistoryEntry[], direction: 'undo' | 'redo'): Promise<void> {
    if (running) return;
    const entry = nextApplicable(from, direction);
    if (!entry) {
      publish();
      return;
    }
    running = true;
    publish();
    try {
      await (direction === 'undo' ? entry.undo() : entry.redo());
      to.push(entry);
    } catch (error) {
      /*
        A failed replay is dropped rather than put back.

        Whatever went wrong — the record is gone, the dataset closed, the write was refused — is not
        something pressing the key again will fix, and an entry that stays on top of the stack makes
        every subsequent press retry the one act that cannot work. The store that owns the action
        has already said so in its own words; this is not the layer to raise a second message from.
      */
      console.error(`history: could not ${direction} "${entry.label}"`, error);
    } finally {
      running = false;
      publish();
    }
  }

  return {
    push(entry) {
      if (entry.scope !== scope) {
        // An entry for somewhere else is the caller and this disagreeing about where the reader is.
        // Taking the entry's word for it is the safe way round: the alternative is silently
        // dropping a real act, where this at most clears a stack that was about to be cleared.
        scope = entry.scope;
        past = [];
      }
      past.push(entry);
      if (past.length > limit) past.shift();
      /*
        A new act ends the future.

        The standard rule, and it is *this agent's* act that ends it — a peer's write does not,
        because the reader has not changed their mind about anything. What a peer's write does is
        make entries stale, which is a different mechanism with a different outcome.
      */
      future = [];
      publish();
    },
    undo: () => step(past, future, 'undo'),
    redo: () => step(future, past, 'redo'),
    clear() {
      past = [];
      future = [];
      publish();
    },
    scopeTo(next) {
      if (next === scope) return;
      scope = next;
      past = [];
      future = [];
      publish();
    },
    state,
  };
}
