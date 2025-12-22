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
 * 2. initializeIntegrations() called synchronously
 * 3. Seed file loaded and validated
 * 4. Launcher template generated from seed
 * 5. Placeholder replaced with seed-generated launcher
 * 6. TemplateStoreProvider reads registry (gets final launcher)
 */

import {
  aiSampleTemplateSchema,
  defaultTemplateSchema,
  testTemplateSchema,
  twitterTemplateSchema,
} from '@shared/schemas';
import type { TemplateSchema } from '@we/schema-renderer/shared';

/**
 * Placeholder launcher shown during initialization
 * 
 * This is immediately replaced by the seed-generated launcher before
 * the template store reads the registry. Users should never see this.
 */
const placeholderLauncher: TemplateSchema = {
  meta: { name: 'Loading...', description: 'Initializing launcher', icon: 'rocket-launch' },
  type: 'Column',
  props: { width: '100%', height: '100%' },
  children: [
    {
      type: 'we-text',
      props: { text: 'Initializing...', size: 'xl' },
    },
  ],
};

/**
 * Template Registry
 * 
 * All available templates indexed by ID.
 * The 'launcher' template is generated from we-seed.json.
 */
export const templateRegistry = {
  default: defaultTemplateSchema,
  twitter: twitterTemplateSchema,
  test: testTemplateSchema,
  aiSample: aiSampleTemplateSchema,
  launcher: placeholderLauncher, // Replaced by seed system during initialization
};

export type TemplateId = keyof typeof templateRegistry;

export function isValidTemplateId(key: unknown): key is TemplateId {
  return typeof key === 'string' && key in templateRegistry;
}

// Initialize seed system (replaces placeholder launcher with seed-generated launcher)
// Must run synchronously at module load time, before TemplateStoreProvider reads registry
import { initializeIntegrations } from '../initializeIntegrations';
initializeIntegrations();
