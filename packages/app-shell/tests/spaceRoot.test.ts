/**
 * A space's record and its collection are read once per dataset.
 *
 * Both are written at the create press and never change, yet opening a space read them three or
 * four times — the space store, the module host, the board actions and extraction's filing each ran
 * their own `Space.findOne(…, { include: { root: true } })`, two of them at the same moment.
 * `readSpaceRoot` is the one read they all share: kept after it finds a collection, shared while it
 * is in flight, and asked again after a failure or a space with no collection yet.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findOne = vi.fn();

vi.mock('@we/entities', () => ({
  Space: { findOne: (...args: unknown[]) => findOne(...args) },
  SpaceLandmark: {},
}));

const { readSpaceRoot } = await import('../src/shared/spaceLandmarks');

const dataset = () => ({}) as never;

beforeEach(() => {
  findOne.mockReset();
});

describe('readSpaceRoot', () => {
  it('reads a dataset once and keeps the answer', async () => {
    findOne.mockResolvedValue({ id: 'space', root: { id: 'root' } });
    const here = dataset();

    expect(await readSpaceRoot(here)).toEqual({ id: 'space', root: 'root' });
    expect(await readSpaceRoot(here)).toEqual({ id: 'space', root: 'root' });

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith(here, { include: { root: true } });
  });

  it('makes one read for callers that race', async () => {
    let answer!: (space: unknown) => void;
    findOne.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const here = dataset();

    const both = Promise.all([readSpaceRoot(here), readSpaceRoot(here), readSpaceRoot(here)]);
    answer({ id: 'space', root: { id: 'root' } });

    expect(await both).toEqual([
      { id: 'space', root: 'root' },
      { id: 'space', root: 'root' },
      { id: 'space', root: 'root' },
    ]);
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('reads each dataset for itself', async () => {
    findOne.mockImplementation(async (d: { name: string }) => ({ id: d.name, root: { id: `${d.name}-root` } }));

    expect(await readSpaceRoot({ name: 'a' } as never)).toEqual({ id: 'a', root: 'a-root' });
    expect(await readSpaceRoot({ name: 'b' } as never)).toEqual({ id: 'b', root: 'b-root' });
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failure: the next call reads again', async () => {
    findOne.mockRejectedValueOnce(new Error('executor busy'));
    findOne.mockResolvedValueOnce({ id: 'space', root: { id: 'root' } });
    const here = dataset();

    await expect(readSpaceRoot(here)).rejects.toThrow('executor busy');
    expect(await readSpaceRoot(here)).toEqual({ id: 'space', root: 'root' });
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('does not keep a space with no collection yet, nor no space at all', async () => {
    // Between the create press writing the space and setting its root, a read finds no collection.
    findOne.mockResolvedValueOnce(null);
    findOne.mockResolvedValueOnce({ id: 'space' });
    findOne.mockResolvedValueOnce({ id: 'space', root: { id: 'root' } });
    const here = dataset();

    expect(await readSpaceRoot(here)).toBeNull();
    expect(await readSpaceRoot(here)).toEqual({ id: 'space', root: '' });
    expect(await readSpaceRoot(here)).toEqual({ id: 'space', root: 'root' });
    expect(await readSpaceRoot(here)).toEqual({ id: 'space', root: 'root' });
    expect(findOne).toHaveBeenCalledTimes(3);
  });
});
