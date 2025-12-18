import {
  aiSampleTemplateSchema,
  defaultTemplateSchema,
  launcherTemplate,
  testTemplateSchema,
  twitterTemplateSchema,
} from '@shared/schemas';

// Initialize with default templates
export const templateRegistry = {
  default: defaultTemplateSchema,
  twitter: twitterTemplateSchema,
  test: testTemplateSchema,
  aiSample: aiSampleTemplateSchema,
  launcher: launcherTemplate,
};

export type TemplateId = keyof typeof templateRegistry;

export function isValidTemplateId(key: unknown): key is TemplateId {
  return typeof key === 'string' && key in templateRegistry;
}

// Initialize integrations (will replace launcher if workspace/fallback seed is available)
// This runs at module load time, before TemplateStoreProvider reads the registry
import { initializeIntegrations } from '../initializeIntegrations';

// Call async initialization immediately (fire-and-forget)
// The launcher will be updated once the seed is loaded
initializeIntegrations().catch((error) => {
  console.error('Failed to initialize integrations:', error);
});
