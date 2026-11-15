/**
 * Taking away what my other computer said, once this one has said the new thing.
 *
 * One person writes from several device keys, and an answer or a reaction is one per person, not one
 * per device: changing it here replaces the one my laptop gave. That replacement deletes a record
 * another key authored, and a space's policy may refuse it — it judges the author through the key
 * log, and a person it cannot resolve yet, or a policy that keeps deleting to a record's own key, says
 * no (see docs/architecture/space-policy.md).
 *
 * So the order is fixed, and it is the whole of the rule:
 *
 * 1. **This device's write lands first,** on its own, so a refusal here can never cost the new answer.
 * 2. **Then each record my other devices wrote is removed, one at a time,** and a refused one is left
 *    standing rather than failing the rest or the write before it.
 *
 * An answer left standing is not a second answer to anyone reading: `involvement()` keeps one reflexive
 * answer per person, the newest (see `sources/involvement.ts`), so the person still counts once, as
 * what they said last. A reaction left standing is still counted per device by the tally, which has no
 * profiles to join keys to persons with; it heals on the next change that is allowed to remove it.
 * The policy check shows its own refusal to the person; this only reports how many were left, for a
 * caller whose act was a withdrawal and so did not happen.
 */
export async function replaceAcrossDevices(
  rows: readonly { delete: (batchId?: string) => Promise<unknown> }[],
  failure: string,
): Promise<number> {
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
