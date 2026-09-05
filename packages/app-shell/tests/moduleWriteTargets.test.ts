/**
 * Every module write can name the dataset it belongs to.
 *
 * ## Why this is a test rather than a review note
 *
 * Four audits have found the "writes to the current dataset" class, and P1-2 was its worst
 * instance: #161 made a call survive navigation, and every module write still resolved to
 * `datasetStore.currentDataset()`. Start a call in space A with recording on, open space B, keep
 * talking, and each utterance became a `TextBlock` in **B's** perspective carrying a `children`
 * link from a record id B does not hold — peers in A stopped seeing the transcript, B accumulated
 * orphans, and nothing anywhere reported a problem.
 *
 * The fix is `DatasetTarget`, and the thing worth pinning is not that transcribe passes one today.
 * It is that a write surface added *later* takes one at all: the failure is invisible at runtime and
 * looks correct in review, so the moment to catch it is when the signature is written.
 *
 * Asserted against the deps bag a module actually receives, so a new write is covered by being
 * reachable rather than by somebody remembering to add it here.
 */
import { describe, expect, it } from 'vitest';

import {
  createModuleStoreDeps,
  provideModuleHostServices,
  resetModuleHostServices,
} from '../src/shared/registries/moduleHostServices';

/** The reactive kit reduced to the smallest thing that satisfies the contract. */
const framework = {
  signal: <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => (value = next)];
  },
  effect: (fn: () => void) => fn(),
};

const HERE = { id: 'here' };
const THERE = { id: 'there' };

/** What the host publishes, recording where each write was aimed. */
function wireHost() {
  const writes: { call: string; dataset: unknown }[] = [];
  resetModuleHostServices();
  provideModuleHostServices({
    dataset: () => HERE,
    datasetByUri: (uri) => (uri === 'neighbourhood://there' ? THERE : undefined),
    createEntity: async (_entity, _fields, options) => {
      writes.push({ call: 'createEntity', dataset: options?.dataset });
      return 'record-1';
    },
    linkEntity: async (_entity, _id, _relation, _value, options) => {
      writes.push({ call: 'linkEntity', dataset: options?.dataset });
    },
    interpretation: {
      proposals: async (dataset: unknown) => {
        writes.push({ call: 'proposals', dataset });
        return [];
      },
      accept: async (dataset: unknown) => {
        writes.push({ call: 'accept', dataset });
        return true;
      },
      reject: async (dataset: unknown) => {
        writes.push({ call: 'reject', dataset });
        return true;
      },
    } as never,
  });
  return { writes, deps: createModuleStoreDeps(framework) };
}

describe('a module write names its dataset', () => {
  it('takes an options argument on every entity write', () => {
    /*
      Arity, not behaviour. A write that cannot be *told* where to go has no fix at the call site,
      which is exactly the shape P1-2 had: `createEntity(entity, fields, options)` already existed
      and `options` could not carry a dataset, so transcribe had nothing to pass even once somebody
      noticed.
    */
    const { deps } = wireHost();
    expect(deps.createEntity?.length).toBeGreaterThanOrEqual(3);
    expect(deps.linkEntity?.length).toBeGreaterThanOrEqual(5);
  });

  it('forwards a named dataset through createEntity', async () => {
    const { writes, deps } = wireHost();
    await deps.createEntity?.('TextBlock', { text: 'hi' }, { dataset: 'neighbourhood://there' });
    expect(writes).toEqual([{ call: 'createEntity', dataset: 'neighbourhood://there' }]);
  });

  it('forwards a named dataset through linkEntity', async () => {
    const { writes, deps } = wireHost();
    await deps.linkEntity?.('CollectionBlock', 'c1', 'participants', 'did:x', {
      dataset: 'neighbourhood://there',
    });
    expect(writes).toEqual([{ call: 'linkEntity', dataset: 'neighbourhood://there' }]);
  });

  it('resolves a named dataset for every interpretation call', async () => {
    // Interpretation follows the call too: reading proposals from the space on screen answered
    // about wherever the reader had wandered to, and accepting one committed it there.
    const { writes, deps } = wireHost();
    const target = { dataset: 'neighbourhood://there' };
    await deps.interpretation?.proposals(target);
    await deps.interpretation?.accept('p1', undefined, target);
    await deps.interpretation?.reject('p1', undefined, target);

    expect(writes.map((w) => w.call)).toEqual(['proposals', 'accept', 'reject']);
    for (const write of writes) expect(write.dataset).toBe(THERE);
  });

  it('means the space on screen when nothing is named', async () => {
    // The behaviour every existing caller relies on, and the right default for a module whose work
    // is caused by the person looking at it.
    const { writes, deps } = wireHost();
    await deps.interpretation?.proposals();
    expect(writes[0].dataset).toBe(HERE);
  });

  it('refuses a dataset it cannot resolve rather than writing somewhere else', async () => {
    /*
      The direction that matters. Falling back to the current dataset *is* the bug: a module names a
      dataset precisely when its work does not belong to whatever is on screen, so resolving a name
      it does not hold and writing to the current one is how a transcript ended up in the wrong
      space. Losing one utterance beats corrupting a second space.
    */
    const { writes, deps } = wireHost();
    const gone = { dataset: 'neighbourhood://deleted' };

    expect(await deps.interpretation?.proposals(gone)).toEqual([]);
    expect(await deps.interpretation?.accept('p1', undefined, gone)).toBe(false);
    expect(writes).toEqual([]);
  });
});
