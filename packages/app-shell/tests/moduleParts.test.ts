/**
 * `$part` — placing a module's named fragment, and pointing it at something else.
 *
 * `ModuleDefinition.schemas` has said "named schema fragments a template can place" since it was
 * written, and nothing read the registry it fills: the promise existed and the mechanism did not, so
 * an interface that wanted a module's transcript beside its own board hand-wrote a copy of it. Both
 * halves of this are worth pinning — that a part is found and expanded, and that a placer can point
 * it at a record the module has never heard of, which is the difference between a reusable fragment
 * and one welded to whatever state its module happens to hold.
 */
import { resolveParts } from '@shared/registries/moduleParts';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import type { ModuleDefinition } from '@we/module-shared';
import type { SchemaNode } from '@we/schema-shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const feed: SchemaNode = {
  type: 'Column',
  children: [
    {
      type: '$if',
      props: { condition: { $: 'modules.demo.collectionId' }, then: { type: 'we-text' } },
    },
    { type: 'we-list', props: { anchorId: { $: 'modules.demo.collectionId' } } },
  ],
};

const definition = {
  id: 'demo',
  name: 'Demo',
  schemas: {
    feed: { node: feed, subject: 'modules.demo.collectionId' },
    plain: { type: 'we-badge' },
  },
} as unknown as ModuleDefinition;

function withModule<T>(run: () => T): T {
  moduleRegistry.register(definition);
  try {
    return run();
  } finally {
    moduleRegistry.unregister('demo');
  }
}

const place = (props: Record<string, unknown>): SchemaNode => ({
  type: 'Column',
  children: [{ type: '$part', props }],
});

afterEach(() => vi.restoreAllMocks());

describe('placing a module part', () => {
  it('expands the module’s own node where the marker was', () => {
    withModule(() => {
      const resolved = resolveParts(place({ id: 'demo.plain' })) as SchemaNode;

      expect((resolved.children as SchemaNode[])[0].type).toBe('we-badge');
    });
  });

  it('points it at another record when the placer names one', () => {
    withModule(() => {
      const resolved = resolveParts(place({ id: 'demo.feed', subject: { $: 'routeStore.params.call' } }));

      const json = JSON.stringify(resolved);
      expect(json).toContain('routeStore.params.call');
      // Every occurrence, not the first: the feed asks about its subject twice, once to decide
      // whether to render at all and once to scope the query.
      expect(json).not.toContain('modules.demo.collectionId');
    });
  });

  it('leaves the module’s own subject alone when the placer names none', () => {
    withModule(() => {
      const resolved = resolveParts(place({ id: 'demo.feed' }));

      expect(JSON.stringify(resolved)).toContain('modules.demo.collectionId');
    });
  });

  it('substitutes whole expressions only', () => {
    // A part whose expression *mentions* the subject inside a larger sentence is left alone: a
    // partial rewrite of somebody else's expression is how substitution starts producing sentences
    // nobody wrote.
    const mentions = {
      id: 'demo',
      name: 'Demo',
      schemas: {
        feed: {
          node: { type: 'we-text', props: { text: { $: 'modules.demo.collectionId ? 1 : 2' } } },
          subject: 'modules.demo.collectionId',
        },
      },
    } as unknown as ModuleDefinition;
    moduleRegistry.register(mentions);
    try {
      const resolved = resolveParts(place({ id: 'demo.feed', subject: 'other' }));
      expect(JSON.stringify(resolved)).toContain('modules.demo.collectionId ? 1 : 2');
    } finally {
      moduleRegistry.unregister('demo');
    }
  });

  it('renders nothing for a part nobody publishes, and says so', () => {
    // The ordinary case is a module that is not installed, so this is a warning rather than a throw
    // — but it is *reported*, because a part that silently renders nothing is indistinguishable
    // from one that rendered an empty list.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const resolved = resolveParts(place({ id: 'nobody.feed' })) as SchemaNode;

    expect(resolved.children).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
