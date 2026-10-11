/**
 * What the editing session edits, as distinct from what is on screen.
 *
 * With the template on screen as the target nothing changes; what this pins is the seam every editing
 * path now goes through, and the one thing about it that is new: its history is keyed with the
 * template's origin, so a space's template and an agent's that share an id never share an undo stack.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { createEditTarget } from '../src/frameworks/solid/stores/editTarget';

function setup(screen: TemplateSchema) {
  const saved: TemplateSchema[] = [];
  const updated: TemplateSchema[] = [];
  const store = {
    get currentTemplate() {
      return screen;
    },
    updateTemplate: (next: TemplateSchema) => updated.push(next),
    persistTemplate: async (template: TemplateSchema) => void saved.push(template),
    isBuiltInTemplateId: (id: string) => id === 'default',
  };
  return { edit: createEditTarget(store as never), saved, updated };
}

describe('the edit target', () => {
  it('is the template on screen, and edits and saves go to it', async () => {
    const screen = { id: 'mine', type: 'Column', meta: { name: 'Mine' } } as TemplateSchema;
    const { edit, saved, updated } = setup(screen);
    expect(edit.target()).toEqual({ kind: 'screen' });
    expect(edit.template()).toBe(screen);
    edit.update({ ...screen, children: [] });
    await edit.persist();
    expect(updated).toHaveLength(1);
    expect(saved).toEqual([screen]);
  });

  it('is read-only for a built-in', () => {
    expect(setup({ id: 'default', type: 'Column' } as TemplateSchema).edit.isBuiltIn()).toBe(true);
    expect(setup({ id: 'mine', type: 'Column' } as TemplateSchema).edit.isBuiltIn()).toBe(false);
  });

  it('keys its history with where the template came from', () => {
    const own = setup({ id: 'about-1', type: 'Column' } as TemplateSchema).edit.key();
    const space = setup({ id: 'about-1', type: 'Column', _fromSpace: true } as TemplateSchema).edit.key();
    expect(own).not.toBe(space);
  });
});
