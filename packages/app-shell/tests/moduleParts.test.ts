/**
 * `$part` — placing a module's named fragment, and pointing it at something else.
 *
 * `contributes.parts` is where a module publishes named fragments a template can place, and for a
 * long time nothing read the registry it fills: the promise existed and the mechanism did not, so an
 * interface that wanted a module's transcript beside its own board hand-wrote a copy of it. Both
 * halves of this are worth pinning — that a part is found and expanded, and that a placer can point
 * it at a record the module has never heard of, which is the difference between a reusable fragment
 * and one welded to whatever state its module happens to hold.
 */
import { openPart, openPartPath, resolveParts, resolvePartsInRoutes } from '@shared/registries/moduleParts';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import type { ModuleDefinition } from '@we/module-shared';
import { findNodeById, forEachNode, type SchemaNode, type SchemaProp } from '@we/schema-shared';
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

const definition: ModuleDefinition = {
  manifest: { id: 'demo', name: 'Demo' },
  contributes: {
    parts: {
      feed: { node: feed, subject: 'modules.demo.collectionId' },
      plain: { type: 'we-badge' },
    },
  },
};

/** What every module is registered against here; nothing in these tests depends on either name. */
const host = { backend: 'ad4m', framework: 'solid' };

function withModule<T>(run: () => T): T {
  moduleRegistry.register(definition, host);
  try {
    return run();
  } finally {
    moduleRegistry.unregister('demo');
  }
}

const place = (props: Record<string, SchemaProp>): SchemaNode => ({
  type: 'Column',
  children: [{ type: '$part', props }],
});

afterEach(() => vi.restoreAllMocks());

describe('placing a module part', () => {
  it('expands the module’s own node where the marker was, inside a frame naming the part', () => {
    withModule(() => {
      const resolved = resolveParts(place({ id: 'demo.plain' })) as SchemaNode;
      const frame = (resolved.children as SchemaNode[])[0];

      expect(frame.type).toBe('PartFrame');
      expect(frame.props).toEqual({ part: 'demo.plain' });
      expect((frame.children as SchemaNode[])[0].type).toBe('we-badge');
    });
  });

  /*
    The frame carries the placement's own id — the template's node — so the visual editor selects
    the `$part` rather than a node of the module's, and the inspector finds it in the template.
  */
  it('keeps the placement’s id on the frame', () => {
    withModule(() => {
      const resolved = resolveParts({
        type: 'Column',
        children: [{ id: 'k3j9x0q2pd', type: '$part', props: { id: 'demo.plain' } }],
      }) as SchemaNode;
      const frame = (resolved.children as SchemaNode[])[0];

      expect(frame.id).toBe('k3j9x0q2pd');
      expect((frame.props as { at?: string }).at).toBe('k3j9x0q2pd');
    });
  });

  /*
    A part reading a name its parents bind declares it, and a placement where nothing binds it says
    what it is. The binding is a one-row `$each` — the one node that binds a value to a name.
  */
  it('binds the inputs a placement provides around the part', () => {
    withModule(() => {
      const resolved = resolveParts(place({ id: 'demo.plain', inputs: { tile: { $: 'local.chosen' } } })) as SchemaNode;
      const bound = ((resolved.children as SchemaNode[])[0].children as SchemaNode[])[0];

      expect(bound.type).toBe('$each');
      expect(bound.props).toEqual({ items: { $: '[local.chosen]' }, as: 'tile' });
      expect((bound.children as SchemaNode[])[0].type).toBe('we-badge');
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
    const mentions: ModuleDefinition = {
      manifest: { id: 'demo', name: 'Demo' },
      contributes: {
        parts: {
          feed: {
            node: { type: 'we-text', props: { text: { $: 'modules.demo.collectionId ? 1 : 2' } } },
            subject: 'modules.demo.collectionId',
          },
        },
      },
    };
    moduleRegistry.register(mentions, host);
    try {
      const resolved = resolveParts(place({ id: 'demo.feed', subject: 'other' }));
      expect(JSON.stringify(resolved)).toContain('modules.demo.collectionId ? 1 : 2');
    } finally {
      moduleRegistry.unregister('demo');
    }
  });

  it('leaves an empty frame for a part nobody publishes, and says so', () => {
    // The ordinary case is a module that is not installed, so this is a warning rather than a throw
    // — but it is *reported*, and the frame stays, so what stands in its place can say what is missing.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const resolved = resolveParts(place({ id: 'nobody.feed' })) as SchemaNode;
    const frame = (resolved.children as SchemaNode[])[0];

    expect(frame.type).toBe('PartFrame');
    expect(frame.children).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});

/**
 * Parts outside a panel.
 *
 * `TemplatePanelBody` was the only thing that expanded them, so an interface could compose a
 * module's fragments in a panel and nowhere else — not on one of its own pages, and not in the
 * chrome standing over every page. That was never decided, only where the need first appeared, and
 * the failure it produced was the silent one this whole mechanism warns about: the marker survived
 * the walk, reached the renderer, and mounted nothing.
 */
describe('placing a part outside a panel', () => {
  it('expands inside a route body', () => {
    withModule(() => {
      const routes = [{ path: '/board', type: 'Column', children: [{ type: '$part', props: { id: 'demo.plain' } }] }];

      const resolved = resolvePartsInRoutes(routes) as typeof routes;

      expect(JSON.stringify(resolved)).toContain('we-badge');
      expect(JSON.stringify(resolved)).not.toContain('$part');
    });
  });

  it('descends into a route that carries no type of its own', () => {
    /*
      The trap that made the first attempt at this wrong. A route is `{ path, children, routes }`
      and often carries no `type` at all — so it failed the "is this a node" test, and its whole
      subtree went unexamined while looking exactly like a subtree with no parts in it. The host
      wraps every template's routes in one of these, so it was every template.
    */
    withModule(() => {
      const routes = [
        {
          path: '/space/:spaceId',
          children: [{ type: '$routes' }],
          routes: [{ path: '/board', type: 'Column', children: [{ type: '$part', props: { id: 'demo.plain' } }] }],
        },
      ];

      expect(JSON.stringify(resolvePartsInRoutes(routes))).toContain('we-badge');
    });
  });

  it('expands in a template’s root node, which is its chrome', () => {
    // The root is rendered outside the router, so the route table never sees it — an interface with
    // a bar standing over every page puts a module's fragment there and nowhere a route walk looks.
    withModule(() => {
      const root = {
        type: 'Column',
        meta: { name: 'Demo', description: '', icon: 'circle' },
        children: [{ type: '$part', props: { id: 'demo.plain' } }],
      } as unknown as SchemaNode;

      const resolved = resolveParts(root) as SchemaNode;

      expect(JSON.stringify(resolved)).toContain('we-badge');
      // The walk rebuilds the node, so anything hanging off it has to survive the copy — `meta` is
      // what says a template is a template, and losing it would unname the interface.
      expect((resolved as unknown as { meta: { name: string } }).meta.name).toBe('Demo');
    });
  });

  it('returns a route table with no parts in it by identity', () => {
    // What makes this free for every interface that places none: a memo built on it re-runs nothing
    // downstream, because nothing downstream sees a new object.
    const routes = [{ path: '/board', type: 'Column', children: [{ type: 'we-text' }] }];

    expect(resolvePartsInRoutes(routes)).toBe(routes);
  });
});

/*
  What the editor writes in a part's place when somebody takes it over. Opening one level keeps the
  pieces below it as references, which is what lets a module fix still land in them; forking follows
  every reference down.
*/
describe('opening a placed part', () => {
  const nested: ModuleDefinition = {
    manifest: { id: 'deep', name: 'Deep' },
    contributes: {
      parts: {
        leaf: { type: 'we-badge', children: ['leaf'] },
        branch: { type: 'Column', children: [{ type: '$part', props: { id: 'deep.leaf' } }] },
      },
    },
  };

  function withNested<T>(run: () => T): T {
    moduleRegistry.register(nested, host);
    try {
      return run();
    } finally {
      moduleRegistry.unregister('deep');
    }
  }

  it('opens one level and leaves the pieces below it as references', () => {
    withNested(() => {
      const opened = openPart({ type: '$part', props: { id: 'deep.branch' } }, 'one')!;
      expect(opened.type).toBe('Column');
      expect((opened.children as SchemaNode[])[0]).toEqual({ type: '$part', props: { id: 'deep.leaf' } });
    });
  });

  it('follows every reference down for a fork, and draws no frames into the template', () => {
    withNested(() => {
      const forked = openPart({ type: '$part', props: { id: 'deep.branch' } }, 'all')!;
      expect(JSON.stringify(forked)).not.toContain('$part');
      expect(JSON.stringify(forked)).not.toContain('PartFrame');
      expect((forked.children as SchemaNode[])[0]).toMatchObject({ type: 'we-badge', children: ['leaf'] });
      // Each level copied says which part it was and which placement it replaced, so it can be given back.
      expect((forked.children as SchemaNode[])[0]).toMatchObject({
        forkedFrom: 'part:deep.leaf',
        forkedPart: { placement: { id: 'deep.leaf' } },
      });
    });
  });

  it('answers nothing for a part nobody publishes', () => {
    expect(openPart({ type: '$part', props: { id: 'nobody.thing' } }, 'one')).toBeNull();
  });

  /*
    The editor hands over the template's own node, which lives in a Solid store, so its props are a
    proxy — and `structuredClone` refuses a proxy. Selecting a placed part crashed the app the moment
    the card asked what opening it would give.
  */
  it('opens a placement held in a store, whose props are a proxy', () => {
    withNested(() => {
      const props = new Proxy({ id: 'deep.branch', inputs: { row: { $: 'local.row' } } }, {});
      const opened = openPart({ type: '$part', props } as SchemaNode, 'one')!;
      expect(opened.forkedPart?.placement).toEqual({ id: 'deep.branch', inputs: { row: { $: 'local.row' } } });
    });
  });

  it('never hands back the registry’s own node', () => {
    withNested(() => {
      const opened = openPart({ type: '$part', props: { id: 'deep.leaf' } }, 'one')!;
      opened.children = ['changed'];
      expect((moduleRegistry.parts()['deep.leaf'].node as SchemaNode).children).toEqual(['leaf']);
    });
  });
});

/*
  Reaching inside a part. The editor can only select a node the page stamps with an id, and a
  module's nodes carry none — so a placement's part is drawn with ids worked out from the placement,
  and opened with the same ones. That agreement is what lets "make it your own" find, in the copy,
  the node somebody pressed on the page.
*/
describe('reaching inside a placed part', () => {
  const tree: ModuleDefinition = {
    manifest: { id: 'tree', name: 'Tree' },
    contributes: {
      parts: {
        leaf: { type: 'Row', children: [{ type: 'we-avatar' }, { type: 'we-text', children: ['name'] }] },
        branch: { type: 'Column', children: [{ type: '$part', props: { id: 'tree.leaf' } }] },
        trunk: {
          type: 'Column',
          children: [
            { type: '$part', props: { id: 'tree.branch' } },
            { type: '$part', props: { id: 'tree.leaf' } },
          ],
        },
      },
    },
  };

  function withTree<T>(run: () => T): T {
    moduleRegistry.register(tree, host);
    try {
      return run();
    } finally {
      moduleRegistry.unregister('tree');
    }
  }

  const placement: SchemaNode = { id: 'p1aaaaaaaa', type: '$part', props: { id: 'tree.trunk' } };

  /** Every node of a type in a resolved tree, frames and all. */
  const all = (root: SchemaNode, type: string) => {
    const found: SchemaNode[] = [];
    forEachNode(root, (node) => {
      if (node.type === type) found.push(node);
    });
    return found;
  };

  it('draws a placed part with ids, the same every time, and different per placement', () => {
    withTree(() => {
      const drawn = resolveParts({ type: 'Column', children: [placement] }) as SchemaNode;
      const again = resolveParts({ type: 'Column', children: [placement] }) as SchemaNode;
      const avatars = all(drawn, 'we-avatar');
      expect(avatars).toHaveLength(2);
      expect(avatars.every((node) => !!node.id)).toBe(true);
      // The leaf placed twice — once in the branch, once beside it — is two placements, two ids.
      expect(avatars[0].id).not.toBe(avatars[1].id);
      expect(all(again, 'we-avatar').map((node) => node.id)).toEqual(avatars.map((node) => node.id));

      const other = resolveParts({ type: 'Column', children: [{ ...placement, id: 'p2aaaaaaaa' }] }) as SchemaNode;
      expect(all(other, 'we-avatar')[0].id).not.toBe(avatars[0].id);
    });
  });

  it('draws a part with no placement id as it always was — nothing to seed from', () => {
    withTree(() => {
      const drawn = resolveParts({
        type: 'Column',
        children: [{ type: '$part', props: { id: 'tree.leaf' } }],
      }) as SchemaNode;
      expect(all(drawn, 'we-avatar')[0].id).toBeUndefined();
    });
  });

  it('opens only the parts on the path to a node, and finds it by the id it was drawn with', () => {
    withTree(() => {
      const drawn = resolveParts({ type: 'Column', children: [placement] }) as SchemaNode;
      const frames = all(drawn, 'PartFrame');
      // trunk, then the branch inside it, then the leaf inside that: the chain the page shows.
      const branchAt = frames.find((frame) => (frame.props as { part: string }).part === 'tree.branch')!;
      const leafInBranch = all(branchAt, 'PartFrame').find((frame) => frame !== branchAt)!;
      const avatar = all(leafInBranch, 'we-avatar')[0];
      const chain = [placement.id!, (branchAt.props as { at: string }).at, (leafInBranch.props as { at: string }).at];

      const path = openPartPath(placement, chain, avatar.id!)!;
      expect(path.parts).toEqual(['tree.trunk', 'tree.branch', 'tree.leaf']);
      expect(path.target.type).toBe('we-avatar');
      expect(findNodeById(path.node, avatar.id!)?.node).toBe(path.target);
      // The leaf beside the branch was not on the path, so it is still the module's.
      const kept = (path.node.children as SchemaNode[])[1];
      expect(kept).toMatchObject({ type: '$part', props: { id: 'tree.leaf' } });
      expect(JSON.stringify(path.node)).not.toContain('PartFrame');
      expect(path.node.forkedFrom).toBe('part:tree.trunk');
    });
  });

  it('leaves a part that was itself pressed as a part', () => {
    withTree(() => {
      const drawn = resolveParts({ type: 'Column', children: [placement] }) as SchemaNode;
      const branchAt = all(drawn, 'PartFrame').find(
        (frame) => (frame.props as { part: string }).part === 'tree.branch',
      )!;
      const at = (branchAt.props as { at: string }).at;

      const path = openPartPath(placement, [placement.id!, at], at)!;
      expect(path.parts).toEqual(['tree.trunk']);
      expect(path.target).toMatchObject({ id: at, type: '$part', props: { id: 'tree.branch' } });
    });
  });

  it('answers nothing when the path no longer matches the part', () => {
    withTree(() => {
      expect(openPartPath(placement, ['someoneelse'], 'x')).toBeNull();
      expect(openPartPath(placement, [placement.id!, 'gone000000'], 'x')).toBeNull();
    });
  });
});
