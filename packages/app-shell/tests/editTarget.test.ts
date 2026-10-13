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
  const drafted: { draft: TemplateSchema; next: TemplateSchema }[] = [];
  const open = new Set<TemplateSchema>();
  const store = {
    get currentTemplate() {
      return screen;
    },
    updateTemplate: (next: TemplateSchema) => updated.push(next),
    openDraft: (template: TemplateSchema) => {
      const draft = { ...template };
      open.add(draft);
      return draft;
    },
    updateDraft: (draft: TemplateSchema, next: TemplateSchema) => drafted.push({ draft, next }),
    closeDraft: (draft: TemplateSchema) => open.delete(draft),
    persistTemplate: async (template: TemplateSchema) => void saved.push(template),
    isBuiltInTemplateId: (id: string) => id === 'default',
  };
  return { edit: createEditTarget(store as never), saved, updated, drafted, open };
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

/*
  A section edited where its shell draws it. The session edits a working copy of it, which the shell
  draws in its place, and coming back out drops the copy — every edit was saved as it was made.
*/
describe('a section as the edit target', () => {
  const screen = { id: 'shell', type: 'Column', meta: { name: 'Shell' } } as TemplateSchema;
  const about = {
    id: 'about-1',
    type: 'Column',
    meta: { name: 'About', role: 'view' },
    _fromSpace: true,
  } as TemplateSchema;

  it('edits and saves the section’s working copy, not the template on screen', async () => {
    const { edit, saved, updated, drafted } = setup(screen);
    edit.enterSection('about-1', about);
    expect(edit.target()).toMatchObject({ kind: 'section', id: 'about-1', name: 'About' });
    const draft = edit.template();
    expect(draft).not.toBe(about);
    expect(draft.meta?.name).toBe('About');
    edit.update({ ...about, children: [] });
    await edit.persist();
    expect(updated).toEqual([]);
    expect(drafted.map((d) => d.draft)).toEqual([draft]);
    expect(saved).toEqual([draft]);
  });

  it('has a history of its own', () => {
    const { edit } = setup(screen);
    const onScreen = edit.key();
    edit.enterSection('about-1', about);
    expect(edit.key()).not.toBe(onScreen);
  });

  it('drops the working copy on the way out, and is the template on screen again', () => {
    const { edit, open } = setup(screen);
    edit.enterSection('about-1', about);
    expect(open.size).toBe(1);
    edit.leave();
    expect(open.size).toBe(0);
    expect(edit.target()).toEqual({ kind: 'screen' });
    expect(edit.template()).toBe(screen);
  });

  it('leaves one section for another, never holding two copies open', () => {
    const { edit, open } = setup(screen);
    edit.enterSection('about-1', about);
    edit.enterSection('cards-1', { ...about, id: 'cards-1', meta: { name: 'Cards', role: 'view' } } as TemplateSchema);
    expect(open.size).toBe(1);
    expect(edit.target()).toMatchObject({ id: 'cards-1' });
  });
});

/*
  The app around every space, edited where it is drawn. WE's own app ships with the build, so editing
  it is a fork, exactly as editing a built-in template is.
*/
describe('the app as the edit target', () => {
  const screen = { id: 'shell', type: 'Column', meta: { name: 'Shell' } } as TemplateSchema;

  it('edits the app’s working copy, and comes back out to the page', () => {
    const { edit, open } = setup(screen);
    const mine = { id: 'my-app', type: 'Column', meta: { name: 'Mine', role: 'app' } } as TemplateSchema;
    edit.enterApp(mine);
    expect(edit.target()).toMatchObject({ kind: 'app' });
    expect(edit.template().id).toBe('my-app');
    expect(edit.isBuiltIn()).toBe(false);
    edit.leave();
    expect(open.size).toBe(0);
    expect(edit.template()).toBe(screen);
  });

  it('treats WE’s own app as built in, so editing it forks', () => {
    const { edit } = setup(screen);
    edit.enterApp({ id: 'we-app', type: 'Column', meta: { name: 'WE', role: 'app' } } as TemplateSchema);
    expect(edit.isBuiltIn()).toBe(true);
  });
});
