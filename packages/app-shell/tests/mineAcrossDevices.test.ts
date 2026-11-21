/**
 * "Mine" in a template means the person, not this device's key.
 *
 * The queries are lifted from the shipped templates, their expressions filled in, and run through
 * the same compiler and engine the in-memory backend uses. A post written on my laptop is mine on
 * my desktop; a muted author stays out; somebody else's post is never mine.
 */
import { compileQuery, executeQueryIR, type FlatQuery } from '@we/backend-shared';
import { pruneUnresolvedWhere } from '@we/schema-shared';
import { instagramTemplate, twitterTemplate } from '@we/template-showcase';
import { describe, expect, it } from 'vitest';

const DESKTOP = 'did:key:desktop';
const LAPTOP = 'did:key:laptop';
const ME = [DESKTOP, LAPTOP, 'did:scid:me'];

const values: Record<string, unknown> = {
  'me.dids': ME,
  'sessionStore.me.dids': ME,
  'spaceStore.mutedDids': ['did:key:muted'],
};

/** Every `$queries` entry in a template whose text names `me.dids`. */
function queriesNaming(node: unknown, out: FlatQuery[] = []): FlatQuery[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) queriesNaming(child, out);
    return out;
  }
  const queries = (node as { $queries?: Record<string, FlatQuery> }).$queries;
  for (const query of Object.values(queries ?? {})) {
    if (JSON.stringify(query).includes('me.dids')) out.push(query);
  }
  for (const value of Object.values(node)) queriesNaming(value, out);
  return out;
}

/** The query with each `{ $ }` it holds replaced by what it would read; a page size is left out. */
function fill(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fill);
  if (!value || typeof value !== 'object') return value;
  const path = (value as { $?: unknown }).$;
  if (typeof path === 'string') return values[path];
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fill(inner)]));
}

function run(query: FlatQuery): string[] {
  const filled = fill(query) as FlatQuery;
  const where = filled.where ? pruneUnresolvedWhere(filled.where as Record<string, unknown>) : undefined;
  const { ir } = compileQuery({ entity: filled.entity, where, order: filled.order } as FlatQuery);
  const post = (id: string, author: string) => ({ id, kind: 'post', author, createdAt: `2026-01-0${id.length}` });
  const rows = [post('d', DESKTOP), post('l', LAPTOP), post('o', 'did:key:other'), post('m', 'did:key:muted')];
  return executeQueryIR(ir, { tables: { [filled.entity as string]: rows } })
    .map((row) => String(row.id))
    .sort();
}

describe('my own posts, from any of my devices', () => {
  it('lists what I wrote on every device under "Your posts", and nobody else’s', () => {
    const queries = queriesNaming(twitterTemplate);
    expect(queries).toHaveLength(1);
    expect(run(queries[0])).toEqual(['d', 'l']);
  });

  it('lists what I wrote on every device under "Your photos", and nobody else’s', () => {
    const queries = queriesNaming(instagramTemplate);
    expect(queries).toHaveLength(1);
    expect(run(queries[0])).toEqual(['d', 'l']);
  });
});
