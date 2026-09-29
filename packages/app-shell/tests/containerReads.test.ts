/**
 * A list of containers names the fields its rows carry.
 *
 * A `CollectionBlock` row read without `select` carries every field, relation id lists included —
 * and `children` is the id of everything in the container. A list of thirty calls showing a title
 * each carried every utterance id of every call: 350 KB of a 400 KB answer, on a subscription that
 * re-sends the whole answer on every change. Two whole-space reads of the same kind took 11 s each.
 *
 * The rule, over every bundled template and module: a query that can answer with more than one
 * container carries `select`. Single-record reads — `limit: 1`, or a `where` on `id` — are left
 * alone; one container's children is the price of showing that container.
 *
 * `UNSELECTED` names the lists that predate the rule. It may only shrink: a new list without
 * `select` fails here, and so does an entry whose query has since gained one, so the name goes too.
 */
import { CONTAINER_ACTIVITY_QUERY } from '@shared/containerActivity';
import { bundledModules } from '@shared/registries/bundledModules.generated';
import { bundledTemplates } from '@shared/registries/bundledTemplates.generated';
import type { TypedEntityQuery } from '@we/backend-shared';
import type { CollectionBlock } from '@we/entities';
import { describe, expect, it } from 'vitest';

const UNSELECTED: string[] = [
  'module graph › seeds',
  'module notes › notes',
  'template discord › catChannelRows',
  'template discord › categoryRows',
  'template discord › channelRows',
  'template discord › messageRows',
  'template events › eventRows',
  'template instagram › mediaRows',
  'template instagram › threadRows',
  'template kanban › boardRows',
  'template kanban › columns',
  'template kanban › pool',
  'template scrapbook › mediaRows',
  'template scrapbook › scraps',
  'template twitter › postRows',
  'template twitter › threadRows',
  'template workshop › columns',
  'template workshop › threadRows',
  'template youtube › playlistRows',
  'template youtube › threadRows',
  'template youtube › videoRows',
];

type Query = Record<string, unknown>;

/** Every query under `node` with a readable name: its `$queries` key, else its `as`, else `$query`. */
function queriesIn(node: unknown, source: string, found: { label: string; query: Query }[] = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const item of node) queriesIn(item, source, found);
    return found;
  }
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (!value || typeof value !== 'object') continue;
    if (key === '$query') {
      found.push({
        label: `${source} › ${typeof record.as === 'string' ? record.as : '$query'}`,
        query: value as Query,
      });
    } else if (key === '$queries') {
      for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
        if (entry && typeof entry === 'object') found.push({ label: `${source} › ${name}`, query: entry as Query });
      }
    } else if (key === 'options' && record.source === 'query') {
      found.push({ label: `${source} › seeds`, query: value as Query });
    }
    queriesIn(value, source, found);
  }
  return found;
}

const readsContainers = (query: Query) =>
  query.entity === 'CollectionBlock' || (Array.isArray(query.entity) && query.entity.includes('CollectionBlock'));

const singleRecord = (query: Query) =>
  query.limit === 1 || Boolean(query.where && typeof query.where === 'object' && 'id' in query.where);

function unselectedLists(): string[] {
  const host = { components: {} };
  const all = [
    ...Object.entries(bundledTemplates).flatMap(([id, template]) => queriesIn(template, `template ${id}`)),
    ...Object.entries(bundledModules).flatMap(([id, factory]) => queriesIn(factory(host as never), `module ${id}`)),
  ];
  const labels = all
    .filter(({ query }) => readsContainers(query) && !singleRecord(query) && !Array.isArray(query.select))
    .map(({ label }) => label);
  return [...new Set(labels)].sort();
}

describe('reading lists of containers', () => {
  it('names the fields in every new list of containers', () => {
    const found = unselectedLists();
    expect(found.filter((label) => !UNSELECTED.includes(label))).toEqual([]);
  });

  it('drops a name from the known list once its query selects', () => {
    const found = new Set(unselectedLists());
    expect(UNSELECTED.filter((label) => !found.has(label))).toEqual([]);
  });

  it('reads unread dots and mentions without the containers’ children', () => {
    expect(CONTAINER_ACTIVITY_QUERY.properties).not.toContain('children');
    expect(CONTAINER_ACTIVITY_QUERY.properties).toEqual(expect.arrayContaining(['createdAt', 'mentions']));
    // Selected, not included: an include asks for its targets hydrated, and `mentions` declares none.
    expect(Object.keys(CONTAINER_ACTIVITY_QUERY.include ?? {})).not.toContain('mentions');
  });

  it('names only fields the record declares, so a misspelt one fails to compile', () => {
    // A field the entity does not have reads back as nothing rather than as an error, so the type
    // is the only thing that catches it. `pnpm typecheck` fails if this line stops being an error.
    // @ts-expect-error -- `mention` is not a field of CollectionBlock
    const misspelt: TypedEntityQuery<CollectionBlock> = { properties: ['mention'] };
    expect(misspelt.properties).toEqual(['mention']);
  });
});
