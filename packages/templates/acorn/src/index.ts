/**
 * `@we/template-acorn` — the Acorn shell and its sections, as data.
 *
 * The shell owns the space's chrome: a name/nav strip and the `$views` marker the resolved
 * section list expands into. The views are separate records — each installable and forkable
 * on its own — catalogued beside the built-in views in `generateViewRegistry.mjs` and enabled
 * per space through `Space.enabledViews`, exactly as every other section.
 *
 * v0: the views read the mounted Acorn classes directly through `$query` — enough for the
 * fixture render to prove the pipeline end to end. The project picker, expanded outcome,
 * write-through and the real map land in S2-2 and later.
 */
import type { TemplateSchema } from '@we/schema-shared';

import { acornMapView } from './views/MapView.ts';
import { acornOutcomesView } from './views/OutcomesView.ts';
import { acornOutcomeTableView } from './views/OutcomeTableView.ts';
import { acornPriorityView } from './views/PriorityView.ts';
import { acornSettingsView } from './views/SettingsView.ts';

export { acornTemplate } from './AcornTemplate.ts';
export { acornMapView } from './views/MapView.ts';
export { acornOutcomesView } from './views/OutcomesView.ts';
export { acornOutcomeTableView } from './views/OutcomeTableView.ts';
export { acornPriorityView } from './views/PriorityView.ts';
export { acornSettingsView } from './views/SettingsView.ts';

/**
 * The Acorn sections a space can enable, by the ids `we-seed.json`'s `views` list and
 * `Space.enabledViews` name. First in this object's order is where a member lands, so the
 * outcomes list is the default section — the fixture declares the same list in the same order.
 */
export const ACORN_VIEWS: Record<string, TemplateSchema> = {
  'acorn-outcomes': acornOutcomesView,
  'acorn-table': acornOutcomeTableView,
  'acorn-priority': acornPriorityView,
  'acorn-map': acornMapView,
  'acorn-settings': acornSettingsView,
};
