/**
 * Solid's live document: a nested store, edited at the paths that changed (`updateSchema`) or
 * reconciled whole. The handle is `shared/liveTemplate.ts`; this is what `BootController` lends the
 * template store, so an edit deep in a template updates the nodes it touched and nothing remounts.
 */
import type { LiveTemplates } from '@shared/liveTemplate';
import type { TemplateSchema } from '@we/schema-shared';
import { updateSchema } from '@we/schema-solid';
import { createStore, reconcile } from 'solid-js/store';

export const solidLiveTemplates: LiveTemplates = (initial) => {
  const [tree, setTree] = createStore<TemplateSchema>(initial);
  return {
    // The same proxy for the document's whole life, so whoever holds it sees every edit.
    read: () => tree,
    update: (next) => updateSchema(tree, next, setTree),
    replace: (next) => setTree(reconcile(next)),
  };
};
