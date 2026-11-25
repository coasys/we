/**
 * The live-document handle a store holds a drawn template by, as each implementation keeps it:
 * Solid's nested store and the plain one any port can run.
 *
 * The contract is the handle's: an update validates first and touches nothing when refused, an
 * update that changes nothing wakes nobody, and a reader of a field wakes when that field changes.
 */
import { type LiveTemplates, plainLiveTemplates } from '@shared/liveTemplate';
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import type { TemplateSchema } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { solidLiveTemplates } from '../src/frameworks/solid/stores/liveTemplate';

const hosts: [string, () => { reactivity: ReactivityPort; liveTemplates: LiveTemplates }][] = [
  ['Solid', () => ({ reactivity: solidReactivity, liveTemplates: solidLiveTemplates })],
  [
    'the plain documents on the test port',
    () => {
      const reactivity = createTestReactivity();
      return { reactivity, liveTemplates: plainLiveTemplates(reactivity) };
    },
  ],
];

const tree = (text: string): TemplateSchema =>
  ({
    schemaVersion: 1,
    id: 'board',
    type: 'Column',
    meta: { name: 'Board', description: '', icon: 'kanban' },
    children: [{ id: 'aaaaaaaaaa', type: 'we-text', children: [text] }],
  }) as TemplateSchema;

const textOf = (t: TemplateSchema) => (t.children![0] as { children: string[] }).children[0];

describe.each(hosts)('a live template under %s', (_name, host) => {
  it('wakes a reader of a field when an update changes it, and not when nothing changes', () => {
    const { reactivity, liveTemplates } = host();
    const seen: string[] = [];
    let live!: ReturnType<LiveTemplates>;
    const dispose = reactivity.root(() => {
      live = liveTemplates(tree('one'));
      reactivity.effect(() => void seen.push(textOf(live.read())));
    });
    expect(live.update(tree('two'))).toEqual({ applied: true });
    expect(live.update(tree('two'))).toEqual({ applied: true });
    dispose();
    expect(seen).toEqual(['one', 'two']);
  });

  it('refuses an update that does not validate and leaves the tree as it was', () => {
    const { reactivity, liveTemplates } = host();
    const dispose = reactivity.root(() => {
      const live = liveTemplates(tree('one'));
      // A format newer than this host reads.
      const result = live.update({ ...tree('two'), schemaVersion: 99 } as never);
      expect(result.applied).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(textOf(live.read())).toBe('one');
    });
    dispose();
  });

  it('puts a different template in place whole', () => {
    const { reactivity, liveTemplates } = host();
    const seen: string[] = [];
    let live!: ReturnType<LiveTemplates>;
    const dispose = reactivity.root(() => {
      live = liveTemplates(tree('one'));
      reactivity.effect(() => void seen.push(live.read().meta.name));
    });
    live.replace({ ...tree('one'), id: 'feed', meta: { name: 'Feed', description: '', icon: 'rss' } });
    expect(live.read().id).toBe('feed');
    dispose();
    expect(seen).toEqual(['Board', 'Feed']);
  });
});
