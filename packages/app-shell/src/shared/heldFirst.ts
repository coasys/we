/**
 * A store's read before a gesture's write, answered from what the screen already holds.
 *
 * The host draws a declared operation's writes from its speculative run, whose reads are answered
 * from the rows the live reads hold (`@we/entities`' `heldAnswer`). A store that reads something of
 * its own first — which column a card was dropped in, which placement the canvas draws for a card —
 * would put a round trip in front of that drawing again. Asked here, the read costs nothing when the
 * rows are on screen, and goes to the backend only when they are not.
 */
import { heldAnswer } from '@we/entities';

/** The rows `query` names, from what the host holds where that is all of them, else from `read`. */
export async function heldFirst<T>(
  entity: string,
  dataset: unknown,
  query: Record<string, unknown>,
  read: () => Promise<T[]>,
): Promise<T[]> {
  const held = heldAnswer(entity, dataset, query);
  return held ? (held as unknown as T[]) : read();
}

/** One record by id, held first — `null` when the backend has none either. */
export async function heldRecord<T>(
  entity: string,
  dataset: unknown,
  id: string,
  read: () => Promise<T | null | undefined>,
): Promise<T | null> {
  const [held] = heldAnswer(entity, dataset, { where: { id } }) ?? [];
  return held ? (held as unknown as T) : ((await read()) ?? null);
}
