/** A primitive web component from CEM */
export interface PrimitiveEntry {
  tagName: string;
  className: string;
  description?: string;
  ownProps: PropEntry[];
}

/** A component or widget from *.types.ts */
export interface ComponentEntry {
  name: string;
  description?: string;
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

/** A token category (e.g. space, color, size) */
export interface TokenCategory {
  name: string;
  type?: string;
  values: Record<string, string>;
}

/** The full assembled context */
export interface AssembledContext {
  primitives: PrimitiveEntry[];
  components: ComponentEntry[];
  models: ModelEntry[];
  tokens: TokenCategory[];
  fragments: {
    schemaOperators: string;
    designSystemProps: string;
    routing: string;
    stores: string;
    storePatterns: string;
    rules: string;
  };
}
