import type { Ad4mModel } from '@coasys/ad4m';
import { describe, expect, it } from 'vitest';

import { installToOneValues } from './toOneValues';

/** A model class with one to-one and one to-many, whose save records what it was asked to write. */
function modelClass() {
  const saved: Record<string, unknown>[] = [];
  class Fake {
    _snapshot: Record<string, unknown> | null = null;
    [field: string]: unknown;
    static getModelMetadata() {
      return {
        className: 'Involvement',
        relations: { node: { kind: 'hasOne', maxCount: 1 }, children: { kind: 'hasMany' } },
      };
    }
    save() {
      saved.push({ node: this.node, children: this.children });
      return Promise.resolve();
    }
  }
  installToOneValues(Fake as unknown as typeof Ad4mModel);
  return { Fake, saved };
}

describe('a to-one relation on save', () => {
  it('is written as the id it was given', async () => {
    const { Fake, saved } = modelClass();
    const instance = Object.assign(new Fake(), { node: 'task-1' });
    await instance.save();
    expect(saved).toEqual([{ node: 'task-1', children: undefined }]);
    expect(instance.node).toBe('task-1');
  });

  it('is written as the id of a record given for it, and holds that id after', async () => {
    const { Fake, saved } = modelClass();
    const instance = Object.assign(new Fake(), { node: { id: 'task-1', title: 'A task' } });
    await instance.save();
    expect(saved[0].node).toBe('task-1');
    expect(instance.node).toBe('task-1');
  });

  it('is refused as a list, while a to-many takes one', async () => {
    const { Fake, saved } = modelClass();
    expect(() => Object.assign(new Fake(), { node: ['task-1'] }).save()).toThrow(/to-one/);
    await Object.assign(new Fake(), { node: 'task-1', children: ['a', 'b'] }).save();
    expect(saved).toEqual([{ node: 'task-1', children: ['a', 'b'] }]);
  });

  it('is left alone when it is the record as it was read', async () => {
    const { Fake, saved } = modelClass();
    const read = { id: 'task-1', title: 'A task' };
    const instance = Object.assign(new Fake(), { node: read });
    instance._snapshot = { node: read };
    await instance.save();
    expect(saved[0].node).toBe(read);
  });
});
