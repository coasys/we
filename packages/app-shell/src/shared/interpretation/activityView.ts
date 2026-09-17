/**
 * Rules about a feed of extraction passes that are worth deciding once and testing without a store.
 *
 * Small on purpose: everything here is a sentence about rows, and every way of getting one wrong
 * produces a quiet wrong answer that nobody reports as a bug.
 */

/**
 * What a settled automatic pass should be written down as, or nothing.
 *
 * A pass somebody pressed for is written by the run that returned — it has the turns, the target
 * list and the outcome in hand when it resolves. A watched pass has no such moment: it runs inside
 * the executor and only ever reports, so the record has to be written by whoever is listening. The
 * point of writing it is that the two kinds then sit in one list, told apart by `trigger` rather
 * than by which surface happens to be on screen.
 *
 * Four refusals, and each removes a row that should not become a record:
 *
 * - **not `auto`** — a one-shot is already written by its own run, and writing it twice would put
 *   every manual pass in the log in duplicate.
 * - **not `mine`** — every peer receives the same events, so a row per peer would make the history
 *   a record of who was watching rather than of what was read.
 * - **no `collection`** — a pass this client neither started nor watches has nothing to hang a
 *   record off; the log is scoped by containment, so an unparented row would be invisible anyway.
 * - **not settled** — a pass in flight has no outcome yet.
 *
 * Takes the **merged** row rather than the event that settled it. The exchange arrives on
 * `llmRequestSent` and `llmResponseReceived`, both of them several steps before the `processed`
 * that carries the ids and the outcome — so reading the settling event alone stored every watched
 * pass with an empty prompt and response, which is the one thing this was added to keep.
 */
export function watchPassRecord(row: {
  trigger?: 'manual' | 'auto';
  mine: boolean;
  collection?: string;
  phase: string;
  settled: boolean;
  ids?: readonly string[];
  detail?: string;
  llm?: { prompt?: string; response?: string };
}): {
  collection: string;
  outcome: string;
  recordCount: number;
  error?: string;
  prompt?: string;
  response?: string;
} | null {
  if (row.trigger !== 'auto' || !row.mine || !row.collection || !row.settled) return null;
  return {
    collection: row.collection,
    // The feed's three settled phases are the record's three outcomes, in the same words.
    outcome: row.phase,
    recordCount: row.ids?.length ?? 0,
    error: row.phase === 'failed' ? row.detail : undefined,
    prompt: row.llm?.prompt,
    response: row.llm?.response,
  };
}
