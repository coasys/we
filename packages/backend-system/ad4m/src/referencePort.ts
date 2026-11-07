/**
 * Who holds a value through one relation — AD4M's `ReferencePort`.
 *
 * The relation is named as the contract names it and resolved to the predicate it is stored under
 * (`relationPredicates.ts`). Then one link lookup from the target's end, which the store indexes:
 * every link of that predicate to
 * that value, however many records the perspective holds. Each link's own author and timestamp say
 * who made the reference and when — for a mention, the message's author and the moment it was
 * written, since the mention link is written with the message.
 *
 * The lookup is a display read, so the executor returns links whose author it could not confirm
 * (`cantCheck`, `flagged`) with their verdict and hides refused ones (ad4m #1597). The verdict is
 * carried on the referrer for a reader to mark; a confirmed author carries none.
 */
import { LinkQuery, type PerspectiveProxy } from '@coasys/ad4m';
import type { AuthorVerdict, DatasetHandle, ReferencePort, Referrer } from '@we/backend-shared';

/** The verdict worth a mark, from the executor's: `valid` and absent carry none. */
export function authorVerdictOf(verdict: unknown): AuthorVerdict | undefined {
  const kind = (verdict as { kind?: unknown } | null | undefined)?.kind;
  return kind === 'cantCheck' || kind === 'flagged' ? kind : undefined;
}

import { predicateOfRelation } from './relationPredicates';

export function createAd4mReferencePort(): ReferencePort {
  return {
    referrers: async (dataset: DatasetHandle, relation, target: string, opts) => {
      const predicate = predicateOfRelation(relation.relation, relation.entity);
      const links = await (dataset as PerspectiveProxy).get(new LinkQuery({ predicate, target }));
      const newest = [...links].sort((a, b) => Date.parse(String(b.timestamp)) - Date.parse(String(a.timestamp)));
      const seen = new Set<string>();
      const out: Referrer[] = [];
      for (const link of newest) {
        const id = link.data.source;
        if (seen.has(id)) continue;
        // Refused links are hidden by the executor already; one that slipped through is not shown.
        if ((link as { verdict?: { kind?: string } }).verdict?.kind === 'invalid') continue;
        seen.add(id);
        const verdict = authorVerdictOf((link as { verdict?: unknown }).verdict);
        out.push({
          id,
          author: String(link.author ?? ''),
          at: new Date(Date.parse(String(link.timestamp)) || 0).toISOString(),
          ...(verdict ? { verdict } : {}),
        });
        if (opts?.limit !== undefined && out.length >= opts.limit) break;
      }
      return out;
    },
  };
}
