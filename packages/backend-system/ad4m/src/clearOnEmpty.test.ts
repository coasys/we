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

    /**
     * What the real `innerUpdate` does with the fields it is given, in one line.
     *
     * The filter is the whole point of the second patch: `value !== ''` is why the `setProperty`
     * wrapper above was never reached from `save()`. Reproduced here rather than described, so a
     * test that passes says the clearing happens *despite* it.
     */
    innerUpdate(setProperties = true, batchId?: string): Promise<void> {
      return innerUpdate(this as never, setProperties, batchId);
    }

    /** Every field whose current value differs from the snapshot — the real one's contract. */
    changedFields(): string[] {
      const snapshot = (this._snapshot ?? {}) as Record<string, unknown>;
      const self = this as unknown as Record<string, unknown>;
      return Object.keys(snapshot).filter((key) => self[key] !== snapshot[key]);
    }

    /** As `Ad4mModel.save()` does for a record that already exists. */
    save(batchId?: string): Promise<void> {
      return (this as unknown as { innerUpdate: (s: boolean, b?: string) => Promise<void> }).innerUpdate(true, batchId);
    }
  }

  const innerUpdate = vi.fn(async (model: Record<string, unknown>, setProperties: boolean, batchId?: string) => {
    if (!setProperties) return;
    const snapshot = (model._snapshot ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(snapshot)) {
      const value = model[key];
      // The real filter, verbatim — see the note on the method above.
      if (value === undefined || value === null || value === '') continue;
      await (model as unknown as { setProperty: (k: string, v: unknown, b?: string) => Promise<void> }).setProperty(
        key,
        value,
        batchId,
      );
    }
  });

  const links: FakeLink[] = [
    { source: 'we://record-1', predicate: 'we://text' },
    { source: 'we://record-1', predicate: 'we://listItem' },
    { source: 'we://other', predicate: 'we://text' },
  ];

  return { FakeModel, links, setProperty, innerUpdate };
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

/**
 * The path callers actually take.
 *
 * Everything above tests the `setProperty` wrapper by calling it, which is the only way to test a
 * wrapper and says nothing about whether the wrapped method is ever reached. It was not: `save()`
 * runs `innerUpdate`, which drops `''` before `setProperty` is called, so every case above was
 * green while the behaviour they describe did not happen in the app.
 */
describe('clearing through save()', () => {
  let harness: ReturnType<typeof makeModelClass>;
  let model: InstanceType<ReturnType<typeof makeModelClass>['FakeModel']> & Record<string, unknown>;

  beforeEach(() => {
    harness = makeModelClass();
    installClearOnEmpty(harness.FakeModel as never);
    model = new harness.FakeModel() as never;
    model._snapshot = { text: 'hello', listItem: 'bullet' };
    model.text = 'hello';
    model.listItem = 'bullet';
  });

  it('removes the links for a property emptied and saved', async () => {
    // The state colour's reset, and the content layer's four: `record.color = ''; await save()`.
    model.listItem = '';
    await (model as unknown as { save: () => Promise<void> }).save();
    expect(harness.links.map((l) => l.predicate)).toEqual(['we://text', 'we://text']);
  });

  it('still writes the fields that have values', async () => {
    model.listItem = '';
    model.text = 'changed';
    await (model as unknown as { save: () => Promise<void> }).save();
    expect(harness.setProperty).toHaveBeenCalledWith('text', 'changed', undefined);
    // Cleared rather than written — the original skips it, so nothing is written twice.
    expect(harness.setProperty).not.toHaveBeenCalledWith('listItem', '', undefined);
  });

  it('leaves a field alone when it was already empty', async () => {
    // Not dirty: it has always been empty, so there is nothing stored to remove and no link query
    // worth paying for.
    model._snapshot = { text: 'hello', listItem: '' };
    model.listItem = '';
    await (model as unknown as { save: () => Promise<void> }).save();
    expect(model._perspective.get).not.toHaveBeenCalled();
    expect(harness.links).toHaveLength(3);
  });

  it('does not clear on the create path', async () => {
    // `setProperties: false` is `create` with a constructor, where `create_subject` writes the
    // values map and there is nothing stored to remove.
    model.listItem = '';
    await (model as unknown as { innerUpdate: (s: boolean) => Promise<void> }).innerUpdate(false);
    expect(harness.links).toHaveLength(3);
  });

  it('does not clear a flag or a read-only property', async () => {
    // Immutable after creation — `innerUpdate` refuses to write them, and the same reasoning
    // applies to removing them.
    model.getPropertyMetadata = (key: string) =>
      key === 'listItem' ? { through: 'we://listItem', flag: true } : { through: `we://${key}` };
    model.listItem = '';
    await (model as unknown as { save: () => Promise<void> }).save();
    expect(harness.links).toHaveLength(3);
  });
});
