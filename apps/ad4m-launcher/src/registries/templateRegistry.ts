import { aiSampleTemplateSchema, defaultTemplateSchema, testTemplateSchema, twitterTemplateSchema } from '../schemas';

export const templateRegistry = {
  default: defaultTemplateSchema,
  twitter: twitterTemplateSchema,
  test: testTemplateSchema,
  aiSample: aiSampleTemplateSchema,
};

export type TemplateId = keyof typeof templateRegistry;

export function isValidTemplateId(key: unknown): key is TemplateId {
  return typeof key === 'string' && key in templateRegistry;
}
