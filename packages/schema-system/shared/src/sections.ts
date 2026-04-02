/**
 * Section API
 *
 * High-level operations on StoredTemplate objects.
 * Composes the lower-level indexer utilities (extractByPath, patchByPath)
 * into a key-based API so consumers never deal with raw path arrays.
 */

import type { SectionEntry, StoredTemplate } from './indexer';
import { computeSectionIndex, extractByPath, patchByPath } from './indexer';
import type { SchemaNode, TemplateSchema } from './types';

/**
 * Create a StoredTemplate from a raw TemplateSchema.
 * Computes the section index and bundles it with the schema.
 */
export function createStoredTemplate(schema: TemplateSchema): StoredTemplate {
  return { schema, sections: computeSectionIndex(schema) };
}

/**
 * Get the list of sections in a stored template.
 */
export function listSections(template: StoredTemplate): SectionEntry[] {
  return template.sections;
}

/**
 * Get a section's content by key.
 * Returns null if the section key doesn't exist or the path is invalid.
 */
export function getSection(template: StoredTemplate, key: string): SchemaNode | null {
  const entry = template.sections.find((s) => s.key === key);
  if (!entry) return null;
  return extractByPath(template.schema, entry.path);
}

/**
 * Update a section's content by key.
 * Returns a new StoredTemplate with the section replaced.
 *
 * @param reindex - Whether to recompute the section index. Default true.
 *   Set to false for prop-only changes that don't alter tree structure.
 */
export function updateSection(
  template: StoredTemplate,
  key: string,
  content: SchemaNode,
  reindex = true,
): StoredTemplate {
  const entry = template.sections.find((s) => s.key === key);
  if (!entry) throw new Error(`Section "${key}" not found in template`);

  const newSchema = patchByPath(template.schema, entry.path, content) as TemplateSchema;

  if (reindex) {
    return { schema: newSchema, sections: computeSectionIndex(newSchema) };
  }

  // Update only the size estimate for the changed section
  const newSections = template.sections.map((s) =>
    s.key === key ? { ...s, sizeEstimate: JSON.stringify(content).length } : s,
  );
  return { schema: newSchema, sections: newSections };
}
