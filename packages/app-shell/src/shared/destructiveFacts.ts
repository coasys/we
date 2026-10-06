/**
 * What a delete would take with it, found out by the host before it asks.
 *
 * `spaceStore.deleteCollection` follows replies all the way down, so the question in front of it
 * should say how many go. The host counts from the data itself rather than taking a number from the
 * template that asked: see `DestructiveFacts`.
 */
import { CollectionBlock } from '@we/entities';

import type { DestructiveFacts } from './destructiveWording';

/** Stop counting somewhere. A thread this large is "many", and the walk is one read per level. */
const MOST = 999;

type Row = { id: string; comments?: unknown; inReplyTo?: unknown };

const idsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === 'string' ? v : ((v as { id?: string })?.id ?? ''))).filter(Boolean)
    : [];

/**
 * Whether a collection is a reply, and how many responses sit under it — one read per level of the
 * thread, breadth first. Answers with nothing it could not find out rather than failing the question.
 */
export async function collectionFacts(dataset: unknown, id: string): Promise<DestructiveFacts> {
  if (!dataset || !id) return {};
  try {
    const read = (ids: string[]) =>
      CollectionBlock.findAll(dataset as never, { where: { id: ids } } as never) as unknown as Promise<Row[]>;
    const [root] = await read([id]);
    if (!root) return {};

    const seen = new Set<string>([id]);
    let frontier = idsOf(root.comments).filter((child) => !seen.has(child));
    let responses = 0;
    while (frontier.length && responses < MOST) {
      for (const child of frontier) seen.add(child);
      responses += frontier.length;
      const next = await read(frontier);
      frontier = next.flatMap((row) => idsOf(row.comments)).filter((child) => !seen.has(child));
    }
    return { reply: !!root.inReplyTo, responses: Math.min(responses, MOST) };
  } catch {
    return {};
  }
}
