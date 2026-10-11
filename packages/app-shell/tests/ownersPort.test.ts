/**
 * Copying a section in place of the original, for everyone in the space.
 *
 * The copy goes into the space's templates and takes the original's place in the section list — the
 * same position, the original gone from it — in one write of the list, so a space is never left with
 * both or neither.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { createOwnersPort } from '../src/frameworks/solid/providers/ownersPort';

function setup(opts: { admin?: boolean; inSpace?: boolean } = {}) {
  const spaceTemplates: TemplateSchema[] = [];
  let enabled = ['about', 'cards', 'graph'];
  const writes: string[][] = [];
  /** How each save was asked to behave — whether it was to become the template on screen. */
  const saves: { activate?: boolean }[] = [];
  const view = {
    id: 'cards',
    segment: 'cards',
    schema: { id: 'cards', type: 'Column', meta: { name: 'Cards', role: 'view' } },
  };
  const port = createOwnersPort({
    space: {
      routableViews: () => [view],
      canAdministerCurrentSpace: () => opts.admin ?? true,
      enabledViewIds: () => enabled,
      setViewEnabled: async (id: string, on: boolean) => {
        enabled = on ? [...enabled, id] : enabled.filter((v) => v !== id);
      },
      reorderViews: async (ids: string[]) => {
        enabled = ids.filter((id) => enabled.includes(id));
        writes.push(enabled);
      },
      activeModules: () => [],
      installedModules: () => [],
      enabledModules: () => [],
    } as never,
    shell: {} as never,
    dataset: { currentDataset: () => (opts.inSpace === false ? null : { id: 'ds' }) } as never,
    template: {
      spaceTemplates: () => spaceTemplates,
      saveTemplateAs: async (schema: TemplateSchema, _where?: string, options: { activate?: boolean } = {}) => {
        saves.push(options);
        spaceTemplates.push({ ...schema, id: 'cards-yours' });
        return true;
      },
      switchTemplate: () => {},
    } as never,
  });
  return { port, enabled: () => enabled, writes, spaceTemplates, saves };
}

describe('copying a section in its place', () => {
  it('puts the copy where the original was, and the original out of the list', async () => {
    const { port, enabled, spaceTemplates, saves } = setup();
    const id = await port.forkView!('cards');
    expect(id).toBe('cards-yours');
    expect(enabled()).toEqual(['about', 'cards-yours', 'graph']);
    expect(spaceTemplates[0].forkedFrom).toBe('cards');
    expect(spaceTemplates[0].meta?.role).toBe('view');
    // Not made the template on screen: that replaced the whole shell with the one section.
    expect(saves).toEqual([{ activate: false }]);
  });

  it('is refused to somebody who does not run the space, and says so', async () => {
    const { port, enabled } = setup({ admin: false });
    expect(port.view('cards')?.forkBlocked).toMatch(/runs this space/);
    expect(await port.forkView!('cards')).toBeNull();
    expect(enabled()).toEqual(['about', 'cards', 'graph']);
  });

  it('is offered only inside a space', () => {
    expect(setup({ inSpace: false }).port.view('cards')?.forkBlocked).toMatch(/Open a space/);
  });
});

/*
  What arranging a module's panel keeps the module's is read off the panel: the parts it places, by
  name. A panel that pasted a piece in rather than placing it is not credited with keeping it.
*/
describe('what arranging a module’s panel keeps', () => {
  it('names the parts a panel places, in order, and only those', async () => {
    const { moduleRegistry } = await import('../src/shared/registries/moduleRegistry');
    moduleRegistry.register(
      {
        manifest: { id: 'kept', name: 'Kept' },
        contributes: {
          parts: {
            meter: { node: { type: 'we-badge' }, label: 'Meter' },
            feed: { node: { type: 'Column' }, label: 'Feed' },
          },
          panels: [
            {
              name: 'main',
              title: 'Main',
              node: {
                type: 'Column',
                children: [
                  { type: '$part', props: { id: 'kept.feed' } },
                  { type: 'we-text', children: ['pasted'] },
                  { type: '$part', props: { id: 'kept.meter' } },
                  { type: '$part', props: { id: 'kept.feed' } },
                ],
              },
            },
            { name: 'flat', title: 'Flat', node: { type: 'Column', children: [{ type: 'we-badge' }] } },
          ],
        },
      },
      { backend: 'ad4m', framework: 'solid' },
    );
    try {
      const { port } = setup();
      expect(port.panel('kept:main')).toMatchObject({ composed: true, placed: ['Feed', 'Meter'] });
      expect(port.panel('kept:flat')).toMatchObject({ composed: false, placed: [] });
    } finally {
      moduleRegistry.unregister('kept');
    }
  });
});
