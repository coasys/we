/**
 * Template Registry
 *
 * Central registry of all available templates in the application.
 *
 * Templates are UI structures that can be rendered by the schema renderer.
 * The 'launcher' template is special - it defines the root application layout
 * and is generated from the we-seed.json file at initialization.
 *
 * Initialization Flow:
 * 1. Module loads → placeholder launcher created
 * 2. PlatformProvider mounts → calls initializeIntegrations(adapter)
 * 3. Seed file loaded and validated
 * 4. Launcher template generated from seed with platform-aware URL resolution
 * 5. Placeholder replaced with seed-generated launcher
 * 6. TemplateStoreProvider reads registry (gets final launcher)
 */

import {
  integrationTestsTemplate,
  schemaMutationsTemplate,
  twitterTemplate,
  weTemplate,
} from '@shared/schemas';
// import type { TemplateSchema } from '@we/schema-shared';

/**
 * Placeholder launcher shown during initialization
 *
 * This is replaced by the seed-generated launcher when PlatformProvider
 * calls initializeIntegrations(). Users may briefly see this on first load.
 */
// const placeholderLauncher: TemplateSchema = {
//   meta: { name: 'Loading...', description: 'Initializing launcher', icon: 'rocket-launch' },
//   type: 'Column',
//   props: { width: '100%', height: '100%' },
//   children: [
//     {
//       type: 'we-text',
//       props: { text: 'Initializing...', size: 'xl' },
//     },
//   ],
// };

/**
 * Template Registry
 *
 * All available templates indexed by ID.
 * The 'launcher' template is generated from we-seed.json.
 */
export const templateRegistry = {
  we: weTemplate,
  twitter: twitterTemplate,
  'integration-tests': integrationTestsTemplate,
  'schema-mutations': schemaMutationsTemplate,
  // launcher: placeholderLauncher, // Replaced by seed system when PlatformProvider initializes
};

export type TemplateId = keyof typeof templateRegistry;

export function isValidTemplateId(key: unknown): key is TemplateId {
  return typeof key === 'string' && key in templateRegistry;
}
