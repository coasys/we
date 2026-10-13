/**
 * The app as a template: which one is drawn, and how WE's chrome becomes its parts.
 */
import { appTemplateRegistry, DEFAULT_APP_ID, resolveAppTemplate } from '@shared/registries/appTemplates';
import { HOST_PART_SLOTS, HOST_PARTS, hostPartNode } from '@shared/registries/hostParts';
import { resolveParts } from '@shared/registries/moduleParts';
import { registerCoreSlots, slotRegistry } from '@shared/registries/slotRegistry';
import { HOST_PART_IDS, type SchemaNode, type TemplateSchema } from '@we/schema-shared';
import { beforeEach, describe, expect, it } from 'vitest';

const mine = {
  id: 'my-app',
  type: 'Column',
  meta: { name: 'Mine', description: '', icon: '', role: 'app' },
} as TemplateSchema;
const builtIn = appTemplateRegistry[DEFAULT_APP_ID];

describe('which app is drawn', () => {
  it('is WE’s own until somebody chooses', () => {
    expect(resolveAppTemplate({ safe: false, own: [] })).toBe(builtIn);
    expect(builtIn.meta).toMatchObject({ role: 'app', frame: { left: 80, right: 56 } });
  });

  it('is the agent’s own app when they chose it, over the deployment’s', () => {
    expect(resolveAppTemplate({ safe: false, chosen: 'my-app', seed: DEFAULT_APP_ID, own: [mine] })).toBe(mine);
  });

  it('is the deployment’s when the agent has not chosen', () => {
    expect(resolveAppTemplate({ safe: false, seed: DEFAULT_APP_ID, own: [mine] })).toBe(builtIn);
  });

  it('is WE’s in safe mode, whatever was chosen', () => {
    expect(resolveAppTemplate({ safe: true, chosen: 'my-app', own: [mine] })).toBe(builtIn);
  });

  it('never takes a space’s copy, or a template that is not an app, on its name', () => {
    const spaces = { ...mine, _fromSpace: true } as TemplateSchema;
    const notApp = { ...mine, meta: { ...mine.meta, role: undefined } } as TemplateSchema;
    expect(resolveAppTemplate({ safe: false, chosen: 'my-app', own: [spaces] })).toBe(builtIn);
    expect(resolveAppTemplate({ safe: false, chosen: 'my-app', own: [notApp] })).toBe(builtIn);
  });
});

describe('WE’s chrome as host parts', () => {
  beforeEach(() => {
    slotRegistry.clear();
    registerCoreSlots();
  });

  it('names the pieces the schema vocabulary declares, and nothing else', () => {
    expect(Object.keys(HOST_PARTS).sort()).toEqual([...HOST_PART_IDS].sort());
  });

  it('draws each from the slot it always came from, and leaves those out of the host’s own list', () => {
    for (const id of HOST_PART_IDS) expect(hostPartNode(id)).toBeTruthy();
    const ids = slotRegistry.ordered().map((entry) => entry.id);
    for (const slot of HOST_PART_SLOTS) expect(ids).toContain(slot);
    const rest = slotRegistry.nodes({ except: HOST_PART_SLOTS });
    expect(rest).toHaveLength(slotRegistry.nodes().length - HOST_PART_SLOTS.size);
  });

  /*
    The editor names a fork in a dialog it opens from the app's own rail and from the inspector while
    the app is the target. Drawn inside a host part, it is inert while the app is edited visually and
    missing from an app that leaves that part out — so it has to be drawn by the host, beside them.
  */
  it('draws the dialog the editor names a fork in outside every piece an app places', () => {
    const opensPicker = (node: unknown) => JSON.stringify(node ?? null).includes('editorStore.pickerOpen');
    for (const slot of HOST_PART_SLOTS) expect(opensPicker(slotRegistry.nodeOf(slot))).toBe(false);
    expect(slotRegistry.nodes({ except: HOST_PART_SLOTS }).some(opensPicker)).toBe(true);
  });

  it('expands an app’s placements into the pieces, framed like any part', () => {
    const { meta: _meta, ...app } = builtIn;
    const expanded = resolveParts(app as SchemaNode) as SchemaNode;
    const frames = (expanded.children as SchemaNode[]).filter((child) => child.type === 'PartFrame');
    expect(frames.map((frame) => (frame.props as { part: string }).part)).toEqual(['host.sidebar', 'host.rail']);
    for (const frame of frames) expect((frame.children as SchemaNode[]).length).toBe(1);
  });
});
