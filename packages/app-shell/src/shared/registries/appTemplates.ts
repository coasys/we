/**
 * The apps this build ships — templates with `meta.role: 'app'`, the chrome around every space.
 *
 * One today, WE's own. A deployment opens in the seed's `host.ui.app`, and an agent may choose one of
 * their own copies instead; safe mode always draws WE's, so an app that hides every way out is never
 * the only way in.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { weApp } from '@we/template-shell';

import { withDerivedIds, withDerivedIdsAll } from './derivedIds';
import { seedBundleApps } from './seedBundles';

export const DEFAULT_APP_ID = 'we-app';

export const appTemplateRegistry: Readonly<Record<string, TemplateSchema>> = {
  [DEFAULT_APP_ID]: withDerivedIds({ ...weApp, id: DEFAULT_APP_ID }, DEFAULT_APP_ID),
  // The apps the seed's bundles bring, built in beside WE's own.
  ...withDerivedIdsAll(seedBundleApps),
};

/**
 * Which app is drawn: the agent's choice, else the deployment's, else WE's — and WE's in safe mode,
 * or whenever the choice names nothing honoured.
 *
 * Honoured means one of the apps this build ships or one of the agent's own copies (`own`). An app is
 * drawn with the chrome tier, so a space's copy or anything else is not taken on a name alone: that
 * waits for an install that asks first.
 */
export function resolveAppTemplate(facts: {
  safe: boolean;
  chosen?: string;
  seed?: string;
  own: readonly TemplateSchema[];
}): TemplateSchema {
  const builtIn = appTemplateRegistry[DEFAULT_APP_ID];
  if (facts.safe) return builtIn;
  const id = facts.chosen || facts.seed || DEFAULT_APP_ID;
  return (
    appTemplateRegistry[id] ?? facts.own.find((t) => t.id === id && t.meta?.role === 'app' && !t._fromSpace) ?? builtIn
  );
}
