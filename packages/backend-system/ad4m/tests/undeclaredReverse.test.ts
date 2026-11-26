/**
 * Where a record came from, for a record whose class does not say.
 *
 * A bot installs its own classes, and they do not declare `extractedFrom`, so a call's action items
 * read as coming from nowhere: the canvas dimmed every one of them with that call selected. The
 * link is there, owned by the call, and these pin that it is read from that side.
 */
import {
  createLiveQuery,
  type EntityClass,
  type LivePage as Page,
  type QueryOptions,
  type Snapshot,
} from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import {
  fillUndeclaredReverse,
  type LinkPair,
  linksEndingAt,
  type ReverseReadDeps,
  reverseReadsOf,
  withUndeclaredReverse,
} from '../src/undeclaredReverse';

type Row = Record<string, unknown>;

const CALL = { id: 'call-1', title: 'Monday' };

/** The space's `we://extracted` links: call-1 produced item-1 and task-1. */
const LINKS: LinkPair[] = [
  { from: 'call-1', to: 'item-1' },
  { from: 'call-1', to: 'task-1' },
];

/** A space holding `calls` and `links`, recording what each read was asked. */
function space(calls: Row[] | Error = [CALL], links: LinkPair[] | Error = LINKS) {
  const asked: QueryOptions[] = [];
  const looked: { predicate: string; ids: readonly string[] }[] = [];
  const Model: EntityClass = {
    query: () => {
      throw new Error('a holder is only read once');
    },
    findAll: async (_dataset, opts) => {
      asked.push(opts);
      if (calls instanceof Error) throw calls;
      const wanted = (opts.where as { id?: string[] } | undefined)?.id ?? [];
      return calls.filter((call) => wanted.includes(call.id as string));
    },
  };
  const deps: ReverseReadDeps = {
    holder: () => Model,
    links: async (_dataset, predicate, ids) => {
      looked.push({ predicate, ids });
      if (links instanceof Error) throw links;
      return links.filter((link) => ids.includes(link.to));
    },
  };
  return { deps, asked, looked };
}

describe('the reverse relations a node carries that can be read from their forward side', () => {
  it('are the ones a particular class owns the link for', () => {
    const reads = reverseReadsOf();
    expect(reads).toContainEqual({
      relation: 'extractedFrom',
      holder: 'CollectionBlock',
      via: 'extracted',
      predicate: 'we://extracted',
    });
    expect(reads).toContainEqual({
      relation: 'partOf',
      holder: 'CollectionBlock',
      via: 'children',
      predicate: 'ad4m://has_child',
    });
  });

  it('leave out a relation whose forward half every node has, since there is no class to ask', () => {
    const relations = reverseReadsOf().map((read) => read.relation);
    expect(relations).not.toContain('respondsTo');
    expect(relations).not.toContain('inThread');
  });
});

describe('a row without a reverse relation it asked to include', () => {
  it('is given the collection that links to it', async () => {
    const { deps, asked, looked } = space();
    const rows: Row[] = [{ id: 'item-1' }];
    await fillUndeclaredReverse(rows, { include: { extractedFrom: true } }, {}, deps);
    expect(rows[0].extractedFrom).toEqual(CALL);
    expect(looked).toEqual([{ predicate: 'we://extracted', ids: ['item-1'] }]);
    // The holders are read by id: the few calls the links come from, never a scan for them.
    expect(asked).toHaveLength(1);
    expect(asked[0].where).toEqual({ id: ['call-1'] });
    expect(asked[0].parent).toBeUndefined();
  });

  it('is asked about in two reads for the whole page, and only where the class left it off', async () => {
    const { deps, asked, looked } = space();
    const declaredEmpty: Row = { id: 'task-2', extractedFrom: null };
    const declared: Row = { id: 'task-3', extractedFrom: { id: 'call-9' } };
    const rows: Row[] = [{ id: 'item-1' }, { id: 'task-1' }, { id: 'item-2' }, declaredEmpty, declared];
    await fillUndeclaredReverse(rows, { include: { extractedFrom: true } }, {}, deps);
    expect(looked).toHaveLength(1);
    expect(looked[0].ids).toEqual(['item-1', 'task-1', 'item-2']);
    // Two rows from one call: the call is read once.
    expect(asked).toHaveLength(1);
    expect(asked[0].where).toEqual({ id: ['call-1'] });
    expect(rows[0].extractedFrom).toEqual(CALL);
    expect(rows[1].extractedFrom).toEqual(CALL);
    // Nothing points at it: what the relation reads as on a record made by hand.
    expect(rows[2].extractedFrom).toBeNull();
    expect(declaredEmpty.extractedFrom).toBeNull();
    expect(declared.extractedFrom).toEqual({ id: 'call-9' });
  });

  it('reads nothing more when no link points at the page', async () => {
    const { deps, asked } = space([CALL], []);
    const rows: Row[] = [{ id: 'item-1' }];
    await fillUndeclaredReverse(rows, { include: { extractedFrom: true } }, {}, deps);
    expect(rows[0].extractedFrom).toBeNull();
    expect(asked).toEqual([]);
  });

  it("reads a holder's own fields, never its relations or its files", async () => {
    const { deps, asked } = space();
    await fillUndeclaredReverse([{ id: 'item-1' }], { include: { extractedFrom: true } }, {}, deps);
    const properties = asked[0].properties as string[];
    expect(properties).toContain('title');
    // Relations come back as id lists, and a call's `children` is its whole transcript.
    expect(properties).not.toContain('children');
    expect(properties).not.toContain('extracted');
    // Held as a file: reading it would fetch the file for every call.
    expect(properties).not.toContain('editorState');
  });

  it('carries what the include asked of the record it hydrates', async () => {
    const { deps, asked } = space();
    await fillUndeclaredReverse(
      [{ id: 'item-1' }],
      { include: { extractedFrom: { properties: ['title'], include: { signals: true } } } },
      {},
      deps,
    );
    expect(asked[0]).toEqual({ properties: ['title'], include: { signals: true }, where: { id: ['call-1'] } });
  });

  it('is given the holder as its id alone when the holder cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps } = space(new Error('offline'));
    const rows: Row[] = [{ id: 'item-1' }];
    await fillUndeclaredReverse(rows, { include: { extractedFrom: true } }, {}, deps);
    // Enough for a canvas, which only asks where a card came from.
    expect(rows[0].extractedFrom).toEqual({ id: 'call-1' });
    warn.mockRestore();
  });

  it('reads as nothing, rather than failing the read, when the links cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps } = space([CALL], new Error('offline'));
    const rows: Row[] = [{ id: 'item-1' }];
    await fillUndeclaredReverse(rows, { include: { extractedFrom: true } }, {}, deps);
    expect(rows[0].extractedFrom).toBeNull();
    warn.mockRestore();
  });

  it('is filled a level down, for the records a read included: a placed card', async () => {
    const { deps, looked } = space();
    const placed: Row = { id: 'item-1' };
    const own: Row = { id: 'task-2', extractedFrom: null };
    const rows: Row[] = [
      { id: 'placement-1', node: placed },
      { id: 'placement-2', node: own },
    ];
    const wrapped = withUndeclaredReverse({ query: vi.fn(), findAll: async () => rows }, deps);
    await wrapped.findAll({}, { include: { node: { include: { extractedFrom: true } } } });
    expect(placed.extractedFrom).toEqual(CALL);
    expect(own.extractedFrom).toBeNull();
    expect(looked).toEqual([{ predicate: 'we://extracted', ids: ['item-1'] }]);
  });
});

describe('looking links up by their ends', () => {
  it('asks the store for the links through the predicate that end at the ids', async () => {
    const queries: string[] = [];
    const store = {
      querySparql: async (query: string) => {
        queries.push(query);
        return [{ from: 'ad4m://obj/call', to: 'ad4m://obj/item' }];
      },
    };
    expect(await linksEndingAt(store, 'we://extracted', ['ad4m://obj/item'])).toEqual([
      { from: 'ad4m://obj/call', to: 'ad4m://obj/item' },
    ]);
    expect(queries).toEqual([
      'SELECT ?from ?to WHERE { VALUES ?to { <ad4m://obj/item> } ?from <we://extracted> ?to . }',
    ]);
  });

  it('asks in batches, so a page of thousands is several short queries', async () => {
    const queries: string[] = [];
    const store = { querySparql: async (query: string) => (queries.push(query), []) };
    const ids = Array.from({ length: 700 }, (_, i) => `ad4m://obj/${i}`);
    await linksEndingAt(store, 'we://extracted', ids);
    expect(queries).toHaveLength(3);
  });

  it('leaves out an id that cannot be written as an IRI, rather than splicing it into the query', async () => {
    const queries: string[] = [];
    const store = { querySparql: async (query: string) => (queries.push(query), []) };
    await linksEndingAt(store, 'we://extracted', ['ad4m://obj/ok', 'x> } DELETE {', 'no scheme']);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('<ad4m://obj/ok>');
    expect(queries[0]).not.toContain('DELETE');
    expect(await linksEndingAt(store, 'not a predicate', ['ad4m://obj/ok'])).toEqual([]);
  });
});

describe('a model handle that answers undeclared reverse relations', () => {
  it('leaves a read that asks for none of them untouched', async () => {
    const { deps, looked } = space();
    const page = [{ id: 'item-1' }];
    const wrapped = withUndeclaredReverse({ query: vi.fn(), findAll: async () => page }, deps);
    expect(await wrapped.findAll({}, { include: { signals: true } })).toBe(page);
    expect(looked).toEqual([]);
  });

  it('hands a live read its answers in the order they arrived, however long each took to fill', async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    const { deps } = space();
    const links = deps.links;
    deps.links = async (...args) => {
      // The first fill is held up until the second answer has arrived.
      if (reads++ === 0) await slow;
      return links(...args);
    };
    let emit!: (rows: Row[]) => void;
    const source = createLiveQuery<Page<unknown>>({
      read: () => ({ results: [] }),
      watch: () => () => undefined,
    });
    // Answers are pushed by hand, so each one reaches the wrapper at the moment the test chooses.
    const subscribers = new Set<(snapshot: Snapshot<Page<unknown>>) => void>();
    emit = (rows) => {
      const snapshot: Snapshot<Page<unknown>> = { status: 'ready', data: { results: rows }, initial: false };
      for (const fn of subscribers) fn(snapshot);
    };
    const Model: EntityClass = {
      query: () => ({
        ...source,
        subscribe: (fn) => {
          subscribers.add(fn);
          return () => void subscribers.delete(fn);
        },
      }),
      findAll: vi.fn(),
    };
    const wrapped = withUndeclaredReverse(Model, deps);
    const seen: string[] = [];
    wrapped.query({}, { include: { extractedFrom: true } }).subscribe((snapshot) => {
      seen.push((snapshot.data!.results as Row[]).map((row) => row.id).join(','));
    });
    emit([{ id: 'item-1' }]);
    emit([{ id: 'item-1' }, { id: 'task-1' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([]);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(['item-1', 'item-1,task-1']);
  });
});
