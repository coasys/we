/**
 * A plugin name a component resolves at runtime is checked against the component's catalogue.
 *
 * Without the check a misspelt name renders nothing: the component looks it up, finds no plugin and
 * logs to the console of whoever opens the page. The globe's layer list is the case that made it
 * worth having, since it is exactly what an LLM writes from the reference.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ContextData, PluginCatalog } from './contextTypes';
import { buildValidationContext, validateSemantic } from './semanticValidation';
import type { SchemaNode } from './types';

const CATALOG: PluginCatalog = {
  component: 'CesiumGlobe',
  placements: [
    { prop: 'planetLayers', key: 'factory', categories: ['planet'] },
    { prop: 'backgroundLayers', key: 'factory', categories: ['background'] },
  ],
  plugins: [
    { id: 'countryOutlinesLayer', category: 'planet' },
    { id: 'pointLocationsLayer', category: 'planet' },
    { id: 'skyboxLayer', category: 'background' },
  ],
};

const data: ContextData = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../ai-context/context.json'), 'utf-8'),
);
const context = buildValidationContext({ ...data, pluginCatalogs: [CATALOG] });

const globe = (props: Record<string, unknown>): SchemaNode =>
  ({
    type: 'Column',
    meta: { name: 'T', description: '', icon: 'globe' },
    props: { bg: 'page' },
    children: [{ type: 'CesiumGlobe', props }],
  }) as unknown as SchemaNode;

const faults = (props: Record<string, unknown>) =>
  validateSemantic(globe(props), context).errors.filter((e) => e.path.includes('Layers'));

describe('a plugin name in a catalogued position', () => {
  it('is accepted when the catalogue knows it, in the right list', () => {
    expect(
      faults({
        planetLayers: [{ factory: 'countryOutlinesLayer' }, { factory: 'pointLocationsLayer', id: 'b' }],
        backgroundLayers: [{ factory: 'skyboxLayer' }],
      }),
    ).toEqual([]);
  });

  it('is refused when misspelt, with the nearest name in that list', () => {
    const [fault] = faults({ backgroundLayers: [{ factory: 'skyboxLayr' }] });
    expect(fault?.path).toMatch(/props\.backgroundLayers\.0\.factory$/);
    expect(fault?.message).toContain('Did you mean "skyboxLayer"?');
  });

  it('is refused in the wrong list, saying which list it belongs in', () => {
    const [fault] = faults({ planetLayers: [{ factory: 'skyboxLayer' }] });
    expect(fault?.message).toContain('is a background plugin');
  });

  it('is left alone when an expression computes it', () => {
    expect(faults({ planetLayers: [{ factory: { $: 'local.kind' } }] })).toEqual([]);
  });

  it('lists what exists when nothing is close', () => {
    const [fault] = faults({ planetLayers: [{ factory: 'weatherRadar' }] });
    expect(fault?.message).toContain('Known: countryOutlinesLayer, pointLocationsLayer');
  });
});

/*
  The graph's names, through the real generated context. They sit in more shapes than the globe's:
  one object (`layout`), one object or a list (`seeds`), a list of plain names inside an object
  (`expansion.expanders`), and names on their own beside objects (`behaviours`, `controls`).
*/
describe('a graph plugin name', () => {
  const real = buildValidationContext(data);
  const graph = (props: Record<string, unknown>): SchemaNode =>
    ({
      type: 'Column',
      meta: { name: 'T', description: '', icon: 'graph' },
      props: { bg: 'page' },
      children: [{ type: 'GraphView', props }],
    }) as unknown as SchemaNode;
  const faults = (props: Record<string, unknown>) =>
    validateSemantic(graph(props), real).errors.filter((e) => e.message.includes('plugin'));

  it('is accepted in every shape the real templates write', () => {
    expect(
      faults({
        seeds: [{ source: 'query', options: { entity: 'Post' } }, { source: 'schema' }],
        expansion: { defaultDepth: 1, expanders: ['collection', 'entity'] },
        layout: { type: 'force', options: { distance: 140 } },
        behaviours: ['select', { type: 'drag-node', options: { pin: true } }, 'pan-zoom'],
        controls: ['zoom-in', 'fit'],
      }),
    ).toEqual([]);
  });

  it('is left alone where a template computes it, or writes a static diagram with no source', () => {
    expect(faults({ layout: { $: 'local.layout' }, seeds: { literal: true, nodes: [], edges: [] } })).toEqual([]);
  });

  it.each([
    ['a layout', { layout: { type: 'forse' } }, 'layout.type', 'force'],
    ['a seed in a list', { seeds: [{ source: 'schema' }, { source: 'qurey' }] }, 'seeds.1.source', 'query'],
    ['an expander', { expansion: { expanders: ['colection'] } }, 'expansion.expanders.0', 'collection'],
    ['a behaviour named on its own', { behaviours: ['selct', 'pan-zoom'] }, 'behaviours.0', 'select'],
    ['a behaviour in an object', { behaviours: [{ type: 'drag-nod' }] }, 'behaviours.0.type', 'drag-node'],
    ['a control', { controls: ['zoom-inn'] }, 'controls.0', 'zoom-in'],
  ])('is refused when misspelt: %s', (_name, props, where, meant) => {
    const [fault] = faults(props);
    expect(fault?.path).toMatch(new RegExp(`props\\.${where.replace(/\./g, '\\.')}$`));
    expect(fault?.message).toContain(`Did you mean "${meant}"?`);
  });

  it('is refused in the wrong position, saying where it belongs', () => {
    const [fault] = faults({ layout: { type: 'select' } });
    expect(fault?.message).toContain('is a behaviour plugin');
  });
});

/*
  The catalogues have to be in the context the validator reads, not only in the reference text.
  For one PR the globe's layer names were "checked" by a test that passed its catalogue in by hand,
  while context.json carried none, so no template anywhere was checked. This holds the real file to it.
*/
describe('the generated context', () => {
  it.each([
    ['CesiumGlobe', 'planetLayers'],
    ['GraphView', 'layout'],
  ])('carries the %s catalogue, with where its names go', (component, prop) => {
    const catalog = data.pluginCatalogs?.find((c) => c.component === component);
    expect(catalog?.plugins.length, `${component} has no catalogue in context.json`).toBeGreaterThan(0);
    expect(catalog?.placements?.some((p) => p.prop === prop)).toBe(true);
  });
});
