/**
 * Who points at a value through one predicate — the in-memory `ReferencePort`.
 *
 * A to-many relation's values are held on the row under the relation's name, so finding every record
 * that links to a value is a scan of the tables whose entity declares a relation stored under the
 * predicate. Fine for a reference implementation; what a real store answers with one indexed lookup.
 */
import type { DatasetHandle, EntityManifest, ReferencePort } from '@we/backend-shared';
import { CONTAINMENT_PREDICATE } from '@we/backend-shared';

type Row = Record<string, unknown>;

const timeOf = (value: unknown) => (typeof value === 'number' ? value : Date.parse(String(value ?? '')) || 0);

export function createInMemoryReferencePort(manifest: EntityManifest): ReferencePort {
  return {
    referrers: async (dataset: DatasetHandle, predicate: string, target: string, opts) => {
      const tables = (dataset as { tables?: Record<string, Row[]> }).tables ?? {};
      const found: { id: string; author: string; at: string }[] = [];
      for (const [entity, schema] of Object.entries(manifest.entities)) {
        const relations = Object.entries(schema.relations)
          .filter(([, spec]) => !spec.reverseOf)
          .filter(([, spec]) => (spec.containment ? CONTAINMENT_PREDICATE : spec.predicate) === predicate)
          .map(([name]) => name);
        if (!relations.length) continue;
        for (const row of tables[entity] ?? []) {
          const holds = relations.some((name) => {
            const value = row[name];
            return Array.isArray(value) ? value.includes(target) : value === target;
          });
          if (!holds || typeof row.id !== 'string') continue;
          found.push({
            id: row.id,
            author: String(row.author ?? ''),
            at: new Date(timeOf(row.createdAt)).toISOString(),
          });
        }
      }
      found.sort((a, b) => timeOf(b.at) - timeOf(a.at));
      return opts?.limit !== undefined ? found.slice(0, opts.limit) : found;
    },
  };
}
