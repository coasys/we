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

const { readSpaceRoot, seedSpaceRoot, shareListedSpace } = await import('../src/shared/spaceLandmarks');

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

describe('seedSpaceRoot', () => {
  /*
    The space list reads every space's record before a space is opened, and a record read without an
    include still carries its collection's id. Opening the space paid for a second read of the same
    record — 1.9 s on a busy executor, on the path to the Feed's first rows — to learn what that
    row already said.
  */
  it('answers from a row already read, with no read of its own', async () => {
    const here = dataset();
    seedSpaceRoot(here, { id: 'space', root: 'root' });

    expect(await readSpaceRoot(here)).toEqual({ id: 'space', root: 'root' });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('reads the collection as its id, or from the record when it was included', async () => {
    const asId = dataset();
    const asRecord = dataset();
    seedSpaceRoot(asId, { id: 'a', root: 'a-root' });
    seedSpaceRoot(asRecord, { id: 'c', root: { id: 'c-root' } });

    expect(await readSpaceRoot(asId)).toEqual({ id: 'a', root: 'a-root' });
    expect(await readSpaceRoot(asRecord)).toEqual({ id: 'c', root: 'c-root' });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('keeps nothing for a row without a collection, so the space is read', async () => {
    // A space made before spaces had a collection, or a row read in the moment before its root.
    findOne.mockResolvedValue({ id: 'space', root: { id: 'root' } });
    const here = dataset();
    seedSpaceRoot(here, { id: 'space' });
    seedSpaceRoot(here, null);

    expect(await readSpaceRoot(here)).toEqual({ id: 'space', root: 'root' });
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it('leaves an answer already kept, or a read in flight, alone', async () => {
    let answer!: (space: unknown) => void;
    findOne.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const here = dataset();

    const reading = readSpaceRoot(here);
    seedSpaceRoot(here, { id: 'other', root: 'other-root' });
    answer({ id: 'space', root: { id: 'root' } });

    expect(await reading).toEqual({ id: 'space', root: 'root' });
    expect(await readSpaceRoot(here)).toEqual({ id: 'space', root: 'root' });
  });
});

describe('shareListedSpace', () => {
  /*
    A recorded cold open read the open space's record four times. One was this: the space list's
    read of the record was still in flight — the list publishes only when every space has answered —
    so the space opened with nothing to seed from and read its record again, 1.5 s on a busy executor,
    before the Feed knew which collection to read.
  */
  it('opening a space while the list is reading it waits for that read instead of reading again', async () => {
    let land!: (row: unknown) => void;
    const here = dataset();
    shareListedSpace(here, new Promise((resolve) => (land = (row) => resolve(row as { id: string; root: string }))));

    const opening = readSpaceRoot(here);
    land({ id: 'space', root: 'root' });

    expect(await opening).toEqual({ id: 'space', root: 'root' });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('keeps the listed row the moment it lands', async () => {
    const here = dataset();
    shareListedSpace(here, Promise.resolve({ id: 'space', root: { id: 'root' } }));
    await Promise.resolve();

    expect(await readSpaceRoot(here)).toEqual({ id: 'space', root: 'root' });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('reads for itself when the listed row has no collection, or the list could not read it', async () => {
    findOne.mockResolvedValue({ id: 'space', root: { id: 'root' } });
    const noRoot = dataset();
    const failed = dataset();
    shareListedSpace(noRoot, Promise.resolve({ id: 'space' }));
    shareListedSpace(failed, Promise.reject(new Error('no shape')));

    expect(await readSpaceRoot(noRoot)).toEqual({ id: 'space', root: 'root' });
    expect(await readSpaceRoot(failed)).toEqual({ id: 'space', root: 'root' });
    expect(findOne).toHaveBeenCalledTimes(2);
  });
});
