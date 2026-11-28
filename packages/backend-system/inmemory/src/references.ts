/**
 * Who holds a value through one relation — the in-memory `ReferencePort`.
 *
 * A to-many relation's values are held on the row under the relation's name, so finding every record
 * that holds a value is a scan of the tables whose entity declares that relation. Fine for a reference
 * implementation; what a real store answers with one indexed lookup.
 */
import type { DatasetHandle, EntityManifest, ReferencePort, Referrer } from '@we/backend-shared';

type Row = Record<string, unknown>;

const timeOf = (value: unknown) =>
  typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) || 0 : 0;

export function createInMemoryReferencePort(manifest: EntityManifest): ReferencePort {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- the scan is synchronous, but a bad handle or row must reject as the port promises, not throw.
    referrers: async (dataset: DatasetHandle, relation, target: string, opts) => {
      const tables = (dataset as { tables?: Record<string, Row[]> }).tables ?? {};
      const found: Referrer[] = [];
      for (const [entity, schema] of Object.entries(manifest.entities)) {
        if (relation.entity && relation.entity !== entity) continue;
        const spec = schema.relations[relation.relation];
        if (!spec || spec.reverseOf) continue;
        const relations = [relation.relation];
        for (const row of tables[entity] ?? []) {
          const holds = relations.some((name) => {
            const value = row[name];
            return Array.isArray(value) ? value.includes(target) : value === target;
          });
          if (!holds || typeof row.id !== 'string') continue;
          found.push({
            id: row.id,
            author: typeof row.author === 'string' ? row.author : '',
            at: new Date(timeOf(row.createdAt)).toISOString(),
          });
        }
      }
      found.sort((a, b) => timeOf(b.at) - timeOf(a.at));
      return opts?.limit !== undefined ? found.slice(0, opts.limit) : found;
    },
  };
}
