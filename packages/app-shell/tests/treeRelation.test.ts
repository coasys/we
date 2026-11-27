/**
 * Dragging cards in a tree whose spine is a *model relation* — `rel:Position.about` or `rel:*` —
 * rather than a kind of `Relationship`.
 *
 * The rule being kept is that the drop writes the model's own field and nothing else: a to-one
 * pointer on the child where it owns one, a list on the parent where it holds one, and through the
 * named forward property where the relation is derived (`belongsTo`). No `Relationship` record is
 * touched — an interpreted call's structure is the fields the extraction wrote, and rearranging it
 * must read back the same way.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { getEntity, registerEntity, unregisterEntity } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CANVAS = 'canvas-1';
const SPINE = 'rel:Position.about';

interface Topic {
  id: string;
  title?: string;
  subTopicOf?: string;
  agendaItem?: string;
}
interface Pos {
  id: string;
  text?: string;
  about?: string;
  regarding?: string;
}
interface Post {
  id: string;
  text?: string;
  author?: string;
}
interface Author {
  id: string;
  name?: string;
  /** Derived (`belongsTo` of `Post.author`) — the post pointing at this author, never written here. */
  post?: string;
}

const { world } = vi.hoisted(() => ({
  world: {
    topics: new Map<string, Topic>(),
    positions: new Map<string, Pos>(),
    posts: new Map<string, Post>(),
    authors: new Map<string, Author>(),
    meetings: new Map<string, { id: string; title?: string; items?: string[] }>(),
    /** Writes to a parent's list (`Agenda.items`), in order: `+a1:t3`, `-a0:t3`. */
    lists: [] as string[],
    /** Instances without `set`/`add`/`remove` — how AD4M's `fromSHACL` builds an installed SDNA's to-ones. */
    bare: false,
  },
}));

/**
 * A model class the way the record contract hands one over: `findAll`/`findOne`/`add`/`remove`/`set`
 * accessors, with the relations living on the instances as plain ids.
 */
const { TopicModel, PositionModel, PostModel, AuthorModel, AgendaModel, MeetingModel } = vi.hoisted(() => {
  type AnyRow = Record<string, unknown> & { id: string };
  const live = (table: Map<string, AnyRow>, row: AnyRow, toOnes: string[]) => {
    const instance: AnyRow = { ...row };
    // An edit through the record, as the operations runner makes one: '' clears a field, a to-one
    // with accessors takes a one-element list, anything else is written as given.
    instance.save = async () => {
      const stored = table.get(row.id)!;
      for (const [field, value] of Object.entries(instance)) {
        if (typeof value === 'function' || field === 'id' || value == null) continue;
        if (value === '') delete stored[field];
        else stored[field] = Array.isArray(value) && toOnes.includes(field) ? value[0] : value;
      }
    };
    for (const prop of world.bare ? [] : toOnes) {
      const suffix = prop.charAt(0).toUpperCase() + prop.slice(1);
      instance[`set${suffix}`] = async (value: unknown) => {
        const one = Array.isArray(value) ? value[0] : value;
        table.get(row.id)![prop] = one ?? '';
      };
      instance[`add${suffix}`] = async (value: unknown) => {
        const one = Array.isArray(value) ? value[0] : value;
        table.get(row.id)![prop] = one ?? '';
      };
      instance[`remove${suffix}`] = async () => void (table.get(row.id)![prop] = '');
    }
    return instance;
  };
  const modelOf = (table: Map<string, AnyRow>, toOnes: string[]) => ({
    findAll: async (_p: unknown, query?: { where?: Record<string, unknown>; include?: Record<string, unknown> }) => {
      let rows = [...table.values()];
      for (const [field, expected] of Object.entries(query?.where ?? {})) {
        rows = rows.filter((row) =>
          Array.isArray(expected) ? expected.includes(row[field]) : row[field] === expected,
        );
      }
      return rows.map((row) => live(table, row, toOnes));
    },
    findOne: async (_p: unknown, query: { where: { id: string } }) => {
      const row = table.get(query.where.id);
      return row ? live(table, row, toOnes) : null;
    },
    update: async (_p: unknown, id: string, patch: Record<string, unknown>) => {
      const row = table.get(id);
      if (!row) return null;
      // The SDK's contract (verified live on an installed to-one): '' clears the field;
      // null and undefined are skipped here.
      for (const [field, value] of Object.entries(patch)) {
        if (value === '') delete row[field];
        else if (value != null) row[field] = value;
      }
      return row;
    },
    addRelation: async (_p: unknown, id: string, relation: string, value: string) => {
      world.lists.push(`+${id}.${relation}:${value}`);
      const row = table.get(id);
      if (row) row[relation] = [...((row[relation] as string[] | undefined) ?? []), value];
    },
    removeRelation: async (_p: unknown, id: string, relation: string, value: string) => {
      world.lists.push(`-${id}.${relation}:${value}`);
      const row = table.get(id);
      if (row) row[relation] = ((row[relation] as string[] | undefined) ?? []).filter((v) => v !== value);
    },
    setRelation: async () => {},
  });
  return {
    TopicModel: modelOf(world.topics as unknown as Map<string, AnyRow>, ['subTopicOf', 'agendaItem']),
    PositionModel: modelOf(world.positions as unknown as Map<string, AnyRow>, ['about', 'regarding']),
    PostModel: modelOf(world.posts as unknown as Map<string, AnyRow>, ['author']),
    // `post` is a derived back-pointer — a belongsTo instance never carries a setter for it.
    AuthorModel: modelOf(world.authors as unknown as Map<string, AnyRow>, []),
    AgendaModel: modelOf(new Map<string, AnyRow>(), []),
    // A parent that lists its children — `items` is its to-many.
    MeetingModel: modelOf(world.meetings as unknown as Map<string, AnyRow>, []),
  };
});

/** The classes' manifest, as `currentDatasetEntities` hands a foreign schema's flat entries over. */
const ENTRIES = [
  {
    name: 'DiscussionTopic',
    targetClass: 'discussion://Topic',
    properties: [
      {
        name: 'title',
        predicate: 'discussion://title',
        type: 'string',
        isCollection: false,
        required: false,
        writable: true,
      },
      {
        name: 'subTopicOf',
        predicate: 'discussion://sub-topic-of',
        type: 'uri',
        isCollection: false,
        required: false,
        writable: true,
        relatedEntity: 'DiscussionTopic',
      },
      {
        name: 'agendaItem',
        predicate: 'discussion://agenda-item',
        type: 'uri',
        isCollection: false,
        required: false,
        writable: true,
        relatedEntity: 'AgendaItem',
      },
    ],
  },
  {
    name: 'Position',
    targetClass: 'discussion://Position',
    properties: [
      {
        name: 'text',
        predicate: 'discussion://text',
        type: 'string',
        isCollection: false,
        required: false,
        writable: true,
      },
      {
        name: 'about',
        predicate: 'discussion://about',
        type: 'uri',
        isCollection: false,
        required: false,
        writable: true,
        relatedEntity: 'DiscussionTopic',
      },
      {
        name: 'regarding',
        predicate: 'discussion://regarding',
        type: 'uri',
        isCollection: false,
        required: false,
        writable: true,
        relatedEntity: 'DiscussionTopic',
      },
    ],
  },
  {
    name: 'Post',
    targetClass: 'discussion://Post',
    properties: [
      {
        name: 'text',
        predicate: 'discussion://text',
        type: 'string',
        isCollection: false,
        required: false,
        writable: true,
      },
      {
        name: 'author',
        predicate: 'discussion://author',
        type: 'uri',
        isCollection: false,
        required: false,
        writable: true,
        relatedEntity: 'Author',
      },
    ],
  },
  {
    name: 'Author',
    targetClass: 'discussion://Author',
    properties: [
      {
        name: 'name',
        predicate: 'discussion://name',
        type: 'string',
        isCollection: false,
        required: false,
        writable: true,
      },
      /*
        The inverse of a to-one (`Post.author`), declared `belongsTo`: the author is the link's
        *target* — its parent end, not a card hanging under the post. A `rel:*` walk that
        treats it as a parent pointer reads the tree upside down.
      */
      {
        name: 'post',
        predicate: 'discussion://author',
        type: 'uri',
        isCollection: false,
        required: false,
        writable: false,
        relatedEntity: 'Post',
        reverse: true,
        reverseOf: 'author',
      },
    ],
  },
  {
    name: 'Meeting',
    targetClass: 'discussion://Meeting',
    properties: [
      {
        name: 'items',
        predicate: 'discussion://items',
        type: 'uri',
        isCollection: true,
        required: false,
        writable: true,
        relatedEntity: 'DiscussionTopic',
      },
    ],
  },
  {
    name: 'AgendaItem',
    targetClass: 'discussion://AgendaItem',
    properties: [
      {
        name: 'title',
        predicate: 'discussion://title',
        type: 'string',
        isCollection: false,
        required: false,
        writable: true,
      },
    ],
  },
];

/*
  The foreign models are doubles — a drop along one writes the model's own field, through the
  declared operations the real runner makes, onto these. Registered as the dataset's classes, as a
  foreign schema's are, so the runner reaches them the way it reaches any record type. WE's own
  records (placements, connections) are the in-memory backend's.
*/
const FOREIGN: Record<string, unknown> = {
  DiscussionTopic: TopicModel,
  Position: PositionModel,
  Post: PostModel,
  Author: AuthorModel,
  AgendaItem: AgendaModel,
  Meeting: MeetingModel,
};

const datasetStub = {
  currentDataset: () => ({ id: 'ds', handle, name: 'Space' }),
  datasets: () => [],
  personalDataset: () => null,
  currentDatasetEntities: () => ENTRIES,
};
const sessionStub = { me: () => ({ did: 'did:key:z6Mk' }) };
const shapeStub = { spaceShapes: () => [], interpretationCandidates: () => [] };

import { createRecordStore, type RecordStore } from '../src/shared/stores/RecordStore';

/*
  Run once under each reactivity port: Solid's, and the test port, which runs a new effect at once
  where Solid defers it. Each store is built in a root of its own and disposed after its case.
*/
const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];
let reactivity: ReactivityPort;
const disposers: (() => void)[] = [];

/** What the store says aloud, kept so a case can ask what was said. */
const toasts = {
  info: (_message: string) => undefined as unknown,
  success: (_message: string) => undefined as unknown,
  warning: (_message: string) => undefined as unknown,
  error: (_message: string) => undefined as unknown,
};

function mount(): RecordStore {
  let store!: RecordStore;
  disposers.push(
    reactivity.root(() => {
      store = createRecordStore({
        reactivity,
        toasts,
        datasetStore: datasetStub as never,
        sessionStore: sessionStub as never,
        shapeStore: shapeStub as never,
      });
    }),
  );
  return store;
}

type Record_ = Record<string, unknown> & { id: string; save(): Promise<void>; delete(): Promise<void> };
const model = (name: string) =>
  getEntity(name) as unknown as {
    create(p: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Record_>;
    findAll(p: unknown, query?: Record<string, unknown>): Promise<Record_[]>;
    findOne(p: unknown, query: Record<string, unknown>): Promise<Record_ | null>;
  };
let handle: unknown;
const place = (node: string, rank?: number) =>
  model('Placement').create(
    handle,
    { nodeType: 'Position', node: [node], ...(rank ? { rank } : {}) },
    { id: `row-${node}`, parent: { id: CANVAS, relation: 'children', entity: 'CollectionBlock' } },
  );
const placementOf = async (node: string) =>
  (await model('Placement').findOne(handle, { where: { id: `row-${node}` } }))!;
const rankOf = async (node: string) => (await placementOf(node)).rank as number;
const setRank = async (node: string, rank: number) => {
  const row = await placementOf(node);
  row.rank = rank;
  await row.save();
};
/** `Relationship`s the drop created — a model-relation drop must create none. */
const connections = () => model('Relationship').findAll(handle);
const aboutOf = (position: string) => world.positions.get(position)?.about;
/** The edge a card hangs by, as the graph reports it on a drop: a model relation's, here. */
const hangsBy = (relation: string, holder: string, target: string) => ({
  id: `relation|${relation}|${holder}|${target}`,
  type: 'relation',
  data: { relation, holder, holderType: relation.split('.')[0], target },
});

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => 'did:key:z6Mk' },
    { agent: { id: 'did:key:z6Mk', unlocked: true }, datasets: [{ id: 'ds-relation-tree', name: 'Tree' }] },
  );
  handle = (await ports.lifecycle.get('ds-relation-tree'))!.handle;
  for (const [name, double] of Object.entries(FOREIGN)) registerEntity(name, double as never);
  await model('CollectionBlock').create(handle, { kind: 'canvas' }, { id: CANVAS });
  world.topics.clear();
  world.positions.clear();
  world.posts.clear();
  world.authors.clear();
  world.meetings.clear();
  world.lists = [];
  world.bare = false;
  world.topics.set('t1', { id: 't1', title: 'Roadmap' });
  world.topics.set('t2', { id: 't2', title: 'Q3', subTopicOf: 't1' });
  world.positions.set('pos1', { id: 'pos1', text: 'Ship it', about: 't2' });
  world.positions.set('pos2', { id: 'pos2', text: 'Wait' });
  for (const id of ['t1', 't2', 'pos1', 'pos2']) await place(id);
});

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  beforeEach(() => {
    reactivity = makePort();
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  describe('a tree drop on a model relation', () => {
    it('points the child’s own field at the new parent — and writes no connection', async () => {
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, {
        recordId: 'pos2',
        recordType: 'Position',
        into: 'child',
        targetId: 't1',
        targetType: 'DiscussionTopic',
        order: ['pos2'],
      });
      expect(aboutOf('pos2')).toBe('t1');

      await store.undoCanvas(CANVAS);
      expect(aboutOf('pos2')).toBeFalsy();

      await store.redoCanvas(CANVAS);
      expect(aboutOf('pos2')).toBe('t1');
    });

    it('moves the pointer rather than adding a second one', async () => {
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, {
        recordId: 'pos1',
        recordType: 'Position',
        into: 'child',
        targetId: 't1',
        targetType: 'DiscussionTopic',
        order: ['pos1'],
      });
      expect(aboutOf('pos1')).toBe('t1');

      await store.undoCanvas(CANVAS);
      expect(aboutOf('pos1')).toBe('t2');
    });

    it('clears the field on a drop into the unconnected area', async () => {
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, {
        recordId: 'pos1',
        recordType: 'Position',
        into: 'loose',
      });
      expect(aboutOf('pos1')).toBeFalsy();

      await store.undoCanvas(CANVAS);
      expect(aboutOf('pos1')).toBe('t2');
    });

    it('refuses a drop whose class the relation does not join, and writes nothing', async () => {
      // `about` only runs Position → DiscussionTopic: a topic cannot hang under a position by it.
      const info = vi.spyOn(toasts, 'info');
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, {
        recordId: 't2',
        recordType: 'DiscussionTopic',
        into: 'child',
        targetId: 'pos1',
        targetType: 'Position',
        order: ['t2'],
      });
      expect(world.topics.get('t2')?.subTopicOf).toBe('t1');
      expect(aboutOf('pos1')).toBe('t2');
      // Refused by the declaration, and said — not left to a write that happens to find no record.
      expect(info).toHaveBeenCalledWith(expect.stringContaining('points at'));
    });

    it('refuses a drop that would put a card inside itself', async () => {
      const store = mount();
      await store.arrangeOnTree(CANVAS, 'rel:DiscussionTopic.subTopicOf', {
        recordId: 't1',
        recordType: 'DiscussionTopic',
        into: 'child',
        targetId: 't2',
        targetType: 'DiscussionTopic',
        order: ['t1'],
      });
      // t2 already sits under t1: t1 under t2 would loop the tree.
      expect(world.topics.get('t1')?.subTopicOf).toBeUndefined();
    });

    it('refuses to move a card still awaiting acceptance — and writes nothing', async () => {
      /*
      A suggestion not yet accepted has no settled state a field write, or an undo of it, could
      return to — so the drop is refused rather than written. `pos1` keeps its `about: 't2'`.
    */
      const info = vi.spyOn(toasts, 'info');
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, {
        recordId: 'pos1',
        recordType: 'Position',
        pending: true,
        into: 'child',
        targetId: 't1',
        targetType: 'DiscussionTopic',
        order: ['pos1'],
      });
      expect(aboutOf('pos1')).toBe('t2');
      expect(info).toHaveBeenCalledWith(expect.stringContaining('suggestion'));
    });

    it('refuses to move a card carrying an unsaved change — and writes nothing', async () => {
      const info = vi.spyOn(toasts, 'info');
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, {
        recordId: 'pos1',
        recordType: 'Position',
        changed: true,
        into: 'child',
        targetId: 't1',
        targetType: 'DiscussionTopic',
        order: ['pos1'],
      });
      expect(aboutOf('pos1')).toBe('t2');
      expect(info).toHaveBeenCalledWith(expect.stringContaining('changes'));
    });

    it('follows the child’s matching pointer under the wildcard spine', async () => {
      const store = mount();
      await store.arrangeOnTree(CANVAS, 'rel:*', {
        recordId: 'pos2',
        recordType: 'Position',
        into: 'child',
        targetId: 't1',
        targetType: 'DiscussionTopic',
        order: ['pos2'],
      });
      expect(aboutOf('pos2')).toBe('t1');
    });

    it('refuses the wildcard where no pointer of the child reaches the parent’s class', async () => {
      world.topics.set('t3', { id: 't3', title: 'Loose topic' });
      await place('t3');
      const store = mount();
      // A topic's only pointers are at DiscussionTopic/AgendaItem — nothing points at a Position.
      await store.arrangeOnTree(CANVAS, 'rel:*', {
        recordId: 't3',
        recordType: 'DiscussionTopic',
        into: 'child',
        targetId: 'pos1',
        targetType: 'Position',
        order: ['t3'],
      });
      expect(world.topics.get('t3')?.subTopicOf).toBeUndefined();
      expect(world.topics.get('t3')?.agendaItem).toBeUndefined();
    });

    it('does not read the inverse of a to-one as the author’s way up under the wildcard', async () => {
      /*
      `Author.post` is a `belongsTo` inverting a *to-one* (`Post.author`) — the author is the
      parent end of that link, not a card hanging under the post. Treated as a parent pointer
      it reads the tree upside down, and a 'loose' drop reaches for a clear there is none of:
      the field is derived and the card holds no parent to detach from. The direction check the
      seed and the named spine make keeps it on the children side.
    */
      world.posts.set('p1', { id: 'p1', text: 'A take', author: 'a1' });
      world.authors.set('a1', { id: 'a1', name: 'Ada', post: 'p1' });
      await place('a1');
      const info = vi.spyOn(toasts, 'info');
      const store = mount();
      await store.arrangeOnTree(CANVAS, 'rel:*', { recordId: 'a1', recordType: 'Author', into: 'loose' });
      // Nothing was cleared, and nothing was said — a card with no parent drops loose silently.
      expect(info).not.toHaveBeenCalled();
      expect(world.posts.get('p1')?.author).toBe('a1');
    });

    it('refuses a parent the link the card hangs by cannot reach — and writes nothing', async () => {
      /*
      `t2` hangs under `t1` by `subTopicOf`. The drop moves *that* link, and `subTopicOf` only reaches
      a DiscussionTopic — so an AgendaItem is refused rather than answered with another field, which
      would leave the card hanging by two links at once.
    */
      const info = vi.spyOn(toasts, 'info');
      const store = mount();
      await store.arrangeOnTree(CANVAS, 'rel:*', {
        recordId: 't2',
        recordType: 'DiscussionTopic',
        into: 'child',
        targetId: 'a1',
        targetType: 'AgendaItem',
        order: ['t2'],
        edge: hangsBy('DiscussionTopic.subTopicOf', 't2', 't1'),
      });
      expect(world.topics.get('t2')?.subTopicOf).toBe('t1');
      expect(world.topics.get('t2')?.agendaItem).toBeFalsy();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('points at'));
    });

    it('attaches a card that hangs by nothing through the relation joining the two classes', async () => {
      world.topics.set('t3', { id: 't3', title: 'Loose' });
      await place('t3');
      const store = mount();
      await store.arrangeOnTree(CANVAS, 'rel:*', {
        recordId: 't3',
        recordType: 'DiscussionTopic',
        into: 'child',
        targetId: 'a1',
        targetType: 'AgendaItem',
        order: ['t3'],
      });
      expect(world.topics.get('t3')?.agendaItem).toBe('a1');
    });

    it('rewrites the pointer the card hangs by, not the first of the right class', async () => {
      /*
      Two pointers at the same class — `about` and `regarding`, both → DiscussionTopic — and a
      card hanging by the *second*. The drop is told the edge it hangs by and rewrites that link;
      writing the first declared (`about`) would hang the card twice, by one field each.
    */
      world.positions.set('pos3', { id: 'pos3', text: 'Later', regarding: 't2' });
      await place('pos3');
      const store = mount();
      await store.arrangeOnTree(CANVAS, 'rel:*', {
        recordId: 'pos3',
        recordType: 'Position',
        into: 'child',
        targetId: 't1',
        targetType: 'DiscussionTopic',
        order: ['pos3'],
        edge: hangsBy('Position.regarding', 'pos3', 't2'),
      });
      expect(world.positions.get('pos3')?.regarding).toBe('t1');
      expect(world.positions.get('pos3')?.about).toBeFalsy();
    });

    describe('on an installed SDNA, whose records carry no relation accessors', () => {
      it('points the field through the static update', async () => {
        world.bare = true;
        const store = mount();
        await store.arrangeOnTree(CANVAS, SPINE, {
          recordId: 'pos2',
          recordType: 'Position',
          into: 'child',
          targetId: 't1',
          targetType: 'DiscussionTopic',
          order: ['pos2'],
        });
        expect(aboutOf('pos2')).toBe('t1');
      });

      it('clears the field through an update with an empty value on a drop into the unconnected area', async () => {
        world.bare = true;
        const info = vi.spyOn(toasts, 'info');
        const store = mount();
        await store.arrangeOnTree(CANVAS, SPINE, { recordId: 'pos1', recordType: 'Position', into: 'loose' });
        expect(aboutOf('pos1')).toBeFalsy();
        expect(info).not.toHaveBeenCalled();

        await store.undoCanvas(CANVAS);
        expect(aboutOf('pos1')).toBe('t2');
      });

      it('takes a first attach back on undo, by clearing the field', async () => {
        world.bare = true;
        const info = vi.spyOn(toasts, 'info');
        const store = mount();
        await store.arrangeOnTree(CANVAS, SPINE, {
          recordId: 'pos2',
          recordType: 'Position',
          into: 'child',
          targetId: 't1',
          targetType: 'DiscussionTopic',
          order: ['pos2'],
        });
        expect(aboutOf('pos2')).toBe('t1');

        await store.undoCanvas(CANVAS);
        expect(aboutOf('pos2')).toBeFalsy();
        await store.redoCanvas(CANVAS);
        expect(aboutOf('pos2')).toBe('t1');
        expect(info).not.toHaveBeenCalled();
      });

      it('undoes a reparent along one field by the set alone, and says nothing failed', async () => {
        /*
        `pos1` moves from `t2` to `t1` by `about`, and back on undo. Both ends are the same to-one,
        so the set to `t2` is its own clear, as on the way out. Clearing first finds no spelling on
        an installed SDNA, and the undo said it could not be taken back while it was.
      */
        world.bare = true;
        const info = vi.spyOn(toasts, 'info');
        const store = mount();
        await store.arrangeOnTree(CANVAS, SPINE, {
          recordId: 'pos1',
          recordType: 'Position',
          into: 'child',
          targetId: 't1',
          targetType: 'DiscussionTopic',
          order: ['pos1'],
        });
        expect(aboutOf('pos1')).toBe('t1');

        await store.undoCanvas(CANVAS);
        expect(aboutOf('pos1')).toBe('t2');
        await store.redoCanvas(CANVAS);
        expect(aboutOf('pos1')).toBe('t1');
        expect(info).not.toHaveBeenCalled();
      });
    });

    it('reorders a card among its own siblings — no link moves, the ranks do', async () => {
      world.positions.set('pos3', { id: 'pos3', text: 'Later', about: 't2' });
      await setRank('pos1', 1);
      await place('pos3', 2);
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, {
        recordId: 'pos3',
        recordType: 'Position',
        into: 'sibling',
        targetId: 'pos1',
        targetType: 'Position',
        before: true,
        order: ['pos3', 'pos1'],
      });
      expect(aboutOf('pos3')).toBe('t2');
      expect(await rankOf('pos3')).toBeLessThan(await rankOf('pos1'));
    });

    it('puts a reorder back on undo and does it again on redo', async () => {
      // A reorder moves no link, only ranks — so redo is the ranks the drop wrote, not the ones it replaced.
      world.positions.set('pos3', { id: 'pos3', text: 'Later', about: 't2' });
      await setRank('pos1', 1);
      await place('pos3', 2);
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, {
        recordId: 'pos3',
        recordType: 'Position',
        into: 'sibling',
        targetId: 'pos1',
        targetType: 'Position',
        before: true,
        order: ['pos3', 'pos1'],
        edge: hangsBy('Position.about', 'pos3', 't2'),
      });
      const after = await rankOf('pos3');
      expect(after).toBeLessThan(await rankOf('pos1'));

      await store.undoCanvas(CANVAS);
      expect(await rankOf('pos3')).toBe(2);
      await store.redoCanvas(CANVAS);
      expect(await rankOf('pos3')).toBe(after);
    });

    it('writes no rank at a sibling the seed pulled in rather than anybody placed', async () => {
      // The usual case for interpreted items: pos1 hangs under t2 by its field and has no placement.
      await (await placementOf('pos1')).delete();
      const error = vi.spyOn(toasts, 'error');
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, {
        recordId: 'pos2',
        recordType: 'Position',
        into: 'child',
        targetId: 't2',
        targetType: 'DiscussionTopic',
        order: ['pos1', 'pos2'],
      });
      expect(aboutOf('pos2')).toBe('t2');
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe('a tree drop writes the link the edge stands for', () => {
    it('moves a model field under "Any connection" — no Relationship is written', async () => {
      const store = mount();
      await store.arrangeOnTree(CANVAS, '', {
        recordId: 'pos1',
        recordType: 'Position',
        into: 'child',
        targetId: 't1',
        targetType: 'DiscussionTopic',
        order: ['pos1'],
        edge: hangsBy('Position.about', 'pos1', 't2'),
      });
      expect(aboutOf('pos1')).toBe('t1');
      expect(await connections()).toEqual([]);
    });

    it('refuses under "Any connection" too when the card’s link cannot reach the new parent', async () => {
      const info = vi.spyOn(toasts, 'info');
      const store = mount();
      await store.arrangeOnTree(CANVAS, '', {
        recordId: 'pos1',
        recordType: 'Position',
        into: 'child',
        targetId: 'a1',
        targetType: 'AgendaItem',
        order: ['pos1'],
        edge: hangsBy('Position.about', 'pos1', 't2'),
      });
      expect(aboutOf('pos1')).toBe('t2');
      expect(await connections()).toEqual([]);
      expect(info).toHaveBeenCalledWith(expect.stringContaining('points at'));
    });

    it('moves a card between two lists — off the old parent’s, onto the new one’s — and back on undo', async () => {
      world.meetings.set('m1', { id: 'm1', items: ['t2'] });
      world.meetings.set('m2', { id: 'm2', items: [] });
      for (const id of ['m1', 'm2']) await place(id);
      const store = mount();
      await store.arrangeOnTree(CANVAS, 'rel:Meeting.items', {
        recordId: 't2',
        recordType: 'DiscussionTopic',
        into: 'child',
        targetId: 'm2',
        targetType: 'Meeting',
        order: ['t2'],
        edge: hangsBy('Meeting.items', 'm1', 't2'),
      });
      expect(world.lists).toEqual(['-m1.items:t2', '+m2.items:t2']);
      expect(world.meetings.get('m2')?.items).toEqual(['t2']);

      world.lists = [];
      await store.undoCanvas(CANVAS);
      expect(world.lists).toEqual(['-m2.items:t2', '+m1.items:t2']);
    });

    it('takes the card off the list the edge drew it under, not the first list that holds it', async () => {
      world.meetings.set('m1', { id: 'm1', items: ['t2'] });
      world.meetings.set('m2', { id: 'm2', items: [] });
      world.meetings.set('m3', { id: 'm3', items: ['t2'] });
      for (const id of ['m1', 'm2', 'm3']) await place(id);
      const store = mount();
      await store.arrangeOnTree(CANVAS, 'rel:Meeting.items', {
        recordId: 't2',
        recordType: 'DiscussionTopic',
        into: 'child',
        targetId: 'm2',
        targetType: 'Meeting',
        order: ['t2'],
        edge: hangsBy('Meeting.items', 'm3', 't2'),
      });
      // m3 is the parent the tree drew; m1's list is another link and stays.
      expect(world.lists).toEqual(['-m3.items:t2', '+m2.items:t2']);
      expect(world.meetings.get('m1')?.items).toEqual(['t2']);
      expect(world.meetings.get('m3')?.items).toEqual([]);

      world.lists = [];
      await store.undoCanvas(CANVAS);
      expect(world.lists).toEqual(['-m2.items:t2', '+m3.items:t2']);
      expect(world.meetings.get('m1')?.items).toEqual(['t2']);
    });

    it('reads a stale edge against the data: a holder that no longer lists the card is not unlinked', async () => {
      world.meetings.set('m1', { id: 'm1', items: ['t2'] });
      world.meetings.set('m2', { id: 'm2', items: [] });
      world.meetings.set('m3', { id: 'm3', items: [] });
      for (const id of ['m1', 'm2', 'm3']) await place(id);
      const store = mount();
      await store.arrangeOnTree(CANVAS, 'rel:Meeting.items', {
        recordId: 't2',
        recordType: 'DiscussionTopic',
        into: 'child',
        targetId: 'm2',
        targetType: 'Meeting',
        order: ['t2'],
        edge: hangsBy('Meeting.items', 'm3', 't2'),
      });
      expect(world.lists).toEqual(['-m1.items:t2', '+m2.items:t2']);
    });

    it('takes the spine as a typed value as well as its spelling', async () => {
      const store = mount();
      await store.arrangeOnTree(
        CANVAS,
        { kind: 'relation', class: 'Position', prop: 'about' },
        {
          recordId: 'pos2',
          recordType: 'Position',
          into: 'child',
          targetId: 't1',
          targetType: 'DiscussionTopic',
          order: ['pos2'],
        },
      );
      expect(aboutOf('pos2')).toBe('t1');
      expect(await connections()).toEqual([]);
    });

    it('refuses a spine naming a reverse relation — the tree never draws one', async () => {
      world.posts.set('p1', { id: 'p1', text: 'A take', author: 'a1' });
      world.authors.set('a1', { id: 'a1', name: 'Ada', post: 'p1' });
      world.authors.set('a2', { id: 'a2', name: 'Bob' });
      await place('p1');
      const store = mount();
      await store.arrangeOnTree(CANVAS, 'rel:Author.post', {
        recordId: 'p1',
        recordType: 'Post',
        into: 'child',
        targetId: 'a2',
        targetType: 'Author',
        order: ['p1'],
      });
      expect(world.posts.get('p1')?.author).toBe('a1');
      expect(await connections()).toEqual([]);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const name of Object.keys(FOREIGN)) unregisterEntity(name);
  });
});
