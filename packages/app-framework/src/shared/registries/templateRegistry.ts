import {
  aiSampleTemplateSchema,
  defaultTemplateSchema,
  launcherTemplate,
  testTemplateSchema,
  twitterTemplateSchema,
} from '@shared/schemas';

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
