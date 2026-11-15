/**
 * Taking away what my other computer said, once this one has said the new thing.
 *
 * One person writes from several device keys, and an answer or a reaction is one per person, not one
 * per device: changing it here replaces the one my laptop gave. That replacement deletes a record
 * another key authored, and a space's policy may refuse it — it judges the author through the key
 * log, and a person it cannot resolve yet, or a policy that keeps deleting to a record's own key, says
 * no (see docs/architecture/space-policy.md).
 *
 * So the order is fixed:
 *
 * 1. **This device's write lands first,** on its own, so a refusal here can never cost the new answer.
 *    It is always a new record, so its `createdAt` says when I last spoke.
 * 2. **Then my records are read again, and each that loses to the new one is removed** — under
 *    `compareWritten`, the order every reader picks my one answer or reaction by. A record that does
 *    not lose was written by another of my computers at the same moment, and is left: two devices
 *    changing at once each remove only what loses to their own write, so the winner is never removed
 *    by anybody and exactly one stands. If mine is the one that lost, I take mine back.
 * 3. **A refused removal is left standing** rather than failing the rest or the write before it.
 *
 * A record left standing is not a second answer to anyone reading: `involvement()` keeps one reflexive
 * answer per person and `reactions()` one reaction of mine, the newest (see `sources/`). A reaction
 * left standing is still counted per device by another person's tally, which has no profiles to join
 * keys to persons with; it heals on the next change that is allowed to remove it. The policy check
 * shows its own refusal to the person; these only report what was removed, for a caller whose act was
 * a withdrawal and so did not happen.
 */
import { compareWritten, type Written } from '@we/components/signals';

interface Removable {
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
