/**
 * One person's newest record across their devices, and taking away what my other computer said once
 * this one has said the new thing.
 *
 * One person writes from several device keys, and an answer, a reaction or a vote is one per person,
 * not one per device: changing it here replaces the one my laptop gave. Every reader picks that one
 * record by {@link compareWritten}, and a device cleaning up must agree with them on which it is — so
 * the order and the cleanup live together, here, where the host's stores, the design system's
 * controls and a feature module can all reach them without reaching into each other.
 *
 * The replacement deletes a record another key authored, and a space's policy may refuse it — it
 * judges the author through the key log, and a person it cannot resolve yet, or a policy that keeps
 * deleting to a record's own key, says no (see docs/architecture/space-policy.md).
 *
 * So the order is fixed:
 *
 * 1. **This device's write lands first,** on its own, so a refusal here can never cost the new answer.
 *    It is always a new record, so its `createdAt` says when I last spoke.
 * 2. **Then my records are read again, and each that loses to the new one is removed** — under
 *    `compareWritten`, the order every reader picks my one answer or reaction by. A record that does
 *    not lose was written by another of my computers at the same moment, and is left: two devices
 *    changing at once each remove only what loses to their own write, so the winner is never removed
 *    by anybody. If mine is the one that lost, I take mine back. Whether only one is then left depends
 *    on each device having seen the other's record when it read, and on every removal being allowed;
 *    what does not depend on either is that every reader picks the same one, because they all read
 *    through `compareWritten` — extra records may remain, and they agree past them.
 * 3. **A refused removal is left standing** rather than failing the rest or the write before it.
 *
 * A record left standing is not a second answer to anyone reading: every reader keeps each person's
 * newest ({@link newestPerPerson} — the host's `involvement()` and `reactions()`, a poll's `tally`),
 * for every voter and not only for themselves, so two readers count the same total. A key whose
 * person a reader cannot name yet counts as its own until it can; it heals on the next change that is
 * allowed to remove it. The policy check shows its own refusal to the
 * person; these only report what was removed, for a caller whose act was a withdrawal and so did not
 * happen.
 */

/** A stored record, as far as which of two was written later goes. */
export interface Written {
  id?: unknown;
  createdAt?: unknown;
}

const writtenAt = (row: Written): number => {
  const at = row.createdAt;
  if (typeof at === 'number') return Number.isFinite(at) ? at : -Infinity;
  if (typeof at !== 'string' || !at) return -Infinity;
  const ms = /^\d+$/.test(at) ? Number(at) : Date.parse(at);
  return Number.isFinite(ms) ? ms : -Infinity;
};

const idOf = (row: Written): string => (typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : '');

/**
 * Which of one person's records is their newest — above 0 when `a` is, below when `b` is.
 *
 * Where two of one person's records stand every reader must pick the same one, and a device cleaning
 * up must agree with them on which one that is. Later `createdAt` wins; equal or unreadable times go
 * to the larger id compared as a string, so the pick never depends on the order a backend listed the
 * rows in. A row with neither an id nor a time is a write held on screen before it is stored — the
 * newest there is.
 *
 * The times are each device's own clock, so a device whose clock runs behind loses to an older answer
 * from one that runs ahead. That is a known limit: every reader still picks the same record.
 */
export function compareWritten(a: Written, b: Written): number {
  const held = (row: Written) => !row.id && (row.createdAt === undefined || row.createdAt === null);
  if (held(a) !== held(b)) return held(a) ? 1 : -1;
  const at = writtenAt(a) - writtenAt(b);
  if (at > 0 || at < 0) return at;
  const ida = idOf(a);
  const idb = idOf(b);
  return ida === idb ? 0 : ida > idb ? 1 : -1;
}

/** The newest of these records under {@link compareWritten}, or undefined for none. */
export function newestWritten<T extends Written>(rows: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const row of rows) if (!best || compareWritten(row, best) > 0) best = row;
  return best;
}

/**
 * Every person's newest record, keyed by person: what is one per person — a vote, a reaction, an
 * answer — read from records that name the device that wrote them.
 *
 * `personOf` names who an author speaks for; two authors it answers the same for are one person, and
 * only the newest of their records under {@link compareWritten} is kept. A record with no author is
 * nobody's but its own, and is kept apiece.
 */
export function newestPerPerson<T extends Written & { author?: unknown }>(
  rows: readonly T[],
  personOf: (author: string) => string,
): Map<string, T> {
  const newest = new Map<string, T>();
  rows.forEach((row, i) => {
    const author = row.author;
    const key = typeof author === 'string' && author ? personOf(author) : `\u0000row:${i}`;
    const best = newest.get(key);
    if (!best || compareWritten(row, best) > 0) newest.set(key, row);
  });
  return newest;
}

/** Something that can take itself away — a stored model, or a row with its kernel's remove bound. */
export interface Removable {
  delete: (batchId?: string) => Promise<unknown>;
}

/** Remove every one of these, one at a time — a withdrawal. Answers how many were refused. */
export async function replaceAcrossDevices(rows: readonly Removable[], failure: string): Promise<number> {
  let left = 0;
  for (const row of rows) {
    try {
      await row.delete();
    } catch (error) {
      left++;
      console.warn(failure, error);
    }
  }
  return left;
}

/**
 * After `written`, remove each of `mine` that loses to it — or `written` itself, if one of `mine` was
 * written later. `mine` is read after the write, and holds every record of mine on the same thing.
 * Answers the ids removed.
 */
export async function keepNewestAcrossDevices(
  written: Written & Removable,
  mine: readonly (Written & Removable)[],
  failure: string,
): Promise<Set<string>> {
  const removed = new Set<string>();
  const others = mine.filter((row) => row !== written && row.id !== written.id);
  for (const row of others) {
    if (compareWritten(written, row) <= 0) continue;
    try {
      await row.delete();
      removed.add(String(row.id));
    } catch (error) {
      console.warn(failure, error);
    }
  }
  if (others.some((row) => compareWritten(row, written) > 0)) {
    try {
      await written.delete();
      removed.add(String(written.id));
    } catch (error) {
      console.warn(failure, error);
    }
  }
  return removed;
}
