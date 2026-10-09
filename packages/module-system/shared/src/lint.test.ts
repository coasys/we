import { describe, expect, it } from 'vitest';

import { lintModule } from './lint';
import type { ModuleDefinition } from './module';

const manifest = (name: string, blockable = false) =>
  ({
    version: '1',
    entities: { [name]: { blockable, properties: { version: { type: 'number', default: 0 } }, relations: {} } },
  }) as never;

const mod = (overrides: Partial<ModuleDefinition> = {}): ModuleDefinition => ({
  manifest: { id: 'demo', name: 'Demo' },
  ...overrides,
});

describe('lintModule — refusals', () => {
  it('requires an id in the shape a store, a predicate subtree and a package can carry', () => {
    expect(lintModule(mod({ manifest: { id: '', name: 'x' } })).problems[0]).toContain('manifest.id is required');
    expect(lintModule(mod({ manifest: { id: 'My Module', name: 'x' } })).problems[0]).toContain('lower-case');
    expect(lintModule(mod()).problems).toEqual([]);
  });

  it('requires a unique name on every panel', () => {
    const twins = mod({
      contributes: {
        panels: [
          { name: 'a', title: 'x', node: { type: 'Column' } },
          { name: 'a', title: 'y', node: { type: 'Column' } },
        ],
      },
    });
    expect(lintModule(twins).problems[0]).toContain('"a"');
    expect(
      lintModule(mod({ contributes: { panels: [{ name: '', title: 'x', node: { type: 'Column' } }] } })).problems[0],
    ).toContain('needs a name');
  });

  it('refuses components without a framework, and a bad predicate override', () => {
    expect(lintModule(mod({ contributes: { components: { X: () => null } } })).problems[0]).toContain(
      'requires.frameworks',
    );
    const bad = mod({
      contributes: {
        entities: { manifest: manifest('Thing'), predicates: { 'Thing.version': 'we://module/other/v' } },
      },
    });
    expect(lintModule(bad).problems[0]).toContain('we://module/demo/');
  });

  it('checks a block against the manifest and the parts', () => {
    const noEntity = mod({
      contributes: { blocks: [{ entity: 'Poll', card: 'card' }], parts: { card: { type: 'Column' } } },
    });
    expect(lintModule(noEntity).problems[0]).toContain('does not declare');
    const noCard = mod({
      contributes: { entities: { manifest: manifest('Poll', true) }, blocks: [{ entity: 'Poll', card: 'card' }] },
    });
    expect(lintModule(noCard).problems[0]).toContain('card part "card"');
    const fine = mod({
      contributes: {
        entities: { manifest: manifest('Poll', true) },
        parts: { card: { type: 'Column' } },
        blocks: [{ entity: 'Poll', card: 'card' }],
      },
    });
    expect(lintModule(fine).problems).toEqual([]);
  });

  it('refuses a view with no id or the wrong role', () => {
    const views = [{ type: 'Column', meta: { name: 'x', description: '', icon: '', role: 'view' } }] as never;
    expect(lintModule(mod({ contributes: { views } })).problems[0]).toContain('no id');
    const shell = [{ id: 'v', type: 'Column', meta: { name: 'x', description: '', icon: '' } }] as never;
    expect(lintModule(mod({ contributes: { views: shell } })).problems[0]).toContain("meta.role: 'view'");
  });
});

describe('lintModule — warnings', () => {
  it('flags inert settings and panels without refusing the module', () => {
    const lint = lintModule(
      mod({
        contributes: {
          panels: [{ name: 'p', title: 'P', node: { type: 'Column' }, open: 'open' }],
          settings: [
            { key: 'r', label: 'R', type: 'boolean', default: false, levels: ['space'], resolution: 'restrict' },
            { key: 'e', label: 'E', type: 'enum', default: '', levels: ['space'] },
            { key: 's', label: 'S', type: 'secret', default: '', levels: ['agent', 'space'] },
          ],
        },
      }),
    );
    expect(lint.problems).toEqual([]);
    expect(lint.warnings.some((w) => w.includes('names no close action'))).toBe(true);
    expect(lint.warnings.some((w) => w.includes('restrict and defaults to false'))).toBe(true);
    expect(lint.warnings.some((w) => w.includes('enum with no options'))).toBe(true);
    expect(lint.warnings.some((w) => w.includes('above the agent level'))).toBe(true);
    expect(lint.warnings.some((w) => w.includes('secrets kernel'))).toBe(true);
  });

  it('flags a block whose entity is not blockable', () => {
    const lint = lintModule(
      mod({
        contributes: {
          entities: { manifest: manifest('Poll') },
          parts: { card: { type: 'Column' } },
          blocks: [{ entity: 'Poll', card: 'card' }],
        },
      }),
    );
    expect(lint.warnings[0]).toContain('not marked blockable');
  });
});

describe('lintModule — one module reaching another', () => {
  it('refuses a store read from a part, and names the surface and the member', () => {
    const lint = lintModule(
      mod({ contributes: { parts: { bar: { type: 'Column', props: { hidden: { $: '!modules.call.active' } } } } } }),
    );
    expect(lint.problems).toHaveLength(1);
    expect(lint.problems[0]).toContain('part "bar"');
    expect(lint.problems[0]).toContain('modules.call.active');
    expect(lint.problems[0]).toContain('capabilities-and-surfaces');
  });

  it('refuses an action, and finds one inside an array a renderer walk would step over', () => {
    // A `DropdownMenu`'s entries are a *prop*, so a structural walk never reaches them — which is
    // exactly where a reference would survive review.
    const lint = lintModule(
      mod({
        contributes: {
          panels: [
            {
              name: 'p',
              title: 'P',
              node: {
                type: 'DropdownMenu',
                props: { items: [{ id: 'x', label: 'Go', onSelect: { $action: 'modules.call.startCall' } }] },
              },
            },
          ],
        },
      }),
    );
    expect(lint.problems).toHaveLength(1);
    expect(lint.problems[0]).toContain('panel "p"');
    expect(lint.problems[0]).toContain('modules.call.startCall');
  });

  it("refuses placing another module's part, and says whose it is", () => {
    const lint = lintModule(
      mod({
        contributes: {
          slots: [{ anchor: 'overlay', node: { type: '$part', props: { id: 'transcribe.transcriptFeed' } } }],
        },
      }),
    );
    expect(lint.problems).toHaveLength(1);
    expect(lint.problems[0]).toContain('anchor "overlay"');
    expect(lint.problems[0]).toContain('transcribe module');
  });

  it('allows the bare installed-check, and a module naming itself', () => {
    const lint = lintModule(
      mod({
        contributes: {
          parts: {
            // The sanctioned optional dependency: resolves to nothing where the module is absent.
            gate: { type: '$if', props: { condition: { $: 'modules.call' }, then: { type: 'Column' } } },
            own: { type: 'we-button', props: { onClick: { $action: 'modules.demo.toggle' } } },
          },
        },
      }),
    );
    expect(lint.problems).toEqual([]);
  });

  it('warns rather than refuses in a contributed view, which is a template', () => {
    const lint = lintModule(
      mod({
        contributes: {
          views: [
            {
              id: 'v',
              meta: { role: 'view', name: 'V', description: '', icon: 'x' },
              type: 'Column',
              props: { hidden: { $: 'modules.call.active' } },
            } as never,
          ],
        },
      }),
    );
    expect(lint.problems).toEqual([]);
    expect(lint.warnings[0]).toContain('view "v"');
    expect(lint.warnings[0]).toContain('meta.requires.modules');
  });

  it('reports each distinct member once, however often it is named', () => {
    const lint = lintModule(
      mod({
        contributes: {
          parts: {
            a: {
              type: 'Column',
              props: { hidden: { $: 'modules.call.active' }, bg: { $: 'modules.call.active ? "page" : "surface"' } },
              children: [{ type: 'we-text', props: { text: { $: 'modules.call.callId' } } }],
            },
          },
        },
      }),
    );
    expect(lint.problems).toHaveLength(2);
    expect(lint.problems.some((p) => p.includes('modules.call.active'))).toBe(true);
    expect(lint.problems.some((p) => p.includes('modules.call.callId'))).toBe(true);
  });
});

/*
  A part is placed by people who did not write it, so the names it needs from around it have to be
  said. These are the reads a placement would otherwise discover by watching the part render empty.
*/
describe('a part that reads from its parents', () => {
  const withPart = (part: unknown) =>
    ({
      manifest: { id: 'demo', name: 'Demo' },
      contributes: { parts: { row: part } },
    }) as unknown as Parameters<typeof lintModule>[0];

  it('is warned about when it does not declare the name', () => {
    const lint = lintModule(withPart({ type: 'we-text', children: [{ $: 'tile.name' }] }));
    expect(lint.warnings.some((w) => w.includes('"tile"'))).toBe(true);
  });

  it('is fine once it declares it', () => {
    const lint = lintModule(
      withPart({
        node: { type: 'we-text', children: [{ $: 'tile.name' }] },
        inputs: { tile: { description: 'the participant this tile shows' } },
      }),
    );
    expect(lint.warnings).toEqual([]);
  });

  it('is not warned about for what it binds itself', () => {
    const lint = lintModule(
      withPart({
        type: '$each',
        props: { items: { $: 'modules.demo.rows' }, as: 'row' },
        children: [{ type: 'we-text', children: [{ $: 'row.name' }, { $: 'local.open' }] }],
        $localState: { open: { type: 'boolean', initial: false } },
      }),
    );
    expect(lint.warnings).toEqual([]);
  });

  it('is warned about for a local nothing inside it declares', () => {
    const lint = lintModule(withPart({ type: 'we-text', children: [{ $: 'local.selected' }] }));
    expect(lint.warnings.some((w) => w.includes('local "selected"'))).toBe(true);
  });

  it('is warned about for an input it declares and never reads', () => {
    const lint = lintModule(withPart({ node: { type: 'we-text' }, inputs: { tile: { description: 'x' } } }));
    expect(lint.warnings.some((w) => w.includes('never reads'))).toBe(true);
  });
});
