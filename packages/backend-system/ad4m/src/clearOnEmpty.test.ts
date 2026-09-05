/**
 * `''` clears a property.
 *
 * Every case here used to be a silent no-op, which is why the tests are written as "the links were
 * removed" rather than "save resolved": the old behaviour resolved too, and looked identical from
 * every angle except the perspective's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installClearOnEmpty } from './clearOnEmpty';

interface FakeLink {
  source: string;
  predicate: string;
}

/** A stand-in for `Ad4mModel` with just the shape the patch touches. */
function makeModelClass() {
  const setProperty = vi.fn(async (_key: string, _value: unknown, _batchId?: string) => {});

  class FakeModel {
    _baseExpression = 'we://record-1';
    _snapshot: unknown = { text: 'hello' };
    _perspective = {
      get: vi.fn(async ({ source, predicate }: { source?: string; predicate?: string }) =>
        links.filter((l) => l.source === source && l.predicate === predicate),
      ),
      removeLinks: vi.fn(async (toRemove: unknown[]) => {
        for (const link of toRemove as FakeLink[]) links.splice(links.indexOf(link), 1);
      }),
    };
    getPropertyMetadata(key: string) {
      return key === 'unknownProp' ? undefined : { through: `we://${key}` };
    }
    // On the prototype, exactly as `Ad4mModel`'s is — the patch replaces a prototype method, and an
    // instance field would shadow it.
    setProperty(key: string, value: unknown, batchId?: string): Promise<void> {
      return setProperty(key, value, batchId);
    }
  }

  const links: FakeLink[] = [
    { source: 'we://record-1', predicate: 'we://text' },
    { source: 'we://record-1', predicate: 'we://listItem' },
    { source: 'we://other', predicate: 'we://text' },
  ];

  return { FakeModel, links, setProperty };
}

describe('installClearOnEmpty', () => {
  let harness: ReturnType<typeof makeModelClass>;
  let model: InstanceType<ReturnType<typeof makeModelClass>['FakeModel']>;

  beforeEach(() => {
    harness = makeModelClass();
    installClearOnEmpty(harness.FakeModel as never);
    model = new harness.FakeModel();
  });

  it('removes the links for a property set to the empty string', async () => {
    // The content layer's case: turning a bullet back into a paragraph writes `listItem: ''`, and
    // the model kept the old value while the derived blob said otherwise.
    await (model as unknown as { setProperty: (k: string, v: unknown) => Promise<void> }).setProperty('listItem', '');
    expect(harness.links.map((l) => l.predicate)).toEqual(['we://text', 'we://text']);
  });

  it('removes only this record’s links, not another record’s under the same predicate', async () => {
    await (model as unknown as { setProperty: (k: string, v: unknown) => Promise<void> }).setProperty('text', '');
    expect(harness.links).toEqual([
      { source: 'we://record-1', predicate: 'we://listItem' },
      { source: 'we://other', predicate: 'we://text' },
    ]);
  });

  it('passes a real value straight through to the original', async () => {
    await (model as unknown as { setProperty: (k: string, v: unknown) => Promise<void> }).setProperty('text', 'hi');
    expect(harness.setProperty).toHaveBeenCalledWith('text', 'hi', undefined);
    expect(harness.links).toHaveLength(3);
  });

  it('leaves null and undefined alone — they are "not touched", not "cleared"', async () => {
    /*
      A model instance carries `undefined` for every optional field a caller never set, so treating
      those as a clear would turn an ordinary partial save into data loss. `''` is the one spelling
      WE gives that meaning.
    */
    const set = (model as unknown as { setProperty: (k: string, v: unknown) => Promise<void> }).setProperty.bind(model);
    await set('text', null);
    await set('text', undefined);
    expect(harness.links).toHaveLength(3);
  });

  it('does nothing for a record that has never been fetched', async () => {
    // No snapshot means the record is being created, so there is nothing stored to remove — and
    // `innerUpdate` has no dirty set on that path, so every empty field would otherwise pay for a
    // link query and a removal.
    model._snapshot = undefined;
    await (model as unknown as { setProperty: (k: string, v: unknown) => Promise<void> }).setProperty('text', '');
    expect(model._perspective.get).not.toHaveBeenCalled();
    expect(harness.links).toHaveLength(3);
  });

  it('survives a property it has no metadata for', async () => {
    await expect(
      (model as unknown as { setProperty: (k: string, v: unknown) => Promise<void> }).setProperty('unknownProp', ''),
    ).resolves.toBeUndefined();
    expect(harness.links).toHaveLength(3);
  });

  it('survives a perspective that throws, rather than failing the whole save', async () => {
    model._perspective.get = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      (model as unknown as { setProperty: (k: string, v: unknown) => Promise<void> }).setProperty('text', ''),
    ).resolves.toBeUndefined();
  });

  it('is idempotent — installing twice does not wrap twice', async () => {
    installClearOnEmpty(harness.FakeModel as never);
    await (model as unknown as { setProperty: (k: string, v: unknown) => Promise<void> }).setProperty('text', 'hi');
    expect(harness.setProperty).toHaveBeenCalledTimes(1);
  });
});
