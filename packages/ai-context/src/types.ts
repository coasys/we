/**
 * Re-export registry types from @we/schema-shared (the canonical owner).
 * ai-context consumes these types; schema-shared defines the contract.
 */
export type {
  PrimitiveEntry,
  ComponentEntry,
  PropEntry,
  ModelEntry,
  ModelFieldEntry,
  ModelRelationEntry,
  StateMemberMeta,
  StoreEntry,
  TokenCategory,
  ContextData,
  PluginCatalog,
  PluginEntry,
} from '@we/schema-shared';

import type { ContextData } from '@we/schema-shared';

/** The full assembled context (extends ContextData with text fragments for AI prompts) */
export interface AssembledContext extends ContextData {
  fragments: {
    schemaOperators: string;
    designSystemProps: string;
    routing: string;
    stores: string;
    storePatterns: string;
    /** Ready-made JSON shapes to copy — the recipes behind `@we/template-kit`. */
    patterns: string;
    rules: string;
  };
}
