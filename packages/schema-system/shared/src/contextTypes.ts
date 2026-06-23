/**
 * Types describing the component/model/store registry used for schema validation.
 *
 * These types define the contract that any context provider (e.g. @we/ai-context)
 * must conform to. They are consumed by `buildValidationContext()` and serialized
 * as `context.json` for offline use by the CLI.
 */

/** A primitive web component extracted from CEM */
export interface PrimitiveEntry {
  tagName: string;
  className: string;
  description?: string;
  superclass?: string;
  ownProps: PropEntry[];
}

/** A component or widget extracted from *.types.ts */
export interface ComponentEntry {
  name: string;
  description?: string;
  superclass?: string;
  props: PropEntry[];
  source: 'components' | 'widgets';
}

export interface PropEntry {
  name: string;
  type: string;
  optional: boolean;
  default?: string;
}

/** A block or entity model from @we/models */
export interface ModelEntry {
  name: string;
  className: string;
  extends?: string;
  fields: ModelFieldEntry[];
  relations: ModelRelationEntry[];
}

export interface ModelFieldEntry {
  name: string;
  type: string;
  predicate: string;
  required: boolean;
  default?: string;
}

export interface ModelRelationEntry {
  name: string;
  kind: 'HasMany' | 'HasOne';
  predicate: string;
  target?: string;
}

/** Type metadata for a store state member, enabling nested property validation */
export interface StateMemberMeta {
  type: 'array' | 'object' | 'string' | 'boolean' | 'number';
  /** Known properties on the value (for objects) or on array items (for arrays) */
  properties?: string[];
}

/** A store with its state properties and action methods */
export interface StoreEntry {
  name: string;
  state: Record<string, StateMemberMeta>;
  actions: string[];
}

/** A token category (e.g. space, color, size) */
export interface TokenCategory {
  name: string;
  type?: string;
  values: Record<string, string>;
}

/**
 * The structured data needed for schema validation.
 * Serialized as `context.json` by @we/ai-context at build time.
 */
export interface ContextData {
  primitives: PrimitiveEntry[];
  components: ComponentEntry[];
  models: ModelEntry[];
  tokens: TokenCategory[];
  storeEntries: StoreEntry[];
  /** Shell/internal component names known to the validator but excluded from AI docs. */
  shellComponents?: string[];
}

/** A partial context fragment that a single package exports at build time */
export type ContextFragment = Partial<ContextData>;
