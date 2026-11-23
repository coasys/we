/**
 * `create(…, { id })` reaches the model layer's own `create` as the instance's base expression, and
 * an id some link already starts from is refused before anything is written.
 *
 * Against a stand-in with the one static the patch wraps: the real `create` needs an executor. The
 * stand-in assigns its data onto a fresh instance, as the real one does, so the case that the id
 * arrives as the base expression is the real order of events.
 */
import type { Ad4mModel, LinkQuery } from '@coasys/ad4m';
import { isRecordExists } from '@we/backend-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { installCallerIds } from './callerIds';

interface Made {
  _baseExpression: string;
  _idMinted: boolean;
  [field: string]: unknown;
}

const made: { instance: Made; options: unknown }[] = [];

class FakeModel {
  _baseExpression = 'ad4m://obj/minted';
  _idMinted = true;

  static create(_perspective: unknown, data: Record<string, unknown> = {}, options?: unknown) {
    const instance = Object.assign(new FakeModel(), data) as unknown as Made;
    made.push({ instance, options });
    return Promise.resolve(instance);
  }
}
installCallerIds(FakeModel as unknown as typeof Ad4mModel);

/** A perspective holding links out of `held` and nothing else. */
const perspectiveHolding = (...held: string[]) => ({
  get: (query: LinkQuery) => Promise.resolve(held.includes(query.source ?? '') ? [{ source: query.source }] : []),
});

describe('create with a caller-chosen id', () => {
  beforeEach(() => void (made.length = 0));

  it('makes the instance under that id, and passes the other options on without it', async () => {
    const parent = { id: 'p', relation: 'children' };
    await FakeModel.create(perspectiveHolding(), { title: 'Hello' }, { id: 'urn:uuid:1', batchId: 'b', parent });
    expect(made).toHaveLength(1);
    expect(made[0].instance).toMatchObject({ _baseExpression: 'urn:uuid:1', _idMinted: false, title: 'Hello' });
    expect(made[0].options).toEqual({ batchId: 'b', parent });
  });

  it('refuses an id a record already holds, and writes nothing', async () => {
    const create = FakeModel.create(perspectiveHolding('urn:uuid:1'), { title: 'Again' }, { id: 'urn:uuid:1' });
    await expect(create).rejects.toSatisfy(isRecordExists);
    expect(made).toEqual([]);
  });

  it('leaves a create without an id to mint its own', async () => {
    await FakeModel.create(perspectiveHolding(), { title: 'Hello' }, { batchId: 'b' });
    expect(made[0].instance._baseExpression).toBe('ad4m://obj/minted');
    expect(made[0].options).toEqual({ batchId: 'b' });
  });

  it('refuses an id that is not a non-empty string', async () => {
    await expect(FakeModel.create(perspectiveHolding(), {}, { id: '' })).rejects.toThrow(/non-empty string/);
  });
});
