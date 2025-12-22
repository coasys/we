import {
  aiSampleTemplateSchema,
  defaultTemplateSchema,
  testTemplateSchema,
  twitterTemplateSchema,
} from '@shared/schemas';
import type { TemplateSchema } from '@we/schema-renderer/shared';

// Placeholder launcher - will be replaced by seed-generated launcher
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

// Initialize with default templates
export const templateRegistry = {
  default: defaultTemplateSchema,
  twitter: twitterTemplateSchema,
  test: testTemplateSchema,
  aiSample: aiSampleTemplateSchema,
  launcher: placeholderLauncher, // Will be replaced by seed system
};

export type TemplateId = keyof typeof templateRegistry;

export function isValidTemplateId(key: unknown): key is TemplateId {
  return typeof key === 'string' && key in templateRegistry;
}

// Initialize integrations (will replace launcher if workspace/fallback seed is available)
// This runs at module load time, before TemplateStoreProvider reads the registry
import { initializeIntegrations } from '../initializeIntegrations';

// Call synchronous initialization
initializeIntegrations();
