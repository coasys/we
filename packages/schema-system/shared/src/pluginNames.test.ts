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
