/**
 * The flat, per-entity manifest form — richer than the neutral `ModelManifest` (it carries the
 * storage binding: predicate, resolveLanguage, related model) but still backend-agnostic in
 * shape. The AD4M adapter builds these from SHACL; `toNeutralManifest` projects them onto the
 * neutral form; the AI layer formats them into prompts.
 */
export type ModelManifestProperty = {
  name: string;
  predicate: string;
  type: 'string' | 'number' | 'boolean' | 'uri';
  isCollection: boolean;
  required: boolean;
  writable: boolean;
  resolveLanguage?: string;
  relatedModel?: string;
};

export type ModelManifestEntry = {
  name: string;
  targetClass: string;
  properties: ModelManifestProperty[];
};
