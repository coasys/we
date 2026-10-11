/**
 * Working copies of sections edited where their shell draws them.
 *
 * Two properties carry the whole design. An edit keeps the copy's identity, so what draws it updates
 * the nodes that changed rather than being handed a new section to remount. And the copy is keyed by
 * the template's origin as well as its id, since an agent's template and a space's can share one.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { createTemplateDrafts } from '../src/frameworks/solid/stores/templateDrafts';

const about = (): TemplateSchema =>
  ({
    id: 'about-1',
    type: 'Column',
    meta: { name: 'About', description: '', icon: 'browser', role: 'view' },
    _fromSpace: true,
    children: [{ id: 'aaaaaaaaaa', type: 'we-text', children: ['Hello'] }],
  }) as TemplateSchema;

describe('template drafts', () => {
  it('opens a working copy once, and answers with the same copy after', () =>
    createRoot((dispose) => {
      const drafts = createTemplateDrafts();
      const saved = about();
      const draft = drafts.openDraft(saved);
      expect(draft).not.toBe(saved);
      expect(drafts.openDraft(saved)).toBe(draft);
      expect(drafts.draftOf(saved)).toBe(draft);
      dispose();
    }));

  it('applies an edit in place, keeping the copy and its origin', () =>
    createRoot((dispose) => {
      const drafts = createTemplateDrafts();
      const draft = drafts.openDraft(about());
      const before = draft.children;
      const next = about();
      delete next._fromSpace;
      (next.children![0] as { children: string[] }).children = ['Hello, world'];
      drafts.updateDraft(draft, next);
      expect((draft.children![0] as { children: string[] }).children).toEqual(['Hello, world']);
      expect(draft.children).toBe(before);
      expect(draft._fromSpace).toBe(true);
      dispose();
    }));

  it('keys a copy by origin, so an agent’s template and a space’s never share one', () =>
    createRoot((dispose) => {
      const drafts = createTemplateDrafts();
      const space = drafts.openDraft(about());
      const own = { ...about() };
      delete own._fromSpace;
      expect(drafts.draftOf(own)).toBeUndefined();
      expect(drafts.openDraft(own)).not.toBe(space);
      dispose();
    }));

  it('drops a copy, and what draws it goes back to the saved template', () =>
    createRoot((dispose) => {
      const drafts = createTemplateDrafts();
      const saved = about();
      const draft = drafts.openDraft(saved);
      drafts.closeDraft(draft);
      expect(drafts.draftOf(saved)).toBeUndefined();
      dispose();
    }));
});
