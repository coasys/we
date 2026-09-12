/**
 * A relation written through the contract rather than through a model instance.
 *
 * Until `setRelation`/`addRelation`/`removeRelation` existed, the neutral write vocabulary was
 * `create`/`update`/`delete` over a flat field bag, and every relation write in WE went around the
 * contract to an instance accessor. The visible consequence was that a backend could satisfy the
 * whole of `EntityStatic` and still be unable to run a board — where a column's cards, their order,
 * and a board's columns are relation writes and nothing else.
 *
 * So the shapes below are the board's, deliberately: arrange a column, reorder it, move a card
 * between columns, take one out. If this backend can do these, `boards.ts` runs on it.
 */
import type { EntityManifest } from '@we/backend-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { compileEntities } from '../src/entities';

/** A board, a column and a card — the three records and the two relations a board is made of. */
const BOARD_MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    Collection: {
      properties: {
        kind: { type: 'string' },
        title: { type: 'string' },
      },
      relations: {
        /** What a collection owns — a board's columns. */
        children: { target: 'Collection', cardinality: 'many', ordered: true },
        /** What it positions without owning — a column's cards. */
        arranges: { target: 'Card', cardinality: 'many', ordered: true },
        /** The one a board calls its own, and the to-one this branch deliberately does not write. */
        board: { target: 'Collection', cardinality: 'one' },
      },
    },
    Card: {
      properties: { title: { type: 'string' }, status: { type: 'string' } },
      relations: {},
    },
  },
};

const entities = compileEntities(BOARD_MANIFEST, { selfId: () => 'did:test:me' });
const Collection = entities.Collection;
const Card = entities.Card;

let dataset: { id: string; tables: Record<string, unknown[]> };
let column: { id: string };
let other: { id: string };
let cards: { id: string }[];

const arrangesOf = async (id: string) => {
  const found = await Collection.findOne(dataset, { where: { id } });
  return ((found as unknown as { arranges?: string[] })?.arranges ?? []) as string[];
};

beforeEach(async () => {
  dataset = { id: 'ds-relations', tables: {} };
  column = (await Collection.create(dataset, { kind: 'column', title: 'To do' })) as unknown as { id: string };
  other = (await Collection.create(dataset, { kind: 'column', title: 'Doing' })) as unknown as { id: string };
  cards = [];
  for (const title of ['a', 'b', 'c']) {
    cards.push((await Card.create(dataset, { title, status: 'todo' })) as unknown as { id: string });
  }
});

describe('arranging a relation', () => {
  it('writes the whole membership, in the order given', async () => {
    await Collection.setRelation(dataset, column.id, 'arranges', [cards[2].id, cards[0].id, cards[1].id]);

    expect(await arrangesOf(column.id)).toEqual([cards[2].id, cards[0].id, cards[1].id]);
  });

  it('reorders without changing what is in it — the drag that moves nothing between columns', async () => {
    await Collection.setRelation(dataset, column.id, 'arranges', [cards[0].id, cards[1].id, cards[2].id]);
    await Collection.setRelation(dataset, column.id, 'arranges', [cards[1].id, cards[0].id, cards[2].id]);

    expect(await arrangesOf(column.id)).toEqual([cards[1].id, cards[0].id, cards[2].id]);
  });

  it('drops what the new list omits', async () => {
    await Collection.setRelation(dataset, column.id, 'arranges', [cards[0].id, cards[1].id]);
    await Collection.setRelation(dataset, column.id, 'arranges', [cards[0].id]);

    expect(await arrangesOf(column.id)).toEqual([cards[0].id]);
  });

  it('empties it when handed nothing', async () => {
    await Collection.setRelation(dataset, column.id, 'arranges', [cards[0].id]);
    await Collection.setRelation(dataset, column.id, 'arranges', []);

    expect(await arrangesOf(column.id)).toEqual([]);
  });
});

describe('adding and removing one member', () => {
  it('appends without being told the rest — so a concurrent addition is not lost', async () => {
    await Collection.addRelation(dataset, column.id, 'arranges', cards[0].id);
    await Collection.addRelation(dataset, column.id, 'arranges', cards[1].id);

    expect(await arrangesOf(column.id)).toEqual([cards[0].id, cards[1].id]);
  });

  it('takes one out and leaves the others where they were', async () => {
    await Collection.setRelation(dataset, column.id, 'arranges', [cards[0].id, cards[1].id, cards[2].id]);
    await Collection.removeRelation(dataset, column.id, 'arranges', cards[1].id);

    expect(await arrangesOf(column.id)).toEqual([cards[0].id, cards[2].id]);
  });

  it('is not an error to remove what the relation does not hold', async () => {
    await Collection.setRelation(dataset, column.id, 'arranges', [cards[0].id]);
    await expect(Collection.removeRelation(dataset, column.id, 'arranges', cards[2].id)).resolves.toBeUndefined();

    expect(await arrangesOf(column.id)).toEqual([cards[0].id]);
  });
});

describe('the move a drag makes', () => {
  it('seats the card where it was dropped and takes it out of the column it left', async () => {
    await Collection.setRelation(dataset, column.id, 'arranges', [cards[0].id, cards[1].id]);
    await Collection.setRelation(dataset, other.id, 'arranges', [cards[2].id]);

    // What `moveCardToColumn` writes: the target's whole new order, then the removal.
    await Collection.setRelation(dataset, other.id, 'arranges', [cards[1].id, cards[2].id]);
    await Collection.removeRelation(dataset, column.id, 'arranges', cards[1].id);

    expect(await arrangesOf(other.id)).toEqual([cards[1].id, cards[2].id]);
    expect(await arrangesOf(column.id)).toEqual([cards[0].id]);
  });

  it('keeps the two relations apart — arranging cards never touches the columns', async () => {
    const board = (await Collection.create(dataset, { kind: 'board' })) as unknown as { id: string };
    await Collection.setRelation(dataset, board.id, 'children', [column.id, other.id]);
    await Collection.setRelation(dataset, column.id, 'arranges', [cards[0].id]);

    const found = await Collection.findOne(dataset, { where: { id: board.id } });
    // The bug this guards is a real one, one layer up: a card reorder once reached the board's own
    // sortable and wrote three task ids into `children`, which rendered as three empty columns.
    expect((found as unknown as { children: string[] }).children).toEqual([column.id, other.id]);
  });
});

describe('what it refuses', () => {
  it('names a relation the entity does not declare, rather than writing nothing', async () => {
    await expect(Collection.setRelation(dataset, column.id, 'cards', [cards[0].id])).rejects.toThrow(
      /"cards" is not a relation of Collection/,
    );
  });

  it('lists what it does declare, because the caller passed a string and got it wrong', async () => {
    await expect(Collection.addRelation(dataset, column.id, 'nope', cards[0].id)).rejects.toThrow(/children, arranges/);
  });

  it('refuses a to-one rather than guessing what the list meant', async () => {
    await expect(Collection.setRelation(dataset, column.id, 'board', [other.id])).rejects.toThrow(/to-one relation/);
  });

  it('is quiet about a record that is no longer there — the ordinary race, not a failure', async () => {
    await Collection.delete(dataset, column.id);

    await expect(Collection.setRelation(dataset, column.id, 'arranges', [cards[0].id])).resolves.toBeUndefined();
  });
});
