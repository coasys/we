/**
 * The slot and module registries.
 *
 * The load-bearing assertion is the first one: generalising `shellRegistry` into an open collection
 * must leave the existing three shell entries rendering in exactly the same order. Everything else in
 * this PR builds on that generalisation, so if it is not faithful, nothing downstream is trustworthy.
 */
import type { ModuleDefinition } from '@we/module-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveParts } from '../src/shared/registries/moduleParts';
import { moduleRegistry, moduleStores } from '../src/shared/registries/moduleRegistry';
import { registerCoreSlots, slotRegistry } from '../src/shared/registries/slotRegistry';

const host = { backend: 'ad4m', framework: 'solid' };

/**
 * Stand-in reactivity. A module store is built from injected primitives rather than an imported
 * framework, so a plain closure satisfies the port here — which is itself the point: nothing in a
 * module store requires Solid to exist.
 */
const storeDeps = {
  signal: <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => (value = next)];
  },
};

function reset() {
  // `all()`, not `ordered()`: the latter is core anchors only, so contributions to module-declared
  // anchors would survive between tests.
  for (const entry of slotRegistry.all()) slotRegistry.remove(entry.id);
  for (const { definition } of moduleRegistry.all()) moduleRegistry.unregister(definition.id);
  registerCoreSlots();
}

function mod(overrides: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return { id: 'test', name: 'Test', ...overrides };
}

beforeEach(reset);

describe('slotRegistry — faithful generalisation of shellRegistry', () => {
  it('renders the original three host slots in the order the old hardcoded array produced', () => {
    // Was: [shellRegistry.bootScreen, shellRegistry.sidebar, shellRegistry.templateEditor]
    //
    // The property this test protects is the *relative* order of those three, not their position.
    // It used to assert a prefix, which conflated the two and broke the moment host chrome was
    // added ahead of `core:sidebar` (the consent overlays). Filtering to the three keeps the real
    // invariant and stops the test objecting to new chrome it has no opinion about.
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
      // The editor's four panels, which are docks at this anchor like any module's — registered by
      // the host rather than contributed, since the editor is chrome rather than a module.
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

  it('ignores a replace for an id that was never registered', () => {
    slotRegistry.replace('nope', { type: 'Column' });
    expect(slotRegistry.get('nope')).toBeUndefined();
  });

  it('orders by declared order within an anchor', () => {
    slotRegistry.register({ id: 'b', anchor: 'dock-bottom', node: { type: 'Column' }, order: 200 });
    slotRegistry.register({ id: 'a', anchor: 'dock-bottom', node: { type: 'Column' }, order: 100 });
    const bottom = slotRegistry.ordered().filter((e) => e.anchor === 'dock-bottom');
    expect(bottom.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('breaks ties on id, so load order cannot leak into layout', () => {
    // Entries come out of a Map; without the tiebreak, equal-order chrome would rearrange depending
    // on which module happened to register first.
    slotRegistry.register({ id: 'zebra', anchor: 'banner', node: { type: 'Column' } });
    slotRegistry.register({ id: 'apple', anchor: 'banner', node: { type: 'Column' } });
    const banner = slotRegistry.ordered().filter((e) => e.anchor === 'banner');
    expect(banner.map((e) => e.id)).toEqual(['apple', 'zebra']);
  });

  it('is idempotent on re-registration', () => {
    slotRegistry.register({ id: 'x', anchor: 'banner', node: { type: 'Column' } });
    slotRegistry.register({ id: 'x', anchor: 'banner', node: { type: 'Row' } });
    expect(slotRegistry.ordered().filter((e) => e.id === 'x')).toHaveLength(1);
    expect(slotRegistry.get('x')?.node).toEqual({ type: 'Row' });
  });
});

describe('moduleRegistry', () => {
  it('fans contributions out to the registries that already exist', () => {
    moduleRegistry.register(
      mod({
        id: 'notes',
        slots: [{ anchor: 'dock-right', node: { type: 'Column' } }],
        createStore: () => ({ open: true }),
      }),
      host,
      storeDeps,
    );

    expect(moduleStores.notes).toEqual({ open: true });
    expect(slotRegistry.get('notes:0')?.anchor).toBe('dock-right');
  });

  it('leaves the module key absent until it registers, so $if on modules.<id> works', () => {
    // The whole point of the namespace convention: a template can depend on an optional module
    // because the key is missing, not present-but-inert.
    expect(moduleStores.notes).toBeUndefined();
    moduleRegistry.register(mod({ id: 'notes', createStore: () => ({}) }), host, storeDeps);
    expect(moduleStores.notes).toBeDefined();
    moduleRegistry.unregister('notes');
    expect(moduleStores.notes).toBeUndefined();
  });

  it('removes every contribution on unregister', () => {
    moduleRegistry.register(
      mod({
        id: 'multi',
        slots: [
          { anchor: 'dock-bottom', node: { type: 'Column' } },
          { anchor: 'banner', node: { type: 'Row' } },
        ],
      }),
      host,
    );
    expect(slotRegistry.ordered().filter((e) => e.id.startsWith('multi:'))).toHaveLength(2);

    moduleRegistry.unregister('multi');
    expect(slotRegistry.ordered().filter((e) => e.id.startsWith('multi:'))).toHaveLength(0);
  });

  it('replaces rather than duplicates when the same id registers twice', () => {
    const definition = mod({ id: 'dupe', slots: [{ anchor: 'banner', node: { type: 'Column' } }] });
    moduleRegistry.register(definition, host);
    moduleRegistry.register(definition, host);

    expect(moduleRegistry.all()).toHaveLength(1);
    expect(slotRegistry.ordered().filter((e) => e.id.startsWith('dupe:'))).toHaveLength(1);
  });

  it('refuses an incompatible module loudly instead of half-mounting it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = moduleRegistry.register(
      mod({ id: 'ng-only', backends: ['nextgraph'], slots: [{ anchor: 'banner', node: { type: 'Column' } }] }),
      host,
    );

    expect(result.registered).toBe(false);
    expect(result.problems[0]).toContain('nextgraph');
    // Nothing partially applied — no store, no chrome.
    expect(moduleRegistry.has('ng-only')).toBe(false);
    expect(slotRegistry.ordered().some((e) => e.id.startsWith('ng-only'))).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('namespaces schema fragments so two modules cannot collide', () => {
    moduleRegistry.register(mod({ id: 'a', schemas: { panel: { type: 'Column' } } }), host);
    moduleRegistry.register(mod({ id: 'b', schemas: { panel: { type: 'Row' } } }), host);

    // Normalised on the way out: a part written as a bare node comes back as one with no subject,
    // so a placer has one shape to handle rather than two.
    expect(moduleRegistry.schemas()).toEqual({
      'a.panel': { node: { type: 'Column' } },
      'b.panel': { node: { type: 'Row' } },
    });
  });

  it('keeps the subject a part names, which is what lets a placer repoint it', () => {
    moduleRegistry.register(
      mod({ id: 'a', schemas: { feed: { node: { type: 'Column' }, subject: 'modules.a.collectionId' } } }),
      host,
    );

    expect(moduleRegistry.schemas()['a.feed']).toEqual({
      node: { type: 'Column' },
      subject: 'modules.a.collectionId',
    });
  });

  it('registers a fragments-only module with no store and no components', () => {
    const result = moduleRegistry.register(
      mod({ id: 'banner', slots: [{ anchor: 'banner', node: { type: 'Column' } }] }),
      host,
    );
    expect(result.registered).toBe(true);
    expect(moduleStores.banner).toBeUndefined();
    expect(moduleRegistry.components()).toEqual({});
  });

  it('surfaces embedded applications through the same registry as every other module', () => {
    moduleRegistry.register(
      mod({
        id: 'flux',
        name: 'Flux',
        icon: 'chat-circle',
        embed: { url: 'http://localhost:8080', allow: "camera 'src'", image: '/flux.png' },
      }),
      host,
    );
    moduleRegistry.register(mod({ id: 'notes' }), host);

    // Only the module that contributes an embed appears — the others are registered all the same.
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
    expect(moduleRegistry.has('notes')).toBe(true);
  });

  it('refuses an embedded app whose declared backend this host does not run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = moduleRegistry.register(
      mod({ id: 'flux', backends: ['other'], embed: { url: 'http://x', allow: '' } }),
      host,
    );

    // The point of folding embedded apps into the module contract: refusal is immediate and carries
    // a reason, instead of an iframe that mounts and waits on a handshake nobody will answer.
    expect(result.registered).toBe(false);
    expect(result.problems[0]).toContain('other');
    expect(moduleRegistry.embeds()).toEqual([]);
    warn.mockRestore();
  });
});

describe('module-declared anchors', () => {
  const provider: ModuleDefinition = {
    id: 'call',
    name: 'Calls',
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
  };

  const contributor: ModuleDefinition = {
    id: 'transcribe',
    name: 'Transcription',
    slots: [{ anchor: 'call-controls', node: { type: 'we-icon', props: { name: 'record' } } }],
  };

  /**
   * The bar's own children, past the per-space gate the registry wraps every contribution in.
   *
   * Found by shape rather than by taking the first `$if`: core chrome is registered too and several
   * pieces of it are `$if` nodes that come first in the order.
   */
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
    // Gated in turn — nesting inside another module's chrome does not exempt it from being switched
    // off — so what lands is the `$if` wrapper, not the raw icon, and certainly not the marker.
    expect(children[1].type).toBe('$if');
  });

  it('resolves the marker away when nothing is contributed', () => {
    moduleRegistry.register(provider, host, storeDeps);

    // Not an empty container: a gap in the row would be worse than the button being absent.
    expect(barChildren().map((c) => c.type)).toEqual(['we-button']);
  });

  it('keeps a contribution out of the top level, so it cannot render loose', () => {
    // Without the core-anchor filter an unknown anchor sorts to index -1 and renders first, ahead of
    // the boot screen — a call button floating at the top of the app.
    moduleRegistry.register(contributor, host, storeDeps);

    expect(slotRegistry.ordered().some((e) => e.id.startsWith('transcribe'))).toBe(false);
    expect(slotRegistry.nodesFor('call-controls')).toHaveLength(1);
  });

  it('reports a contribution to an anchor no module provides', () => {
    // Silent otherwise: chrome aimed at a missing anchor renders nowhere, which looks exactly like a
    // module that is switched off.
    moduleRegistry.register(contributor, host, storeDeps);
    expect(moduleRegistry.danglingAnchors()).toEqual(['call-controls']);

    moduleRegistry.register(provider, host, storeDeps);
    expect(moduleRegistry.danglingAnchors()).toEqual([]);
  });

  it('orders several contributions to one anchor deterministically', () => {
    moduleRegistry.register(provider, host, storeDeps);
    moduleRegistry.register(
      {
        id: 'reactions',
        name: 'Reactions',
        slots: [{ anchor: 'call-controls', node: { type: 'we-badge' }, order: 5 }],
      },
      host,
      storeDeps,
    );
    moduleRegistry.register(contributor, host, storeDeps);

    // By `order`, not by which module happened to register first.
    expect(slotRegistry.nodesFor('call-controls')).toHaveLength(2);
    expect(barChildren()).toHaveLength(3);
  });
});

describe('module teardown', () => {
  /**
   * The contract had no teardown, and the failure was a camera that stayed on: unregistering — or
   * merely re-registering, which a hot reload does — dropped the only reference to a module's live
   * peer connections and media stream with nothing left able to close them.
   */
  type Deps = { onDispose?: (fn: () => void) => void };
  const teardownMod = (id: string, onCreate: (deps: Deps) => void) =>
    mod({
      id,
      createStore: ((deps: Deps) => {
        onCreate(deps);
        return {};
      }) as ModuleDefinition['createStore'],
    });

  const host = { backend: 'inmemory', framework: 'solid' };

  it('runs a store’s disposers when the module is unregistered', () => {
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
    // Reverse order: later teardown generally depends on earlier setup.
    expect(closed).toEqual(['peers', 'stream']);
  });

  it('runs them on re-registration, which is what a hot reload does', () => {
    const closed: string[] = [];
    const definition = teardownMod('tear-b', (deps) => deps.onDispose?.(() => closed.push('closed')));

    moduleRegistry.register(definition, host, storeDeps);
    moduleRegistry.register(definition, host, storeDeps);

    // The replaced instance is torn down rather than abandoned holding a live device.
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
    // One throwing disposer must not be able to leave the camera on for the rest of them.
    expect(closed).toEqual(['last', 'first']);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('does not put teardown on the store, where a template could call it', () => {
    moduleRegistry.register(
      teardownMod('tear-a', (deps) => deps.onDispose?.(() => {})),
      host,
      storeDeps,
    );
    // Store keys are exposed to templates at `modules.<id>.<key>`; teardown is host business.
    const keys = Object.keys(moduleRegistry.get('tear-a')?.store ?? {});
    expect(keys).not.toContain('onDispose');
    expect(keys).not.toContain('destroy');
  });
});

/**
 * Chrome that belongs to something running, rather than to the space you are looking at.
 *
 * Every module's chrome is wrapped in a gate on `activeModules`, which is the space's decision. A
 * call outlives navigating away from where it started, so that gate took its bar away — hang-up
 * button and all — the moment the user walked into a space with calls switched off, while the call
 * itself carried on. `holdsWhen` is how a module says its chrome is not the space's to withdraw.
 */
describe('a module that is holding something live', () => {
  /** The condition a contribution's gate was built with. Docks register under a `dock:` prefix. */
  function gateOf(id: string): Record<string, unknown> {
    const entry = slotRegistry.all().find((e) => e.id === `${id}:0` || e.id === `dock:${id}:0`);
    const props = (entry?.node as { props?: Record<string, unknown> } | undefined)?.props;
    return (props?.condition ?? {}) as Record<string, unknown>;
  }

  const chrome = { anchor: 'dock-bottom', node: { type: 'Row' } };

  it('is gated on the space alone when it holds nothing', () => {
    moduleRegistry.register(mod({ id: 'plain', slots: [chrome] }), host);

    // Unchanged for every module that does not opt in — no disjunct, just the space's decision.
    expect(gateOf('plain')).toEqual({ $: "'plain' in spaceStore.activeModules" });
  });

  it('also renders wherever its own key says it is holding something', () => {
    moduleRegistry.register(mod({ id: 'held', slots: [chrome], holdsWhen: 'modules.held.active' }), host);

    // Still hidden by neither condition alone — the space's decision keeps working where the module
    // is holding nothing, which is the ordinary case even for a module that can hold something.
    expect(gateOf('held')).toEqual({ $: "'held' in spaceStore.activeModules || modules.held.active" });
  });

  it('gates a dock the same way as a slot', () => {
    // Both go through the same wrapper, but they are registered on separate paths — the call's stage
    // is a dock and its bar is a slot, and losing either mid-call is the same bug.
    moduleRegistry.register(
      mod({ id: 'docked', docks: [{ ...chrome, edge: 'bottom' }], holdsWhen: 'modules.docked.active' } as never),
      host,
    );

    expect(gateOf('docked').$).toContain('|| modules.docked.active');
  });
});

describe('agent-scoped modules', () => {
  /**
   * A fake schema port that records what it was asked to compile, and hands back one class per
   * entity name. Compiling for real needs a backend; what is under test is the routing.
   */
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
    ({
      version: '1.0.0',
      entities: { [name]: { base: 'Ad4mModel', properties: {}, relations: {} } },
    }) as never;

  it('routes an agent-scoped manifest to the root dataset and nowhere else', () => {
    // The failure this prevents is not abstract: an agent-scoped entity installed into a shared
    // space would sync one person's private records to a whole community.
    moduleRegistry.register(
      mod({ id: 'pocket', entities: { manifest: manifest('PocketItem'), scope: 'agent' } }),
      host,
    );
    const { port, compiled } = recordingPort();

    expect(moduleRegistry.moduleSchemas(port as never)).toEqual([]);
    expect(moduleRegistry.agentSchemas(port as never)).toEqual([{ className: 'PocketItem' }]);
    expect(compiled).toEqual(['PocketItem']);
  });

  it('leaves a module that says nothing about scope in the space, as before', () => {
    moduleRegistry.register(mod({ id: 'notes', entities: { manifest: manifest('Note') } }), host);
    const { port } = recordingPort();

    expect(moduleRegistry.moduleSchemas(port as never)).toEqual([{ className: 'Note' }]);
    expect(moduleRegistry.agentSchemas(port as never)).toEqual([]);
  });

  it('compiles each module once, however many datasets it is installed into', () => {
    // Install runs on every dataset switch, and fresh classes each time would churn the model
    // registry underneath live queries.
    moduleRegistry.register(
      mod({ id: 'pocket', entities: { manifest: manifest('PocketItem'), scope: 'agent' } }),
      host,
    );
    const { port, compiled } = recordingPort();

    moduleRegistry.agentSchemas(port as never);
    moduleRegistry.agentSchemas(port as never);

    expect(compiled).toEqual(['PocketItem']);
  });
});

/**
 * A module's panel contents, replaced by the interface that declared the panel.
 *
 * The gate is keyed by **dock id** though the template's declaration names a module, and the two
 * only diverge for a module contributing more than one panel — where keying by module would have
 * put one supplied body inside every one of them. None does today, which is the reason to pin it:
 * the day one does, the failure is a panel quietly showing the wrong contents.
 */
describe('supplying a module panel’s contents', () => {
  beforeEach(reset);

  const twoDocks = {
    id: 'twin',
    name: 'Twin',
    docks: [
      { edge: 'edgeA', node: { type: 'we-text', children: ['first'] } },
      { edge: 'edgeB', node: { type: 'we-text', children: ['second'] } },
    ],
    createStore: () => ({}),
  } as unknown as ModuleDefinition;

  it('gates each dock on its own id, not on the module’s', () => {
    moduleRegistry.register(twoDocks, host);

    const frames = slotRegistry.all().filter((entry) => entry.id.startsWith('dock:twin'));
    const json = frames.map((entry) => JSON.stringify(entry.node));

    expect(frames).toHaveLength(2);
    expect(json[0]).toContain("shellStore.panelSupplied['twin:0']");
    expect(json[1]).toContain("shellStore.panelSupplied['twin:1']");
    // Neither asks about the bare module name — that is the key that would answer for both at once.
    for (const entry of json) expect(entry).not.toContain("panelSupplied['twin']");
  });

  it('names each dock, so a placement survives a second panel being added', () => {
    /*
      The id was `<moduleId>:<index>`, which is stable only while nothing is inserted before it. A
      placement is remembered against that id, so adding a panel at the top of the list renumbered
      every one below it and threw away wherever anybody had dragged them.
    */
    const named = {
      id: 'twin',
      name: 'Twin',
      docks: [
        { edge: 'edgeA', name: 'transcript', node: { type: 'we-text' } },
        { edge: 'edgeB', name: 'extraction', node: { type: 'we-text' } },
      ],
      createStore: () => ({}),
    } as unknown as ModuleDefinition;
    moduleRegistry.register(named, host);

    const ids = slotRegistry
      .all()
      .filter((entry) => entry.id.startsWith('dock:twin'))
      .map((entry) => entry.id);

    expect(ids).toEqual(['dock:twin:transcript', 'dock:twin:extraction']);
  });

  it('tells a supplied body which dock it is for', () => {
    // Two frames ask, and a body matched on the module alone would land in whichever asked first —
    // the transcript inside the extraction panel, silently.
    const named = {
      id: 'twin',
      name: 'Twin',
      docks: [
        { edge: 'edgeA', name: 'transcript', node: { type: 'we-text' } },
        { edge: 'edgeB', name: 'extraction', node: { type: 'we-text' } },
      ],
      createStore: () => ({}),
    } as unknown as ModuleDefinition;
    moduleRegistry.register(named, host);

    expect(JSON.stringify(slotRegistry.get('dock:twin:extraction')?.node)).toContain('"dock":"extraction"');
  });

  it('composes its own chrome out of its own parts, expanded before it renders', () => {
    /*
      A module building its panel from its own published fragments is ordinary — the transcript panel
      builds its feed from `transcriptLines`. Only a *template* placing a part expanded one, so a
      module's own chrome reached the renderer with the marker intact and drew "Unknown component
      $part" in a red box where each fragment should have been. Invisible in an interface that
      supplies the body, which is why it showed up in the default template and not the workshop.
    */
    const withPart = {
      id: 'twin',
      name: 'Twin',
      schemas: { row: { type: 'we-text', children: ['from the part'] } },
      docks: [
        {
          edge: 'edgeA',
          name: 'transcript',
          node: { type: 'Column', children: [{ type: '$part', props: { id: 'twin.row' } }] },
        },
      ],
      createStore: () => ({}),
    } as unknown as ModuleDefinition;
    moduleRegistry.register(withPart, host);

    const rendered = JSON.stringify(
      slotRegistry.nodes().map((node) => {
        const expanded = resolveParts(node);
        return Array.isArray(expanded) ? expanded : [expanded];
      }),
    );

    expect(rendered).toContain('from the part');
    expect(rendered).not.toContain('$part');
  });

  it('still renders the module’s own contents on the other side of the gate', () => {
    // The override is a branch, not a replacement: a module whose panel nobody supplies is
    // unaffected, which is what makes this safe to key on something no template writes directly.
    moduleRegistry.register(twoDocks, host);

    const first = JSON.stringify(slotRegistry.get('dock:twin:0')?.node);

    expect(first).toContain('first');
    expect(first).toContain('TemplatePanelBody');
  });
});
