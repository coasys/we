/**
 * When a re-published dataset counts as a change — and what it costs when it wrongly does.
 *
 * `PresenceStore` rebuilds its source whenever `currentDataset` notifies, and rebuilding broadcasts
 * a `bye` and drops the peer map. So a dataset ref that is *equal but not identical* is not a
 * cosmetic re-render: it told a call's peers that this agent had left, emptied the roster, and
 * closed every connection in it. Clicking the space you are already in did that.
 *
 * Tested through a real Solid signal rather than by calling the comparator alone, because what has
 * to hold is "the effect does not re-run" — and the comparator is only half of that.
 */
import { createEffect, createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it } from 'vitest';

import { datasetAddressedBy, type DatasetIdentity, sameDataset } from '../src/shared/datasetIdentity';

/** Stands in for the backend adapter's `toRef`, which builds a fresh object per `lifecycle.get`. */
const ref = (id: string, handle: object, sharedUri?: string): DatasetIdentity => ({
  id,
  handle,
  ...(sharedUri ? { sharedUri } : {}),
});

let rebuilds = 0;
let set!: (value: DatasetIdentity | null) => void;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  rebuilds = 0;
});

describe('sameDataset', () => {
  it('treats a fresh ref for the same dataset as unchanged', () => {
    const handle = {};
    expect(sameDataset(ref('a', handle), ref('a', handle))).toBe(true);
  });

  it('separates the things a consumer can act on', () => {
    const handle = {};
    // A different space.
    expect(sameDataset(ref('a', handle), ref('b', handle))).toBe(false);
    // The same space, rebuilt around a new backend handle — model calls take the handle, so this is
    // a real change even though the id did not move.
    expect(sameDataset(ref('a', handle), ref('a', {}))).toBe(false);
    // Publishing a personal space as a neighbourhood, which is how a space gains a shared uri.
    expect(sameDataset(ref('a', handle), ref('a', handle, 'neighbourhood://x'))).toBe(false);
  });

  it('handles the empty cases', () => {
    expect(sameDataset(null, null)).toBe(true);
    expect(sameDataset(null, ref('a', {}))).toBe(false);
    expect(sameDataset(ref('a', {}), null)).toBe(false);
  });
});

describe('the currentDataset signal', () => {
  it('does not wake its consumers when the same space is published again', async () => {
    const handle = {};
    const dispose = createRoot((disposeRoot) => {
      const [current, setCurrent] = createSignal<DatasetIdentity | null>(null, { equals: sameDataset });
      createEffect(() => {
        current();
        rebuilds += 1;
      });
      set = setCurrent;
      return disposeRoot;
    });

    await flush();
    const afterMount = rebuilds;

    // What clicking your own space in the sidebar does.
    set(ref('a', handle));
    await flush();
    const afterFirst = rebuilds;
    expect(afterFirst).toBe(afterMount + 1);

    set(ref('a', handle));
    await flush();
    expect(rebuilds).toBe(afterFirst);

    // A genuine switch still wakes them, or presence would never follow the user.
    set(ref('b', {}));
    await flush();
    expect(rebuilds).toBe(afterFirst + 1);

    dispose();
  });
});

/**
 * Whether a `/space/<segment>` URL is about a given dataset.
 *
 * The question looks trivial and is the one that broke: an effect reading one space's sections and
 * writing another space's URL does not fail, it navigates — and the navigation then drags the
 * dataset after it. See the section guard in `TemplateProvider`.
 */
describe('datasetAddressedBy', () => {
  const personal = { id: 'local-uuid' };
  const shared = { id: 'local-uuid', sharedId: 'QmDesign' };

  it('matches the shared id, which is the one a link carries', () => {
    expect(datasetAddressedBy(shared, 'QmDesign')).toBe(true);
  });

  it('still matches the local id, because a URL somebody already holds must keep resolving', () => {
    expect(datasetAddressedBy(shared, 'local-uuid')).toBe(true);
  });

  it('matches a personal space, which has only its own id', () => {
    expect(datasetAddressedBy(personal, 'local-uuid')).toBe(true);
  });

  it('says no for another space — the case the guard exists for', () => {
    expect(datasetAddressedBy(shared, 'QmOther')).toBe(false);
    expect(datasetAddressedBy(personal, 'QmDesign')).toBe(false);
  });

  it('says no rather than throwing when there is nothing to compare', () => {
    // Both reachable on a boot frame: no dataset yet, or a route that is not a space route.
    expect(datasetAddressedBy(null, 'QmDesign')).toBe(false);
    expect(datasetAddressedBy(undefined, 'QmDesign')).toBe(false);
    expect(datasetAddressedBy(shared, undefined)).toBe(false);
    expect(datasetAddressedBy(shared, '')).toBe(false);
  });

  it('does not let an absent shared id match an absent segment', () => {
    // `undefined === undefined` is the shape that would quietly make every space match every gap.
    expect(datasetAddressedBy(personal, undefined)).toBe(false);
  });
});
