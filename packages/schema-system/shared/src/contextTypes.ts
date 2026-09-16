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

/** A block or entity model from @we/entities */
export interface EntityEntry {
  name: string;
  className: string;
  extends?: string;
  fields: EntityFieldEntry[];
  relations: EntityRelationEntry[];
}

export interface EntityFieldEntry {
  name: string;
  type: string;
  predicate: string;
  required: boolean;
  default?: string;
}

export interface EntityRelationEntry {
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
  /**
   * The model this member holds instances of, when it holds model instances.
   * Preferred over spelling out `properties` by hand: the model's fields are generated
   * from `@we/entities`, so they stay complete as the model changes. Consumers union both.
   */
  model?: string;
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
 * One entry in a component's own plugin registry — a graph expander, a layout, a behaviour.
 *
 * Components with a sub-registry are otherwise invisible to schema authoring: their props document
 * that a `layout.type` is a string, and nothing says which strings exist. The globe demonstrated the
 * failure mode — its layer system is well-designed, and an LLM cannot author a globe template
 * because no catalog of layer names ever reaches the context. A component that resolves plugins by
 * name declares them here so the names are as documented as the props are.
 */
export interface PluginEntry {
  /** The string a schema writes. */
  id: string;
  /** Which slot it plugs into — `layout`, `expander`, `seed`, `behaviour`, `metric`, … */
  category: string;
  description?: string;
  /** Option names with a short note each, since options are free-form JSON. */
  options?: { name: string; type: string; description?: string }[];
  /** One worked snippet. Worth more than the option list for composing from. */
  example?: string;
}

/** A component's plugin registry, as documented for schema authors. */
export interface PluginCatalog {
  /** The component whose props these names appear in. */
  component: string;
  description?: string;
  plugins: PluginEntry[];
}

/**
 * The structured data needed for schema validation.
 * Serialized as `context.json` by @we/ai-context at build time.
 */
export interface ContextData {
  primitives: PrimitiveEntry[];
  components: ComponentEntry[];
  models: EntityEntry[];
  tokens: TokenCategory[];
  storeEntries: StoreEntry[];
  /** Shell/internal component names known to the validator but excluded from AI docs. */
  shellComponents?: string[];
  /** Sub-registries a component resolves by name — see {@link PluginCatalog}. */
  pluginCatalogs?: PluginCatalog[];
  /** Functions the host lends to expressions beyond the built-in library — see {@link SourceEntry}. */
  sources?: SourceEntry[];
  /**
   * The feature modules this deployment ships, and everything a schema may name of each — see
   * {@link ModuleCatalogEntry}. Absent when the context was built without a seed, in which case
   * `modules.*` references are admitted unchecked, as they always were.
   */
  modules?: ModuleCatalogEntry[];
  /**
   * Custom elements from libraries this deployment bundles, which a schema may name — see
   * {@link ForeignElementEntry}. Absent or empty when the seed names none.
   */
  foreignElements?: ForeignElementEntry[];
}

/**
 * A custom element a deployment's seed allows, read from its package's custom-elements manifest.
 *
 * Not a primitive: it takes none of the design-system props, since it is not built on the base
 * classes that apply them, and its events are whatever its library named them — hence `events`, so
 * a reference can say `on:sl-change` rather than leave an author to guess `onSlChange`.
 */
export interface ForeignElementEntry {
  tagName: string;
  /** The package it comes from. */
  package: string;
  description?: string;
  props: PropEntry[];
  /** The events it dispatches, by their exact names. */
  events: string[];
}

/**
 * One feature module, as a schema author sees it.
 *
 * Everything here used to be invisible to both the validator and the generated reference: a module's
 * store members, its parts, its panel names, its settings keys, the components it contributes and
 * the functions it lends. So `modules.transcribe.typo` validated clean and rendered nothing, and an
 * LLM writing a template could not author against any module at all. This is the catalogue — read
 * off the definitions the seed names, so it cannot drift from what registers.
 */
export interface ModuleCatalogEntry {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  scope: 'space' | 'agent';
  /** What it needs from a host — its manifest's `requires`. */
  requires: { backends?: string[]; frameworks?: string[]; kernels?: string[]; permissions?: string[] };
  /** What a person agrees to, derived. */
  capabilities: string[];
  /** The store's public members — `modules.<id>.<name>` — with what each is and means. */
  members: { name: string; kind: 'state' | 'action'; doc: string }[];
  /** Fragments a template may place with `$part` as `<id>.<name>`. */
  parts: { name: string; subject?: string }[];
  /** Panels, by the name `meta.panels[].dock` addresses. */
  panels: { name: string; title: string; icon?: string; hostOwned: boolean }[];
  /** Rail entries that are not a panel's. */
  launchers: { key: string; label: string }[];
  settings: { key: string; label: string; description?: string; type: string; levels: string[] }[];
  /** Presence activity shapes, by type. */
  activities: Record<string, Record<string, string>>;
  /** Framework components, by the name a template mounts them under. */
  components: string[];
  /** Functions lent to expressions — listed with the host's own. */
  functions: SourceEntry[];
  /** Sections a space may enable. */
  views: { id: string; name: string; segment?: string }[];
  /** Content types, by the `_type` a composed block carries. */
  blocks: { entity: string; nodeType: string; card: string }[];
  /** Entities the module declares — queryable like any core model. */
  entities: EntityEntry[];
}

/**
 * A host-registered function — what `$source` reaches by name and an expression calls directly.
 *
 * Catalogued for the same reason a plugin is: a name that is not in the generated context is one an
 * author has to already know. The validator reads the same list, so a call to a registered source
 * is accepted and a typo in one is reported.
 */
export interface SourceEntry {
  name: string;
  /** Parameter names in the library's notation — `?` for optional. */
  params: string[];
  doc: string;
  example: string;
}

/** A partial context fragment that a single package exports at build time */
export type ContextFragment = Partial<ContextData>;
