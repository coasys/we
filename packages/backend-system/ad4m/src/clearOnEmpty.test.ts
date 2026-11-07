/**
 * `''` clears a property.
 *
 * Every case here used to be a silent no-op, which is why the tests are written as "the links were
 * removed" rather than "save resolved": the old behaviour resolved too, and looked identical from
 * every angle except the perspective's.
 *
 * These run on a stand-in, which is what lets them reach the edges (a perspective that throws, a
 * property with no metadata). Whether the real SDK still runs `save()` and `update()` through the
 * wrapped method is `clearOnEmpty.sdk.test.ts`'s question.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installClearOnEmpty } from './clearOnEmpty';

interface FakeLink {
  source: string;
  predicate: string;
}

/** A stand-in for `Ad4mModel` with just the shape the patch touches. */
function makeModelClass() {
  /** Records each property write the original `innerUpdate` plans. */
  const writeProperty = vi.fn(async (_key: string, _value: unknown, _batchId?: string) => {});

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

    /**
     * What the real `innerUpdate` does with the fields it is given, in one line.
     *
     * The filter is the whole point of the patch: `planProperty` skips `''`, so nothing the original
     * writes can clear a field. Reproduced here rather than described, so a test that passes says the
     * clearing happens *despite* it. On the prototype, exactly as `Ad4mModel`'s is — the patch
     * replaces a prototype method, and an instance field would shadow it.
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
      await writeProperty(key, value, batchId);
    }
  });

  const links: FakeLink[] = [
    { source: 'we://record-1', predicate: 'we://text' },
    { source: 'we://record-1', predicate: 'we://listItem' },
    { source: 'we://other', predicate: 'we://text' },
  ];

  return { FakeModel, links, writeProperty, innerUpdate };
}

describe('clearing through save()', () => {
  let harness: ReturnType<typeof makeModelClass>;
  let model: InstanceType<ReturnType<typeof makeModelClass>['FakeModel']> & Record<string, unknown>;
  const save = () => (model as unknown as { save: () => Promise<void> }).save();

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
    await save();
    expect(harness.links.map((l) => l.predicate)).toEqual(['we://text', 'we://text']);
  });

  it('removes only this record’s links, not another record’s under the same predicate', async () => {
    model.text = '';
    await save();
    expect(harness.links).toEqual([
      { source: 'we://record-1', predicate: 'we://listItem' },
      { source: 'we://other', predicate: 'we://text' },
    ]);
  });

  it('still writes the fields that have values', async () => {
    model.listItem = '';
    model.text = 'changed';
    await save();
    expect(harness.writeProperty).toHaveBeenCalledWith('text', 'changed', undefined);
    // Cleared rather than written — the original skips it, so nothing is written twice.
    expect(harness.writeProperty).not.toHaveBeenCalledWith('listItem', '', undefined);
  });

  it('leaves null and undefined alone — they are "not touched", not "cleared"', async () => {
    /*
      A model instance carries `undefined` for every optional field a caller never set, so treating
      those as a clear would turn an ordinary partial save into data loss. `''` is the one spelling
      WE gives that meaning.
    */
    model.text = null;
    model.listItem = undefined;
    await save();
    expect(model._perspective.get).not.toHaveBeenCalled();
    expect(harness.links).toHaveLength(3);
  });

  it('leaves a field alone when it was already empty', async () => {
    // Not dirty: it has always been empty, so there is nothing stored to remove and no link query
    // worth paying for.
    model._snapshot = { text: 'hello', listItem: '' };
    model.listItem = '';
    await save();
    expect(model._perspective.get).not.toHaveBeenCalled();
    expect(harness.links).toHaveLength(3);
  });

  it('does nothing for a record that has never been fetched', async () => {
    // No snapshot means the record is being created, so there is nothing stored to remove.
    model._snapshot = undefined;
    model.text = '';
    await save();
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
    await save();
    expect(harness.links).toHaveLength(3);
  });

  it('survives a property it has no metadata for', async () => {
    model._snapshot = { text: 'hello', unknownProp: 'x' };
    model.unknownProp = '';
    await expect(save()).resolves.toBeUndefined();
    expect(harness.links).toHaveLength(3);
  });

  it('survives a perspective that throws, rather than failing the whole save', async () => {
    model._perspective.get = vi.fn(async () => {
      throw new Error('offline');
    });
    model.text = '';
    model.listItem = 'changed';
    await expect(save()).resolves.toBeUndefined();
    expect(harness.writeProperty).toHaveBeenCalledWith('listItem', 'changed', undefined);
  });

  it('is idempotent — installing twice does not wrap twice', async () => {
    installClearOnEmpty(harness.FakeModel as never);
    model.text = '';
    await save();
    expect(model._perspective.get).toHaveBeenCalledTimes(1);
  });
});
