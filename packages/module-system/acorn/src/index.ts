/**
 * `@we/module-acorn` — Acorn project management as a WE feature module.
 *
 * What this stage contributes is deliberately thin: the **manifest** naming the parts Acorn's
 * UI is planned to be, and the **pure functions** its views share — status, scope, task-list and
 * time-frame projections over Acorn's wire fields. There is no store, no entity manifest and no
 * kernel requirement: a mounted Acorn project's records arrive as space shapes (`@we/acorn-fixture`
 * shows the form), which the views query like any space data.
 *
 * **No `requires.backends`** — the module is backend-neutral by contract (design §L.1). The same
 * definition registers on the in-memory backend the fixture tests run on and the AD4M backend the
 * app runs on; that dual registration is this package's gate test, not a hope.
 *
 * What is *not* here: the lifecycle that mounts an Acorn perspective, the write path back to
 * stock Acorn, and the map canvas — S2-2 and later, none of which changes what registers today.
 */
import type { ModuleDefinition, ModuleHost, ModuleManifest } from '@we/module-shared';
import { defineModule } from '@we/module-shared';

import { ACORN_FUNCTIONS } from './functions.ts';
import { ACORN_PARTS } from './parts.ts';

export { ACORN_FUNCTIONS } from './functions.ts';
export { ACORN_PARTS } from './parts.ts';

export const ACORN_MANIFEST: ModuleManifest = {
  id: 'acorn',
  name: 'Acorn',
  description: 'Project management over a mounted Acorn project — outcomes, the tree, priorities, members',
  icon: 'squirrel',
};

export const acornModule: ModuleDefinition = defineModule({
  manifest: ACORN_MANIFEST,
  contributes: {
    parts: ACORN_PARTS,
    functions: ACORN_FUNCTIONS,
  },
});

export const createModule = (_host: ModuleHost): ModuleDefinition => acornModule;
