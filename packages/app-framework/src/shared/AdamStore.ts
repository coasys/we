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
