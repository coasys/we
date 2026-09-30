/**
 * The built-in templates this build ships.
 *
 * A template is a UI schema the renderer walks — data, not code — so "built in" means only that it
 * was compiled into the bundle rather than installed from a space or the marketplace at runtime.
 *
 * ## Which templates are built in is a deployment's choice
 *
 * The set comes from `we-seed.json`'s `templates` list, through the generated
 * `bundledTemplates.generated.ts`. That file is written by
 * `pnpm --filter @we/app-shell generate-templates`, so a template the seed does not name is never
 * imported and never reaches the bundle.
 *
 * Generated rather than filtered here at runtime, and the difference is the point: filtering a
 * static map hides a template from the picker while still shipping every byte of it. A white-label
 * deployment that wants none of the showcase templates should not pay for them, and the seed is
 * already where a deployment says what it includes — `modules` has worked this way all along;
 * templates were the missing half.
 *
 * Before this, the registry was a hardcoded object with one live entry and a commented-out second
 * one, which is what happens when the only way to add a template is to impose it on everybody.
 *
 * The `launcher` template is different: it is *generated from the seed* at boot rather than
 * selected from a set, since it encodes platform-aware URLs the build cannot know.
 *
 * Initialization flow:
 * 1. Module loads → the generated bundled set is available
 * 2. PlatformProvider mounts → calls initializeIntegrations(adapter)
 * 3. Seed file loaded and validated
 * 4. Launcher template generated from the seed with platform-aware URL resolution
 * 5. TemplateStoreProvider reads the registry
 */
import { bundledTemplates } from './bundledTemplates.generated';

export const templateRegistry = bundledTemplates;

export type TemplateId = keyof typeof templateRegistry;

export function isValidTemplateId(key: unknown): key is TemplateId {
  return typeof key === 'string' && key in templateRegistry;
}
