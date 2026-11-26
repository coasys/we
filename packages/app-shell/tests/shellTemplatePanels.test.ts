/**
 * The shell store's template-panels part: a panel an interface supplies becomes a dock, closes and
 * opens by its id, opens once per set of inputs, goes when the interface stops declaring it, and the
 * arrangement on screen can be saved back as a template. Under each reactivity port.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestPlatform, type TestPlatform } from '../src/shared/platform/testPlatform';
import { dockRegistry } from '../src/shared/registries/dockRegistry';
import { setTemplatePanels } from '../src/shared/registries/templatePanels';
import { buildParts, reactivityPorts } from './support/shellPorts';

const SCOPE = 'template-panels-test';
const panels = [{ id: 'inspector', title: 'Inspector', snap: 'left' as const, node: { type: 'div' } }];

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  let platform: TestPlatform;
  const build = () => {
    const parts = buildParts(makePort(), platform);
    disposers.push(parts.dispose);
    parts.arrangement.members.provideAgentDid(() => 'did:me');
    return parts;
  };
  beforeEach(() => {
    platform = createTestPlatform({ url: '/space/test' });
    setTemplatePanels(panels, SCOPE);
  });
  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    setTemplatePanels(undefined);
  });

  it('makes a supplied panel a dock, and closes and opens it by its id', () => {
    const { docks, templatePanels, arrangement } = build();
    expect(dockRegistry.get('template:inspector')).toBeDefined();
    expect(docks.dockRequests().find((request) => request.id === 'template:inspector')?.edge).toBe('left');

    arrangement.members.closeTemplatePanel('inspector');
    expect(docks.dockRequests().find((request) => request.id === 'template:inspector')?.edge).toBe(null);
    templatePanels.members.openTemplatePanel('inspector');
    expect(docks.dockRequests().find((request) => request.id === 'template:inspector')?.edge).toBe('left');
  });

  it('withdraws the dock when the interface stops declaring it', () => {
    build();
    setTemplatePanels(undefined);
    expect(dockRegistry.get('template:inspector')).toBeUndefined();
  });

  it('opens one instance per set of inputs, and refuses a panel the interface does not supply', () => {
    const { templatePanels, arrangement, docks } = build();
    const ada = templatePanels.members.openPanel('inspector', { name: 'Ada' });
    expect(templatePanels.members.openPanel('inspector', { name: 'Ada' })).toBe(ada);
    expect(arrangement.members.panelInstances().map((instance) => instance.id)).toEqual([ada]);
    expect(docks.dockRequests().some((request) => request.id === ada)).toBe(true);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(templatePanels.members.openPanel('nowhere')).toBe('');
    warn.mockRestore();
  });

  it('saves the arrangement on screen over the declaration, and nothing else of it', async () => {
    const { templatePanels, docks } = build();
    docks.members.snapDock('template:inspector', 'bottom-right');
    const saved: TemplateSchema[] = [];
    const schema = { type: 'Column', meta: { name: 'Mine', panels } } as unknown as TemplateSchema;
    templatePanels.members.provideTemplateSaver({
      current: () => schema,
      save: (next) => {
        saved.push(next);
        return Promise.resolve(true);
      },
    });
    await expect(templatePanels.members.saveArrangementAsTemplate()).resolves.toBe(true);
    expect(saved[0].meta?.panels?.[0]).toMatchObject({ id: 'inspector', title: 'Inspector', snap: 'bottom-right' });
  });
});
