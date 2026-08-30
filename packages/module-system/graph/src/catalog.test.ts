/**
 * The catalogue and the plugins it claims exist.
 *
 * ## Why this is a test
 *
 * `GRAPH_PLUGIN_CATALOG` is the *only* thing that tells a template author — or an LLM writing a
 * schema — which strings `layout.type`, `seeds.source`, `expansion.expanders` and `behaviours`
 * accept. The props say "string". The validator cannot check a plugin name. So a name that is in
 * the catalogue and not in the registry is a template written from the documentation that renders
 * an empty canvas, and a plugin in the registry and not in the catalogue is one nobody can find.
 *
 * Both directions fail silently and neither is visible in review: the catalogue is a list of object
 * literals hundreds of lines from the code it describes, and adding a plugin does not touch it.
 * `docs/contributing/surfaces.md` already names this as the registration step whose omission is
 * invisible — the globe is the cautionary case it cites, where a good layer protocol has no
 * catalogue and so cannot be authored against at all.
 *
 * Asserted against what `GraphView` actually constructs, so a plugin is covered by being reachable
 * rather than by somebody remembering to add it here.
 */
import { defaultBehaviours, defaultControls, defaultMetrics } from '@we/graph-core';
import { defaultExpanders } from '@we/graph-expanders';
import { defaultLayouts } from '@we/graph-layouts';
import { describe, expect, it } from 'vitest';

import { GRAPH_PLUGIN_CATALOG } from './catalog';

/** What `GraphView.solid.tsx` puts in its `PluginRegistry`, by category. */
function registered(): Record<string, string[]> {
  const { expanders, seeds } = defaultExpanders();
  return {
    seed: seeds.map((s) => s.id),
    expander: expanders.map((e) => e.id),
    layout: Object.keys(defaultLayouts()),
    behaviour: Object.keys(defaultBehaviours()),
    // An array of metrics rather than a map, unlike its neighbours — the ids are on the objects.
    metric: defaultMetrics().map((m) => m.id),
    control: Object.keys(defaultControls()),
  };
}

/** What the catalogue documents, by category. */
function catalogued(): Record<string, string[]> {
  const byCategory: Record<string, string[]> = {};
  for (const plugin of GRAPH_PLUGIN_CATALOG.plugins) {
    (byCategory[plugin.category] ??= []).push(plugin.id);
  }
  return byCategory;
}

describe('every graph plugin is documented, and every documented plugin exists', () => {
  // `style` is deliberately absent from this list: those entries document *fields* of a style rule
  // (`curve`, `arrow`, `labelMinZoom`) rather than named plugins, so there is no registry to
  // compare them against. They are catalogued because an author cannot discover them otherwise.
  const CATEGORIES = ['seed', 'expander', 'layout', 'behaviour', 'metric', 'control'];

  it.each(CATEGORIES)('%s: the two lists are the same set', (category) => {
    expect([...(catalogued()[category] ?? [])].sort()).toEqual([...(registered()[category] ?? [])].sort());
  });

  it('finds plugins in every category, so nothing above is vacuous', () => {
    for (const category of CATEGORIES) {
      expect(registered()[category]?.length, `no ${category} plugins registered`).toBeGreaterThan(0);
    }
  });

  it('says what each one is for, and shows one being used', () => {
    /*
      A catalogue entry with no description is a name, and a name is what the props already gave.
      The example matters more than it looks: these are nested option objects, and the difference
      between `{ "type": "force" }` and `{ "source": "query", "options": { … } }` is not derivable
      from the id — it is the shape the author has to get right first time.

      Examples are required only where the plugin takes options; a bare behaviour listed by name in
      an array needs none.
    */
    for (const plugin of GRAPH_PLUGIN_CATALOG.plugins) {
      expect(plugin.description?.trim(), `${plugin.id} has no description`).toBeTruthy();
      if (plugin.options?.length) {
        expect(plugin.example?.trim(), `${plugin.id} takes options and shows no example`).toBeTruthy();
        for (const option of plugin.options) {
          expect(option.description?.trim(), `${plugin.id}.${option.name} has no description`).toBeTruthy();
        }
      }
    }
  });
});
