/**
 * Dragging cards in a tree whose spine is a *model relation* — `rel:Position.about` or `rel:*` —
 * rather than a kind of `Relationship`.
 *
 * The rule being kept is that the drop writes the model's own field and nothing else: a to-one
 * pointer on the child where it owns one, a list on the parent where it holds one, and through the
 * named forward property where the relation is derived (`belongsTo`). No `Relationship` record is
 * touched — an extracted call's structure is the fields the extraction wrote, and rearranging it
 * must read back the same way.
 */
import { render } from '@solidjs/testing-library';
import { toastService } from '@we/components/solid';
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
}
interface Row {
  id: string;
  node: string;
  rank?: number;
  parent: string;
}

const { world } = vi.hoisted(() => ({
  world: {
    topics: new Map<string, Topic>(),
    positions: new Map<string, Pos>(),
    rows: new Map<string, Row>(),
    /** Instances without `set`/`add`/`remove` — how AD4M's `fromSHACL` builds an installed SDNA's to-ones. */
    bare: false,
  },
}));

/**
 * A model class the way the record contract hands one over: `findAll`/`findOne`/`add`/`remove`/`set`
 * accessors, with the relations living on the instances as plain ids.
 */
const { TopicModel, PositionModel, AgendaModel } = vi.hoisted(() => {
  type AnyRow = Record<string, unknown> & { id: string };
  const live = (table: Map<string, AnyRow>, row: AnyRow, toOnes: string[]) => {
    const instance = { ...row };
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
      // Ad4mModel's update skips an empty value: it can point a field somewhere, never clear it.
      for (const [field, value] of Object.entries(patch)) if (value !== '' && value != null) row[field] = value;
      return row;
    },
    addRelation: async () => {},
    removeRelation: async () => {},
    setRelation: async () => {},
  });
  return {
    TopicModel: modelOf(world.topics as unknown as Map<string, AnyRow>, ['subTopicOf', 'agendaItem']),
    PositionModel: modelOf(world.positions as unknown as Map<string, AnyRow>, ['about']),
    AgendaModel: modelOf(new Map<string, AnyRow>(), []),
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

vi.mock('@we/entities', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@we/entities');
  const Relationship = {
    findAll: async () => [],
    findOne: async () => null,
    create: async (_p: unknown, data: Record<string, unknown>) => data,
    update: async () => {},
    delete: async () => {},
  };
  return {
    ...actual,
    Placement: {
      findAll: async (_p: unknown, query: { parent?: { id: string } }) =>
        [...world.rows.values()].filter((row) => row.parent === query.parent?.id),
      update: async (_p: unknown, id: string, patch: Partial<Row>) => void Object.assign(world.rows.get(id)!, patch),
      delete: async (_p: unknown, id: string) => void world.rows.delete(id),
      create: async () => ({}),
    },
    EdgeRoute: { findAll: async () => [], create: async () => ({}), update: async () => ({}), delete: async () => {} },
    TypeStyle: { findAll: async () => [], create: async () => ({}), update: async () => ({}) },
    runEntityTransaction: async (_p: unknown, fn: (tx: { batchId: string }) => Promise<unknown>) =>
      fn({ batchId: 'batch-1' }),
    getEntity: () => Relationship,
    getEntityForDataset: (name: string) =>
      name === 'DiscussionTopic'
        ? TopicModel
        : name === 'Position'
          ? PositionModel
          : name === 'AgendaItem'
            ? AgendaModel
            : Relationship,
  };
});

vi.mock('../src/frameworks/solid/stores/DatasetStore', () => ({
  useDatasetStore: () => ({
    currentDataset: () => ({ id: 'ds', handle: {}, name: 'Space' }),
    datasets: () => [],
    personalDataset: () => null,
    currentDatasetEntities: () => ENTRIES,
  }),
}));
vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ me: () => ({ did: 'did:key:z6Mk' }) }),
}));
vi.mock('../src/frameworks/solid/stores/ShapeStore', () => ({
  useShapeStore: () => ({ spaceShapes: () => [], extractionCandidates: () => [] }),
  BLOCK_ICONS: {},
}));

import { type RecordStore, RecordStoreProvider, useRecordStore } from '../src/frameworks/solid/stores/RecordStore';

function mount(): RecordStore {
  let store!: RecordStore;
  function Capture() {
    store = useRecordStore();
    return null;
  }
  render(() => (
    <RecordStoreProvider>
      <Capture />
    </RecordStoreProvider>
  ));
  return store;
}

const place = (node: string, rank?: number) =>
  world.rows.set(`row-${node}`, { id: `row-${node}`, node, parent: CANVAS, ...(rank ? { rank } : {}) });
const aboutOf = (position: string) => world.positions.get(position)?.about;

beforeEach(() => {
  world.topics.clear();
  world.positions.clear();
  world.rows.clear();
  world.bare = false;
  world.topics.set('t1', { id: 't1', title: 'Roadmap' });
  world.topics.set('t2', { id: 't2', title: 'Q3', subTopicOf: 't1' });
  world.positions.set('pos1', { id: 'pos1', text: 'Ship it', about: 't2' });
  world.positions.set('pos2', { id: 'pos2', text: 'Wait' });
  for (const id of ['t1', 't2', 'pos1', 'pos2']) place(id);
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
    const info = vi.spyOn(toastService, 'info');
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
    const info = vi.spyOn(toastService, 'info');
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
    const info = vi.spyOn(toastService, 'info');
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
    place('t3');
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

    it('says it cannot clear the field rather than pretending it did', async () => {
      world.bare = true;
      const info = vi.spyOn(toastService, 'info');
      const store = mount();
      await store.arrangeOnTree(CANVAS, SPINE, { recordId: 'pos1', recordType: 'Position', into: 'loose' });
      expect(aboutOf('pos1')).toBe('t2');
      expect(info).toHaveBeenCalledWith(expect.stringContaining('cannot be cleared'));
    });
  });

  it('reorders a card among its own siblings — no link moves, the ranks do', async () => {
    world.positions.set('pos3', { id: 'pos3', text: 'Later', about: 't2' });
    world.rows.get('row-pos1')!.rank = 1;
    place('pos3', 2);
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
    expect(world.rows.get('row-pos3')!.rank!).toBeLessThan(world.rows.get('row-pos1')!.rank!);
  });

  it('writes no rank at a sibling the seed pulled in rather than anybody placed', async () => {
    // The usual case for extracted items: pos1 hangs under t2 by its field and has no placement.
    world.rows.delete('row-pos1');
    const error = vi.spyOn(toastService, 'error');
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

afterEach(() => {
  vi.restoreAllMocks();
});
