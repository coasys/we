/**
 * Working copies of sections edited where their shell draws them.
 *
 * Two properties carry the whole design. An edit keeps the copy's identity, so what draws it updates
 * the nodes that changed rather than being handed a new section to remount. And the copy is keyed by
 * the template's origin as well as its id, since an agent's template and a space's can share one.
 *
 * Run over Solid's live documents and over the plain ones on the test port. Only Solid's keeps the
 * very objects a reader holds across an edit; the plain ones hand out the edited tree afresh.
 */
import type { LiveTemplates } from '@shared/liveTemplate';
import { plainLiveTemplates } from '@shared/liveTemplate';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import type { TemplateSchema } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { solidLiveTemplates } from '../src/frameworks/solid/stores/liveTemplate';
import { createTemplateDrafts } from '../src/shared/templateDrafts';
import { createVueReactivity } from './support/vueReactivity';

const hosts: [string, () => { reactivity: ReactivityPort; liveTemplates: LiveTemplates; fine: boolean }][] = [
  ['Solid', () => ({ reactivity: solidReactivity, liveTemplates: solidLiveTemplates, fine: true })],
  [
    'the test port',
    () => {
      const reactivity = createTestReactivity();
      return { reactivity, liveTemplates: plainLiveTemplates(reactivity), fine: false };
    },
  ],
  [
    'Vue',
    () => {
      const reactivity = createVueReactivity();
      return { reactivity, liveTemplates: plainLiveTemplates(reactivity), fine: false };
    },
  ],
];

const about = (): TemplateSchema =>
  ({
    id: 'about-1',
    type: 'Column',
    meta: { name: 'About', description: '', icon: 'browser', role: 'view' },
    _fromSpace: true,
    children: [{ id: 'aaaaaaaaaa', type: 'we-text', children: ['Hello'] }],
  }) as TemplateSchema;

describe.each(hosts)('template drafts under %s', (_name, host) => {
  const within = (run: (drafts: ReturnType<typeof createTemplateDrafts>, fine: boolean) => void) => {
    const { reactivity, liveTemplates, fine } = host();
    const dispose = reactivity.root(() => run(createTemplateDrafts({ reactivity, liveTemplates }), fine));
    dispose();
  };

  it('opens a working copy once, and answers with the same copy after', () =>
    within((drafts) => {
      const saved = about();
      const draft = drafts.openDraft(saved);
      expect(draft).not.toBe(saved);
      expect(drafts.openDraft(saved)).toBe(draft);
      expect(drafts.draftOf(saved)).toBe(draft);
    }));

  it('applies an edit, keeping the copy’s origin — and, finely drawn, the copy itself', () =>
    within((drafts, fine) => {
      const saved = about();
      const draft = drafts.openDraft(saved);
      const before = draft.children;
      const next = about();
      delete next._fromSpace;
      (next.children![0] as { children: string[] }).children = ['Hello, world'];
      drafts.updateDraft(draft, next);
      const edited = drafts.draftOf(saved)!;
      expect((edited.children![0] as { children: string[] }).children).toEqual(['Hello, world']);
      expect(edited._fromSpace).toBe(true);
      if (fine) expect(draft.children).toBe(before);
    }));

  it('refuses an edit that does not validate, and says why', () => {
    const { reactivity, liveTemplates } = host();
    const said: string[] = [];
    const dispose = reactivity.root(() => {
      const drafts = createTemplateDrafts({ reactivity, liveTemplates, onInvalid: (m) => said.push(m) });
      const saved = about();
      const draft = drafts.openDraft(saved);
      // A format newer than this host reads.
      drafts.updateDraft(draft, { ...about(), schemaVersion: 99 } as never);
      expect((drafts.draftOf(saved)!.children![0] as { type: string }).type).toBe('we-text');
    });
    dispose();
    expect(said).toHaveLength(1);
  });

  it('keys a copy by origin, so an agent’s template and a space’s never share one', () =>
    within((drafts) => {
      const space = drafts.openDraft(about());
      const own = { ...about() };
      delete own._fromSpace;
      expect(drafts.draftOf(own)).toBeUndefined();
      expect(drafts.openDraft(own)).not.toBe(space);
    }));

  it('drops a copy, and what draws it goes back to the saved template', () =>
    within((drafts) => {
      const saved = about();
      const draft = drafts.openDraft(saved);
      drafts.closeDraft(draft);
      expect(drafts.draftOf(saved)).toBeUndefined();
    }));

  it('wakes a reader of which drafts exist as they open and close', () => {
    const { reactivity, liveTemplates } = host();
    const seen: boolean[] = [];
    const saved = about();
    let drafts!: ReturnType<typeof createTemplateDrafts>;
    const dispose = reactivity.root(() => {
      drafts = createTemplateDrafts({ reactivity, liveTemplates });
      reactivity.effect(() => void seen.push(!!drafts.draftOf(saved)));
    });
    drafts.closeDraft(drafts.openDraft(saved));
    dispose();
    expect(seen).toEqual([false, true, false]);
  });
});
