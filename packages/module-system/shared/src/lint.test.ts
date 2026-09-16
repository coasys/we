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
