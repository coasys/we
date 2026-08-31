/**
 * Rules about a feed of extraction passes that are worth deciding once and testing without a store.
 *
 * Small on purpose: everything here is a sentence about rows, and the reason it is a file rather
 * than an inline predicate is that its one rule was got wrong twice in the store it used to live in
 * — and the failure is a footnote that stays on screen after the thing it explains has stopped
 * being true, which nobody reports as a bug.
 */

/** What the shell's feed carries, narrowed to the fields a rule here reads. */
export interface ActivityRow {
  running: boolean;
  /** This agent's own pass, as opposed to a peer's. */
  mine: boolean;
  /** Whether the prompt and response are available to open. */
  hasDetail: boolean;
}

/**
 * Whether to explain that a peer's exchange is not on offer because the space keeps them private.
 *
 * Gated on the **setting**, not on "a peer row with nothing to open". The latter is what this used
 * to test, and it is true for reasons the footnote does not explain: a peer's pass that has not
 * reached the model yet, a skipped pass that never had an exchange, a row broadcast before the
 * switch synced to its runner. Each of those kept the note up after somebody turned sharing on —
 * the one moment it is plainly wrong.
 *
 * A settled row, because a running pass has no exchange yet whatever the space has decided; and
 * somebody else's, because this agent's own rows always carry theirs.
 */
export function detailWithheld(rows: readonly ActivityRow[], shared: boolean): boolean {
  if (shared) return false;
  return rows.some((row) => !row.mine && !row.running && !row.hasDetail);
}
