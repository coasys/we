/**
 * Who holds a value through one relation — AD4M's `ReferencePort`.
 *
 * The relation is named as the contract names it and resolved to the predicate it is stored under
 * (`relationPredicates.ts`). Then one link lookup from the target's end, which the store indexes:
 * every link of that predicate to
 * that value, however many records the perspective holds. Each link's own author and timestamp say
 * who made the reference and when — for a mention, the message's author and the moment it was
 * written, since the mention link is written with the message.
 */
import { LinkQuery, type PerspectiveProxy } from '@coasys/ad4m';
import type { DatasetHandle, ReferencePort } from '@we/backend-shared';

import { predicateOfRelation } from './relationPredicates';

export function createAd4mReferencePort(): ReferencePort {
  return {
    referrers: async (dataset: DatasetHandle, relation, target: string, opts) => {
      const predicate = predicateOfRelation(relation.relation, relation.entity);
      const links = await (dataset as PerspectiveProxy).get(new LinkQuery({ predicate, target }));
      const newest = [...links].sort((a, b) => Date.parse(String(b.timestamp)) - Date.parse(String(a.timestamp)));
      const seen = new Set<string>();
      const out: { id: string; author: string; at: string }[] = [];
      for (const link of newest) {
        const id = link.data.source;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          author: String(link.author ?? ''),
          at: new Date(Date.parse(String(link.timestamp)) || 0).toISOString(),
        });
        if (opts?.limit !== undefined && out.length >= opts.limit) break;
      }
      return out;
    },
  };
}
