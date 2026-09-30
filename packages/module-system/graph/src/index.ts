/**
 * The Graph feature module.
 *
 * A module rather than a bare widget for one reason: the graph has a *plugin library*, and a plugin
 * library needs an owner. Expanders, layouts, behaviours and node renderers are contributed, resolved
 * by name from a template, and — the point of the exercise — extensible by modules nobody has written
 * yet. The module is what holds that registry and declares what it ships.
 *
 * ## Why it takes the component instead of importing it
 *
 * The same reason the globe module does: this package never pulls Solid or a renderer into its own
 * bundle, so the host passes in the component it already has through `ModuleHost`. That keeps the
 * single-instance guarantee that matters once modules load dynamically — a module bundle importing its
 * own copy of a reactive framework gets a second runtime, and reactivity silently stops crossing the
 * boundary.
 *
 * ## Why it has no store and no entities
 *
 * A graph is a *view* over data somebody else owns. Which nodes are open, where the camera is and what
 * is selected are all per-view and per-node, which is `$localState`'s job — a store would make two
 * graphs on one page share an expansion state, which is not a thing anyone wants.
 */
import { defineModule, type ModuleDefinition, type ModuleHost } from '@we/module-shared';

import { contentTree, knowledgeMap, schemaMap, staticDiagram } from './fragments';

export { contentTree, knowledgeMap, schemaMap, staticDiagram } from './fragments';
export { GRAPH_PLUGIN_CATALOG } from './catalog';

/**
 * Build the module definition.
 *
 * A factory taking the component, for the reason in the file header. Backend-agnostic: everything the
 * graph reads goes through the host's query binding, so `requires.backends` stays omitted — the
 * portable default. `frameworks` names solid because the *component* is Solid, even though this file
 * is not.
 */
export function createGraphModule(graphViewComponent: unknown): ModuleDefinition {
  return defineModule({
    manifest: {
      id: 'graph',
      name: 'Graph',
      description:
        'A general-purpose graph engine — knowledge maps, schema maps, hierarchies and diagrams, with pluggable expanders, layouts and behaviours.',
      icon: 'graph',
      // Reads through the host's data bindings and paints; it reaches no kernel.
      requires: { frameworks: ['solid'] },
    },
    contributes: {
      components: { GraphView: graphViewComponent },
      /**
       * Placeable graphs. Named rather than parameterised where a fragment is genuinely fixed, and a
       * function where the only thing that varies is the entity — `knowledgeMap({ entity: 'Belief' })`
       * reads better in a template than a fragment plus an override.
       */
      parts: {
        schemaMap,
        contentTree,
        staticDiagram,
        knowledgeMapPosts: knowledgeMap({ entity: 'Post' }),
      },
    },
  });
}

/** The one factory shape every module package exports — the generated registry imports it. */
export const createModule = (host: ModuleHost): ModuleDefinition => createGraphModule(host.components.GraphView);
