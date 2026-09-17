/**
 * The slot and module registries.
 *
 * The load-bearing assertion is the first one: generalising `shellRegistry` into an open collection
 * must leave the existing three shell entries rendering in exactly the same order. Everything else
 * builds on that generalisation, so if it is not faithful, nothing downstream is trustworthy.
 *
 * The second half is the module contract as the registry enforces it: what a definition may say,
 * what the registry builds for it (panel plumbing, the deps a store is handed), and what a template
 * can then reach.
 */
import type { ModuleDefinition, ModuleStoreDeps } from '@we/module-shared';
import { markAction, markState } from '@we/module-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dockRegistry } from '../src/shared/registries/dockRegistry';
import { createModuleStoreDeps } from '../src/shared/registries/moduleHostServices';
import { resolveParts } from '../src/shared/registries/moduleParts';
import {
  isCommunityDecided,
  moduleRegistry,
  moduleStores,
  moduleSurface,
} from '../src/shared/registries/moduleRegistry';
import { registerCoreSlots, slotRegistry } from '../src/shared/registries/slotRegistry';

const host = { backend: 'ad4m', framework: 'solid' };

/**
 * Stand-in reactivity. A module store is built from injected primitives rather than an imported
 * framework, so a plain closure satisfies the port here — which is itself the point: nothing in a
 * module store requires Solid to exist.
 */
const framework = {
  signal: <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => void (value = next)];
  },
  effect: (fn: () => void) => fn(),
};
const storeDeps: ModuleStoreDeps = createModuleStoreDeps(framework);

function reset() {
  // `all()`, not `ordered()`: the latter is core anchors only, so contributions to module-declared
  // anchors would survive between tests.
  for (const entry of slotRegistry.all()) slotRegistry.remove(entry.id);
  for (const { definition } of moduleRegistry.all()) moduleRegistry.unregister(definition.manifest.id);
  registerCoreSlots();
}

function mod(id: string, overrides: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return { manifest: { id, name: id }, ...overrides };
}

beforeEach(reset);

describe('slotRegistry — faithful generalisation of shellRegistry', () => {
  it('renders the original three host slots in the order the old hardcoded array produced', () => {
    const ORIGINAL = ['core:bootScreen', 'core:sidebar', 'core:templateEditor'];
    expect(
      slotRegistry
        .ordered()
        .map((e) => e.id)
        .filter((id) => ORIGINAL.includes(id)),
    ).toEqual(ORIGINAL);
  });

  it('keeps host chrome first when a module contributes to a later anchor', () => {
    slotRegistry.register({ id: 'call', anchor: 'dock-bottom', node: { type: 'Column' } });
    expect(slotRegistry.ordered().map((e) => e.id)).toEqual([
      'core:bootScreen',
      'core:consentPrompt',
      'core:consentSecret',
      'core:removeAccount',
      'core:createSpace',
      'core:namePrompt',
      'core:installPrompt',
      'core:destructivePrompt',
      'core:sidebar',
      'core:templateEditor',
      'core:chromeRail',
      'dock:editor:inspector',
      'dock:editor:code',
      'dock:editor:ai',
      'dock:editor:theme',
      'dock:shell:space-settings',
      'call',
    ]);
  });

  it('lets a seed white-label host chrome without disturbing its position', () => {
    slotRegistry.replace('core:bootScreen', { type: 'we-text', children: ['custom'] });
    const entries = slotRegistry.ordered();
    expect(entries[0].id).toBe('core:bootScreen');
    expect(entries[0].node).toEqual({ type: 'we-text', children: ['custom'] });
  });

  it('orders by declared order within an anchor, and breaks ties on id', () => {
    slotRegistry.register({ id: 'b', anchor: 'dock-bottom', node: { type: 'Column' }, order: 200 });
    slotRegistry.register({ id: 'a', anchor: 'dock-bottom', node: { type: 'Column' }, order: 100 });
    slotRegistry.register({ id: 'zebra', anchor: 'banner', node: { type: 'Column' } });
    slotRegistry.register({ id: 'apple', anchor: 'banner', node: { type: 'Column' } });
    expect(
      slotRegistry
        .ordered()
        .filter((e) => e.anchor === 'dock-bottom')
        .map((e) => e.id),
    ).toEqual(['a', 'b']);
    expect(
      slotRegistry
        .ordered()
        .filter((e) => e.anchor === 'banner')
        .map((e) => e.id),
    ).toEqual(['apple', 'zebra']);
  });
});

describe('moduleRegistry — registration', () => {
  it('fans contributions out to the registries that already exist', () => {
    moduleRegistry.register(
      mod('notes', {
        contributes: { slots: [{ anchor: 'dock-right', node: { type: 'Column' } }] },
        createStore: () => ({ open: true }),
      }),
      host,
      storeDeps,
    );

    expect(moduleStores.notes).toEqual({ open: true });
    expect(slotRegistry.get('notes:0')?.anchor).toBe('dock-right');
  });

  it('leaves the module key absent until it registers, so $if on modules.<id> works', () => {
    expect(moduleStores.notes).toBeUndefined();
    moduleRegistry.register(mod('notes', { createStore: () => ({}) }), host, storeDeps);
    expect(moduleStores.notes).toBeDefined();
    moduleRegistry.unregister('notes');
    expect(moduleStores.notes).toBeUndefined();
  });

  it('removes every contribution on unregister, panels included', () => {
    moduleRegistry.register(
      mod('multi', {
        contributes: {
          slots: [
            { anchor: 'dock-bottom', node: { type: 'Column' } },
            { anchor: 'banner', node: { type: 'Row' } },
          ],
          panels: [
            { name: 'first', title: 'First', node: { type: 'Column' } },
            { name: 'second', title: 'Second', node: { type: 'Column' } },
          ],
        },
      }),
      host,
    );
    expect(slotRegistry.all().filter((e) => e.id.includes('multi')).length).toBe(4);
    expect(dockRegistry.get('multi:second')).toBeDefined();

    moduleRegistry.unregister('multi');
    // Named panels used to leak here: register keyed them by name and unregister by index.
    expect(slotRegistry.all().filter((e) => e.id.includes('multi'))).toHaveLength(0);
    expect(dockRegistry.get('multi:second')).toBeUndefined();
  });

  it('replaces rather than duplicates when the same id registers twice', () => {
    const definition = mod('dupe', {
      contributes: {
        slots: [{ anchor: 'banner', node: { type: 'Column' } }],
        panels: [{ name: 'p', title: 'P', node: { type: 'Column' } }],
      },
    });
    moduleRegistry.register(definition, host);
    moduleRegistry.register(definition, host);

    expect(moduleRegistry.all()).toHaveLength(1);
    expect(slotRegistry.all().filter((e) => e.id.includes('dupe'))).toHaveLength(2);
    expect(dockRegistry.ordered().filter((e) => e.moduleId === 'dupe')).toHaveLength(1);
  });

  it('refuses an incompatible module loudly instead of half-mounting it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = moduleRegistry.register(
      mod('ng-only', {
        manifest: { id: 'ng-only', name: 'NG', requires: { backends: ['nextgraph'] } },
        contributes: { slots: [{ anchor: 'banner', node: { type: 'Column' } }] },
      }),
      host,
    );

    expect(result.registered).toBe(false);
    expect(result.problems[0]).toContain('nextgraph');
    expect(moduleRegistry.has('ng-only')).toBe(false);
    expect(slotRegistry.all().some((e) => e.id.startsWith('ng-only'))).toBe(false);
    warn.mockRestore();
  });

  it('refuses a module naming a kernel the host does not implement', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = moduleRegistry.register(
      mod('needy', { manifest: { id: 'needy', name: 'Needy', requires: { kernels: ['languageModel'] } } }),
      { ...host, kernels: ['records'] },
    );
    expect(result.registered).toBe(false);
    expect(result.problems[0]).toContain('languageModel');
    warn.mockRestore();
  });

  it('refuses a panel with no name, and two panels with one name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      moduleRegistry.register(
        mod('anon', { contributes: { panels: [{ name: '', title: 'x', node: { type: 'Column' } }] } }),
        host,
      ).registered,
    ).toBe(false);
    expect(
      moduleRegistry.register(
        mod('twins', {
          contributes: {
            panels: [
              { name: 'a', title: 'x', node: { type: 'Column' } },
              { name: 'a', title: 'y', node: { type: 'Column' } },
            ],
          },
        }),
        host,
      ).problems[0],
    ).toContain('"a"');
    warn.mockRestore();
  });

  it('refuses framework components declared without a framework', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = moduleRegistry.register(mod('comp', { contributes: { components: { Thing: () => null } } }), host);
    expect(result.registered).toBe(false);
    expect(result.problems[0]).toContain('requires.frameworks');
    warn.mockRestore();
  });

  it('registers a declaration-only module with no store, no components and no kernels', () => {
    const result = moduleRegistry.register(
      mod('banner', {
        contributes: {
          slots: [{ anchor: 'banner', node: { type: 'Column' } }],
          panels: [{ name: 'main', title: 'Banner', node: { type: 'Column' } }],
        },
      }),
      { ...host, kernels: [] },
    );
    expect(result.registered).toBe(true);
    expect(moduleStores.banner).toBeUndefined();
    expect(moduleRegistry.components()).toEqual({});
    // And its panel still works — the host holds the flag.
    expect(moduleRegistry.panel('banner:main')?.hostOwned).toBe(true);
  });

  it('surfaces embedded applications through the same registry as every other module', () => {
    moduleRegistry.register(
      {
        manifest: { id: 'flux', name: 'Flux', icon: 'chat-circle' },
        contributes: { embed: { url: 'http://localhost:8080', allow: "camera 'src'", image: '/flux.png' } },
      },
      host,
    );
    moduleRegistry.register(mod('notes'), host);

    expect(moduleRegistry.embeds()).toEqual([
      {
        id: 'flux',
        name: 'Flux',
        icon: 'chat-circle',
        image: '/flux.png',
        url: 'http://localhost:8080',
        allow: "camera 'src'",
      },
    ]);
  });
});

describe('moduleRegistry — parts', () => {
  it('namespaces parts so two modules cannot collide, and normalises the shape', () => {
    moduleRegistry.register(mod('a', { contributes: { parts: { panel: { type: 'Column' } } } }), host);
    moduleRegistry.register(mod('b', { contributes: { parts: { panel: { type: 'Row' } } } }), host);

    expect(moduleRegistry.parts()).toEqual({
      'a.panel': { node: { type: 'Column' } },
      'b.panel': { node: { type: 'Row' } },
    });
  });

  it('keeps the subject a part names, which is what lets a placer repoint it', () => {
    moduleRegistry.register(
      mod('a', { contributes: { parts: { feed: { node: { type: 'Column' }, subject: 'modules.a.collectionId' } } } }),
      host,
    );
    expect(moduleRegistry.parts()['a.feed']).toEqual({ node: { type: 'Column' }, subject: 'modules.a.collectionId' });
  });
});

describe('module-declared anchors', () => {
  const provider: ModuleDefinition = {
    manifest: { id: 'call', name: 'Calls' },
    contributes: {
      anchors: ['call-controls'],
      slots: [
        {
          anchor: 'dock-bottom',
          node: {
            type: 'Row',
            children: [{ type: 'we-button' }, { type: '$slot', props: { anchor: 'call-controls' } }],
          },
        },
      ],
    },
  };
  const contributor: ModuleDefinition = {
    manifest: { id: 'transcribe', name: 'Transcription' },
    contributes: { slots: [{ anchor: 'call-controls', node: { type: 'we-icon', props: { name: 'record' } } }] },
  };

  function barChildren(): { type?: string }[] {
    const gated = slotRegistry
      .nodes()
      .find((n) => n.type === '$if' && (n.props as { then?: { type?: string } } | undefined)?.then?.type === 'Row');
    const row = (gated?.props as { then?: { children?: unknown[] } } | undefined)?.then;
    return (row?.children ?? []) as { type?: string }[];
  }

  it('splices a contribution into the marker, wherever the provider put it', () => {
    moduleRegistry.register(provider, host, storeDeps);
    moduleRegistry.register(contributor, host, storeDeps);
    const children = barChildren();
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe('we-button');
    expect(children[1].type).toBe('$if');
  });

  it('resolves the marker away when nothing is contributed', () => {
    moduleRegistry.register(provider, host, storeDeps);
    expect(barChildren().map((c) => c.type)).toEqual(['we-button']);
  });

  it('reports a contribution to an anchor no module provides', () => {
    moduleRegistry.register(contributor, host, storeDeps);
    expect(moduleRegistry.danglingAnchors()).toEqual(['call-controls']);
    moduleRegistry.register(provider, host, storeDeps);
    expect(moduleRegistry.danglingAnchors()).toEqual([]);
  });
});

describe('module teardown', () => {
  const teardownMod = (id: string, onCreate: (deps: ModuleStoreDeps) => void) =>
    mod(id, {
      createStore: (deps) => {
        onCreate(deps);
        return {};
      },
    });

  it('runs a store’s disposers when the module is unregistered, in reverse', () => {
    const closed: string[] = [];
    moduleRegistry.register(
      teardownMod('tear-a', (deps) => {
        deps.onDispose?.(() => closed.push('stream'));
        deps.onDispose?.(() => closed.push('peers'));
      }),
      host,
      storeDeps,
    );
    expect(closed).toEqual([]);
    moduleRegistry.unregister('tear-a');
    expect(closed).toEqual(['peers', 'stream']);
  });

  it('runs them on re-registration, which is what a hot reload does', () => {
    const closed: string[] = [];
    const definition = teardownMod('tear-b', (deps) => deps.onDispose?.(() => closed.push('closed')));
    moduleRegistry.register(definition, host, storeDeps);
    moduleRegistry.register(definition, host, storeDeps);
    expect(closed).toEqual(['closed']);
  });

  it('keeps going when one disposer throws', () => {
    const closed: string[] = [];
    moduleRegistry.register(
      teardownMod('tear-throw', (deps) => {
        deps.onDispose?.(() => closed.push('first'));
        deps.onDispose?.(() => {
          throw new Error('nope');
        });
        deps.onDispose?.(() => closed.push('last'));
      }),
      host,
      storeDeps,
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => moduleRegistry.unregister('tear-throw')).not.toThrow();
    expect(closed).toEqual(['last', 'first']);
    error.mockRestore();
  });
});

describe('a module that is holding something live', () => {
  function gateOf(slotId: string): Record<string, unknown> {
    const entry = slotRegistry.all().find((e) => e.id === slotId);
    const props = (entry?.node as { props?: Record<string, unknown> } | undefined)?.props;
    return (props?.condition ?? {}) as Record<string, unknown>;
  }
  const chrome = { anchor: 'dock-bottom' as const, node: { type: 'Row' } };

  it('is gated on the space alone when it holds nothing', () => {
    moduleRegistry.register(mod('plain', { contributes: { slots: [chrome] } }), host);
    expect(gateOf('plain:0')).toEqual({ $: "'plain' in spaceStore.activeModules" });
  });

  it('also renders wherever its own key says it is holding something', () => {
    // A bare key now: the registry builds the `modules.<id>.<key>` path rather than the module.
    moduleRegistry.register(mod('held', { contributes: { slots: [chrome], holds: 'active' } }), host);
    expect(gateOf('held:0')).toEqual({ $: "'held' in spaceStore.activeModules || modules.held.active" });
  });

  it('gates a panel the same way as a slot', () => {
    moduleRegistry.register(
      mod('docked', { contributes: { panels: [{ name: 'p', title: 'P', node: { type: 'Row' } }], holds: 'active' } }),
      host,
    );
    expect(gateOf('dock:docked:p').$).toContain('|| modules.docked.active');
  });
});

describe('panels — the host’s half', () => {
  it('holds the open flag itself unless the module claims it', () => {
    moduleRegistry.register(
      mod('notes', { contributes: { panels: [{ name: 'main', title: 'Notes', node: { type: 'Column' } }] } }),
      host,
      storeDeps,
    );
    const controls = moduleRegistry.panel('notes:main')!;
    const entry = dockRegistry.get('notes:main')!;
    const read = (key?: string) => (entry.store![key!] as () => unknown)();

    expect(controls.hostOwned).toBe(true);
    // Closed: `null` for the edge, which is the one answer the shell reads for both "where" and "whether".
    expect(read(entry.edge)).toBeNull();
    controls.open();
    expect(read(entry.edge)).toBe('right');
    expect(read(entry.size)).toBe('md');
    controls.toggle();
    expect(read(entry.edge)).toBeNull();
    // The titlebar's close goes through the host's action, since the module has no such member.
    expect(JSON.stringify(entry.closeAction)).toContain('shellStore.closeModulePanel');
  });

  it('honours a static bid', () => {
    moduleRegistry.register(
      mod('t', {
        contributes: {
          panels: [
            {
              name: 'p',
              title: 'P',
              node: { type: 'Column' },
              bid: { edge: 'left', size: 'lg', float: true, min: { width: 200 }, aspect: { ratio: 16 / 9 } },
            },
          ],
        },
      }),
      host,
      storeDeps,
    );
    const entry = dockRegistry.get('t:p')!;
    moduleRegistry.panel('t:p')!.open();
    const read = (key?: string) => (entry.store![key!] as () => unknown)();
    expect(read(entry.edge)).toBe('left');
    expect(read(entry.size)).toBe('lg');
    expect(read(entry.float)).toBe(true);
    expect(read(entry.min)).toEqual({ width: 200 });
    // Declared, so the titlebar offers "fit to content".
    expect(entry.aspect).toBe('aspect');
    expect(read(entry.aspect)).toEqual({ ratio: 16 / 9 });
  });

  it('reads a bid off the store when the module names a key, and openness when it claims it', () => {
    moduleRegistry.register(
      mod('call', {
        contributes: {
          panels: [
            {
              name: 'stage',
              title: 'Call',
              node: { type: 'Column' },
              bid: 'stageBid',
              open: 'stageOpen',
              show: 'openStage',
              close: 'closeStage',
            },
          ],
        },
        createStore: ({ signal }) => {
          const [open, setOpen] = signal(false);
          const [size, setSize] = signal<'md' | 'full'>('md');
          return {
            stageOpen: open,
            openStage: () => setOpen(true),
            closeStage: () => setOpen(false),
            stageBid: () => ({ edge: 'bottom', size: size() }),
            share: () => setSize('full'),
          };
        },
      }),
      host,
      storeDeps,
    );
    const controls = moduleRegistry.panel('call:stage')!;
    const entry = dockRegistry.get('call:stage')!;
    const read = (key?: string) => (entry.store![key!] as () => unknown)();
    const store = moduleStores.call as Record<string, () => void>;

    expect(controls.hostOwned).toBe(false);
    expect(read(entry.edge)).toBeNull();
    controls.open();
    expect(store.stageOpen()).toBe(true);
    expect(read(entry.edge)).toBe('bottom');
    store.share();
    // A key bid is live: the stage asking for 'full' is a state, not a starting size.
    expect(read(entry.size)).toBe('full');
    controls.close();
    expect(read(entry.edge)).toBeNull();
    // The module's own close is what the titlebar calls.
    expect(entry.close).toBe('closeStage');
    expect(entry.closeAction).toBeUndefined();
  });

  it('gates each panel’s supplied body on its own dock id, not on the module’s', () => {
    moduleRegistry.register(
      mod('twin', {
        contributes: {
          panels: [
            { name: 'transcript', title: 'T', node: { type: 'we-text', children: ['first'] } },
            { name: 'extraction', title: 'E', node: { type: 'we-text', children: ['second'] } },
          ],
        },
      }),
      host,
    );
    const frames = slotRegistry.all().filter((entry) => entry.id.startsWith('dock:twin'));
    const json = frames.map((entry) => JSON.stringify(entry.node));
    expect(frames.map((f) => f.id)).toEqual(['dock:twin:transcript', 'dock:twin:extraction']);
    expect(json[0]).toContain("shellStore.panelSupplied['twin:transcript']");
    expect(json[1]).toContain('"dock":"extraction"');
    for (const entry of json) expect(entry).not.toContain("panelSupplied['twin']");
    // The module's own contents remain on the other side of the gate.
    expect(json[0]).toContain('first');
    expect(json[0]).toContain('TemplatePanelBody');
  });

  it('composes its own chrome out of its own parts, expanded before it renders', () => {
    moduleRegistry.register(
      mod('twin', {
        contributes: {
          parts: { row: { type: 'we-text', children: ['from the part'] } },
          panels: [
            {
              name: 'p',
              title: 'P',
              node: { type: 'Column', children: [{ type: '$part', props: { id: 'twin.row' } }] },
            },
          ],
        },
      }),
      host,
    );
    const rendered = JSON.stringify(
      slotRegistry.nodes().map((node) => {
        const expanded = resolveParts(node);
        return Array.isArray(expanded) ? expanded : [expanded];
      }),
    );
    expect(rendered).toContain('from the part');
    expect(rendered).not.toContain('$part');
  });
});

describe('what a store is handed, and what it publishes', () => {
  it('hands a module only the kernels its manifest named', () => {
    let seen: ModuleStoreDeps | undefined;
    moduleRegistry.register(
      mod('k', {
        manifest: { id: 'k', name: 'K', requires: { kernels: ['records', 'presence'] } },
        createStore: (deps) => {
          seen = deps;
          return {};
        },
      }),
      host,
      storeDeps,
    );
    expect(Object.keys(seen!.kernels).sort()).toEqual(['presence', 'records']);
    expect(seen!.kernels.languageModel).toBeUndefined();
    // And the markers, so a store can say what is public.
    expect(typeof seen!.state).toBe('function');
    expect(typeof seen!.action).toBe('function');
  });

  it('keeps unmarked members private and reports the marked ones', () => {
    moduleRegistry.register(
      mod('s', {
        createStore: ({ state, action, signal }) => {
          const [count] = signal(3);
          return {
            count: state(count, 'How many.'),
            bump: action(() => undefined, 'One more.'),
            plumbing: () => 'right',
          };
        },
      }),
      host,
      storeDeps,
    );
    expect(moduleRegistry.storeSurface('s')).toEqual({
      count: { kind: 'state', doc: 'How many.' },
      bump: { kind: 'action', doc: 'One more.' },
    });
    // The store itself keeps everything: the module's own chrome sees all of it.
    expect(Object.keys(moduleStores.s as object).sort()).toEqual(['bump', 'count', 'plumbing']);
  });

  it('keeps secret settings out of deps.settings and reaches them through the kernel', () => {
    let seen: ModuleStoreDeps | undefined;
    moduleRegistry.provideSettings(() => ({ token: 'shh', verbose: true }));
    moduleRegistry.register(
      mod('sec', {
        manifest: { id: 'sec', name: 'Sec', requires: { kernels: ['secrets'] } },
        contributes: {
          settings: [
            { key: 'token', label: 'Token', type: 'secret', default: '', levels: ['agent'] },
            { key: 'verbose', label: 'Verbose', type: 'boolean', default: false, levels: ['agent'] },
          ],
        },
        createStore: (deps) => {
          seen = deps;
          return {};
        },
      }),
      host,
      storeDeps,
    );
    expect(seen!.settings?.()).toEqual({ verbose: true });
    expect(seen!.kernels.secrets?.get('token')).toBe('shh');
    expect(seen!.kernels.secrets?.get('verbose')).toBeUndefined();
    moduleRegistry.provideSettings(() => ({}));
  });

  it('derives capabilities from the manifest and contributions', () => {
    moduleRegistry.register(
      mod('caps', {
        manifest: { id: 'caps', name: 'Caps', requires: { kernels: ['media'], permissions: ['microphone'] } },
        contributes: { panels: [{ name: 'p', title: 'P', node: { type: 'Column' } }] },
      }),
      host,
    );
    expect(moduleRegistry.capabilitiesOf('caps')).toEqual(
      expect.arrayContaining(['microphone', 'kernel:media', 'dock']),
    );
  });

  it('warns, in development, about an activity a module publishes but never declared', () => {
    const published: unknown[] = [];
    const deps: ModuleStoreDeps = {
      ...storeDeps,
      kernels: {
        ...storeDeps.kernels,
        presence: { peers: () => [], setActivity: (a) => void published.push(a), clearActivity: () => {} },
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    moduleRegistry.register(
      mod('act', {
        manifest: { id: 'act', name: 'Act', requires: { kernels: ['presence'] } },
        contributes: { activities: { drawing: { board: 'string' } } },
        createStore: ({ kernels }) => ({
          go: () => {
            kernels.presence?.setActivity({ type: 'drawing', board: 'b1' } as never);
            kernels.presence?.setActivity({ type: 'drawing', board: 7 } as never);
            kernels.presence?.setActivity({ type: 'singing' } as never);
          },
        }),
      }),
      host,
      deps,
    );
    (moduleStores.act as { go: () => void }).go();
    // Every publish still goes through — a shape check is a warning, never a refusal.
    expect(published).toHaveLength(3);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('board') && m.includes('declared as string'))).toBe(true);
    expect(messages.some((m) => m.includes('"singing"'))).toBe(true);
    warn.mockRestore();
  });
});

describe('what a template needs', () => {
  it('derives required modules from declared requirements and mounted components', () => {
    moduleRegistry.register(
      mod('globe', {
        manifest: { id: 'globe', name: 'Globe', requires: { frameworks: ['solid'] } },
        contributes: { components: { CesiumGlobe: () => null } },
      }),
      host,
    );
    moduleRegistry.register(mod('call'), host);
    const schema = {
      type: 'Column',
      meta: { name: 'x', description: '', icon: '', requires: { modules: ['call'] } },
      children: [{ type: 'CesiumGlobe' }],
    } as never;
    expect(moduleRegistry.requiredBy(schema).sort()).toEqual(['call', 'globe']);
  });

  it('catalogues contributed views', () => {
    moduleRegistry.register(
      mod('polls', {
        contributes: {
          views: [
            { id: 'polls', type: 'Column', meta: { name: 'Polls', description: '', icon: 'chart-bar', role: 'view' } },
          ] as never,
        },
      }),
      host,
    );
    expect(Object.keys(moduleRegistry.views())).toEqual(['polls']);
    // And whose each one is, so a space with the module off can leave its section out.
    expect(moduleRegistry.viewOwners()).toEqual({ polls: 'polls' });
  });

  it('refuses a module whose view has no id or the wrong role, with a sentence', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = moduleRegistry.register(
      mod('polls', {
        contributes: {
          views: [
            { id: 'polls', type: 'Column', meta: { name: 'Polls', description: '', icon: 'chart-bar', role: 'view' } },
            { type: 'Column', meta: { name: 'Nameless', description: '', icon: '', role: 'view' } },
            { id: 'shell', type: 'Column', meta: { name: 'Shell', description: '', icon: '' } },
          ] as never,
        },
      }),
      host,
    );
    expect(result.registered).toBe(false);
    expect(moduleRegistry.get('polls')).toBeUndefined();
    const messages = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(messages).toContain('no id');
    expect(messages).toContain("meta.role: 'view'");
    warn.mockRestore();
  });
});

describe('which modules a community decides about', () => {
  const view = { id: 'polls', type: 'Column', meta: { name: 'Polls', description: '', icon: '', role: 'view' } };

  it('counts a section or a block as part of the space, not as a capability', () => {
    // Polls has no panel. Classed as a capability it sat outside every per-space switch, so a seed
    // shipping it `enabled: false` shipped a setting nothing could change.
    const polls = mod('polls', { contributes: { views: [view] as never } });
    expect(moduleSurface(polls)).toBe('content');
    expect(isCommunityDecided(polls)).toBe(true);

    const blockOnly = mod('embeds', { contributes: { blocks: [{ entity: 'Embed', card: 'card' }] } as never });
    expect(moduleSurface(blockOnly)).toBe('content');
  });

  it('keeps a panel as chrome, and a bare component as the template’s to decide', () => {
    expect(moduleSurface(mod('notes', { contributes: { panels: [{ name: 'main', node: {} }] } as never }))).toBe(
      'chrome',
    );
    const globe = mod('globe', { contributes: { components: { CesiumGlobe: () => null } } });
    expect(moduleSurface(globe)).toBe('capability');
    expect(isCommunityDecided(globe)).toBe(false);
  });

  it('leaves an agent-scoped module out, since no space’s decision reaches it', () => {
    const pocket = mod('pocket', {
      manifest: { id: 'pocket', name: 'Pocket', scope: 'agent' },
      contributes: { panels: [{ name: 'main', node: {} }] } as never,
    });
    expect(moduleSurface(pocket)).toBe('chrome');
    expect(isCommunityDecided(pocket)).toBe(false);
  });
});

describe('agent-scoped modules', () => {
  function recordingPort() {
    const compiled: string[] = [];
    const port = {
      declare: (manifest: { entities: Record<string, unknown> }) => {
        const names = Object.keys(manifest.entities);
        compiled.push(...names);
        return Object.fromEntries(names.map((name) => [name, { className: name }]));
      },
    };
    return { port, compiled };
  }
  const manifest = (name: string) =>
    ({ version: '1.0.0', entities: { [name]: { base: 'Ad4mModel', properties: {}, relations: {} } } }) as never;

  it('routes an agent-scoped manifest to the root dataset and nowhere else', () => {
    moduleRegistry.register(
      mod('pocket', { contributes: { entities: { manifest: manifest('PocketItem'), scope: 'agent' } } }),
      host,
    );
    const { port, compiled } = recordingPort();
    expect(moduleRegistry.moduleSchemas(port as never)).toEqual([]);
    expect(moduleRegistry.agentSchemas(port as never)).toEqual([{ className: 'PocketItem' }]);
    expect(compiled).toEqual(['PocketItem']);
  });

  it('leaves a module that says nothing about scope in the space', () => {
    moduleRegistry.register(mod('notes', { contributes: { entities: { manifest: manifest('Note') } } }), host);
    const { port } = recordingPort();
    expect(moduleRegistry.moduleSchemas(port as never)).toEqual([{ className: 'Note' }]);
    expect(moduleRegistry.agentSchemas(port as never)).toEqual([]);
  });

  it('compiles each module once, however many datasets it is installed into', () => {
    moduleRegistry.register(
      mod('pocket', { contributes: { entities: { manifest: manifest('PocketItem'), scope: 'agent' } } }),
      host,
    );
    const { port, compiled } = recordingPort();
    moduleRegistry.agentSchemas(port as never);
    moduleRegistry.agentSchemas(port as never);
    expect(compiled).toEqual(['PocketItem']);
  });
});

describe('markers used outside a store', () => {
  it('are the same functions the deps carry, so a test can mark members directly', () => {
    const read = () => 1;
    expect(markState(read, 'x')).toBe(read);
    const act = () => undefined;
    expect(markAction(act, 'y')).toBe(act);
  });
});
