/**
 * The schema-test harness, as the *only* module that reaches it.
 *
 * ## Why this file exists at all
 *
 * ~97KB of test schemas, and until now every one of them shipped to users. The `import.meta.env.DEV`
 * branches around the two registrations looked like exclusion and were not: a branch decides whether
 * a *value is used*, and the module holding it was still imported at the top of `TemplateLayout` and
 * `TemplateStore`. A top-level import is reachability, and reachability is what a bundler answers to
 * — so the strings sat in `apps/we-web/dist` behind a condition that could never be true.
 *
 * The fix is not a better flag. It is that nothing may import the harness statically, which is a
 * property a file can hold and a boolean cannot. Everything the view needs is gathered here, this is
 * the only place that names any of it, and the one reference to *this* file is a dynamic `import()`
 * — so it becomes a chunk of its own that a production build never fetches, and a development build
 * fetches on the first press of Schema Tests.
 *
 * That is also why the harness is no longer re-exported from `@shared/schemas`. A barrel export is a
 * static import by anything that touches the barrel, and relying on a bundler to shake an unused
 * re-export back out is exactly the kind of "it should be dropped" reasoning that put it in the
 * bundle in the first place.
 *
 * ## The cost, which is real and small
 *
 * Opening the view is now asynchronous, so it paints one frame later than it used to. For a
 * developer tool reached by a deliberate click that is not worth a moment's thought; the alternative
 * was every user downloading a test suite.
 */
import { schemaTestsTemplate } from '@shared/schemas/shell/SchemaTests.schema';
import { schemaMutationActions } from '@shared/schemas/shell/tests/SchemaMutations.actions';
import { createTestStore } from '@shared/schemas/shell/tests/testStore';
import { deepClone } from '@shared/utils';
import type { Stores } from '@solid/types';
import type { TemplateSchema } from '@we/schema-shared';
import { createStore } from 'solid-js/store';

import type { ShellViewEntry } from './shellViews';

/**
 * Returned rather than exported as a constant, so the store is built per open.
 *
 * The harness mutates its own schema to make schema mutations visible, so a second visit must start
 * from the declaration again rather than from wherever the last one left it.
 */
export function schemaTestsView(): ShellViewEntry {
  return {
    schema: schemaTestsTemplate,
    stores: (base: Stores) => {
      const [schemaState, setSchemaState] = createStore<TemplateSchema>(deepClone(schemaTestsTemplate));
      const mutations = schemaMutationActions(schemaState, setSchemaState);
      return {
        templateStore: { ...base.templateStore, ...mutations },
        testStore: createTestStore(
          base.datasetStore.testDataset,
          () => base.sessionStore.backendPorts()?.schemas ?? null,
        ),
        $schema: schemaState,
      };
    },
  };
}
