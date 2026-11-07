/**
 * `''` clears a property on the save path of the `Ad4mModel` this package is pinned to.
 *
 * `clearOnEmpty.test.ts` pins the patch's own logic against a stand-in, which says nothing about
 * whether the SDK still runs the method the patch wraps. That seam has moved before: ad4m #1443
 * rewrote `innerUpdate` into `updateWrites` / `planProperty` / `sendWrites`, and `save()` stopped
 * calling `setProperty` at all. So this drives the real class — only the perspective is faked —
 * and fails the day `save()` stops reaching the wrapped method.
 */
import { Ad4mModel, Model, Property } from '@coasys/ad4m';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { installClearOnEmpty } from './clearOnEmpty';

@Model({ name: 'ClearOnEmptyProbe' })
class Probe extends Ad4mModel {
  @Property({ through: 'we://probe_text' })
  text = '';

  @Property({ through: 'we://probe_list_item' })
  listItem = '';
}

interface StoredLink {
  data: { source: string; predicate: string; target: string };
}

/** A perspective holding a record whose two properties are set. */
function perspectiveWith(id: string) {
  const links: StoredLink[] = [
    { data: { source: id, predicate: 'we://probe_text', target: 'literal://string:hello' } },
    { data: { source: id, predicate: 'we://probe_list_item', target: 'literal://string:bullet' } },
  ];
  const perspective = {
    get: vi.fn(async ({ source, predicate }: { source?: string; predicate?: string }) =>
      links.filter((l) => l.data.source === source && l.data.predicate === predicate),
    ),
    removeLinks: vi.fn(async (gone: StoredLink[]) => {
      for (const link of gone) links.splice(links.indexOf(link), 1);
    }),
    executeAction: vi.fn(async () => {}),
  };
  return { perspective, links };
}

/** A record as a read leaves it: values set, snapshot taken. */
function loaded(perspective: unknown, id: string) {
  const probe = new Probe(perspective as never, id);
  probe.text = 'hello';
  probe.listItem = 'bullet';
  (probe as unknown as { takeSnapshot: () => void }).takeSnapshot();
  return probe;
}

beforeAll(() => installClearOnEmpty(Ad4mModel));

describe('clearOnEmpty on the pinned Ad4mModel', () => {
  // A batch id keeps `save()` from re-reading the record afterwards, which the fake cannot answer.
  const BATCH = 'batch-1';

  it('removes the links of a property emptied and saved', async () => {
    const id = 'we://probe-1';
    const { perspective, links } = perspectiveWith(id);
    const probe = loaded(perspective, id);

    probe.listItem = '';
    await probe.save(BATCH);

    expect(links.map((l) => l.data.predicate)).toEqual(['we://probe_text']);
    // Nothing is written for the emptied field: the SDK still skips it, so it is not written twice.
    expect(perspective.executeAction).not.toHaveBeenCalled();
  });

  it('still writes a field that has a value beside it', async () => {
    const id = 'we://probe-2';
    const { perspective, links } = perspectiveWith(id);
    const probe = loaded(perspective, id);

    probe.listItem = '';
    probe.text = 'changed';
    await probe.save(BATCH);

    expect(links.map((l) => l.data.predicate)).toEqual(['we://probe_text']);
    expect(perspective.executeAction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(perspective.executeAction.mock.calls[0])).toContain('changed');
  });

  it('removes the links of a property emptied through the static update', async () => {
    const id = 'we://probe-3';
    const { perspective, links } = perspectiveWith(id);
    const probe = loaded(perspective, id);
    // `Probe.update` reads the record and saves it; the read is the snapshot taken above.
    const get = vi.spyOn(Probe.prototype, 'get').mockImplementation(async function (this: Probe) {
      Object.assign(this, { text: probe.text, listItem: probe.listItem });
      (this as unknown as { takeSnapshot: () => void }).takeSnapshot();
      return this;
    });
    const getData = vi.spyOn(Probe.prototype, 'getData').mockImplementation(async function (this: Probe) {
      return this;
    });

    await Probe.update(perspective as never, id, { listItem: '' });

    expect(links.map((l) => l.data.predicate)).toEqual(['we://probe_text']);
    get.mockRestore();
    getData.mockRestore();
  });
});
