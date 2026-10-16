/**
 * A space's `Shape` records, read without making the executor resolve their definitions.
 *
 * A definition is a stored file (`we://shape_definition`, on the file-storage language), and a model
 * query resolves every file property on every row, in the executor, past the client's expression
 * cache — so every entry to a space fetched every definition afresh, after a reload as much as the
 * first time. An address names its content, so nothing that cache holds can be stale. Read here as
 * three things instead: the records without the file, the addresses as links, and the files through
 * the cache, in one batch.
 */
import { type Ad4mClient, LinkQuery, type PerspectiveProxy } from '@coasys/ad4m';
import { type ShapeRecord, trace } from '@we/backend-shared';

import { Shape } from './entities';

const DEFINITION = 'we://shape_definition';
const SCALARS = ['name', 'description', 'icon', 'shapeId', 'version', 'forkedFrom'] as const;

/** A file expression's payload as the ORM would have handed it back: a `data:` URL. */
export function asDataUrl(expression: unknown): string | null {
  const raw = (expression as { data?: unknown } | null)?.data;
  if (raw == null) return null;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const file = data as { data_base64?: unknown; file_type?: unknown };
  if (typeof file.data_base64 !== 'string') return null;
  if (file.data_base64.startsWith('data:')) return file.data_base64;
  return `data:${typeof file.file_type === 'string' ? file.file_type : 'application/json'};base64,${file.data_base64}`;
}

export async function readShapeRecords(client: Ad4mClient, perspective: PerspectiveProxy): Promise<ShapeRecord[]> {
  const started = performance.now();
  const [records, links] = await Promise.all([
    Shape.findAll(perspective, { properties: [...SCALARS] }),
    perspective.get(new LinkQuery({ predicate: DEFINITION })),
  ]);
  const read = performance.now();

  // Oldest first, so where a definition was rewritten and the old link outlived it the newest wins.
  const ordered = [...links].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const addressOf = new Map(ordered.map((link) => [link.data.source, link.data.target]));
  const addresses = records.map((record) => addressOf.get(record.id));
  const wanted = addresses.filter((address): address is string => !!address);
  const files = wanted.length ? await client.expression.getMany(wanted) : [];
  const fileOf = new Map(wanted.map((address, i) => [address, files[i]]));

  trace('shapes', 'read', {
    records: records.length,
    recordsMs: Math.round(read - started),
    filesMs: Math.round(performance.now() - read),
  });

  return records.map((record, i) => {
    const address = addresses[i];
    return {
      id: record.id,
      name: record.name,
      description: record.description ?? '',
      icon: record.icon ?? '',
      shapeId: record.shapeId ?? '',
      version: record.version ?? 1,
      forkedFrom: record.forkedFrom ?? '',
      definition: address ? asDataUrl(fileOf.get(address)) : null,
    };
  });
}
