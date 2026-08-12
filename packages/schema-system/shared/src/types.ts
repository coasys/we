import type { RendererStores } from '@we/backend-shared';

// Pure framework-agnostic schema types
export type SchemaProp = string | number | boolean | Record<string, unknown> | SchemaProp[] | undefined;
export type StoreDeclaration = Record<string, true | { actions?: string[]; state?: string[] }>;
export type TemplateMeta = {
  name: string;
  description: string;
  icon: string;
  stores?: string[] | StoreDeclaration;
  components?: string[];
};
export type TemplateSchema = SchemaNode & {
  id?: string;
  author?: string;
  templateVersion?: number;
  schemaVersion?: number;
  meta: TemplateMeta;
  _fromSpace?: boolean;
};
export type RouteSchema = SchemaNode & { path: string; redirect?: string; keepAlive?: boolean };

/**
 * A single animation effect.
 * - 'fade'  — animates opacity only
 * - 'slide' — animates transform only (use alongside 'fade' for a combined slide+fade)
 * - 'scale' — animates transform (scale) only
 * - 'pulse' — a persistent looping CSS `@keyframes` animation (not a one-shot enter/exit
 *   transition like the others — fade/slide/scale interpolate between two static states,
 *   which a CSS `transition` already does natively; a loop needs real keyframes, defined
 *   in the DS interop stylesheet). Starts once entered, stops on exit. `direction`/
 *   `distance` don't apply.
 */
export type TransitionEffect = {
  type: 'fade' | 'slide' | 'scale' | 'pulse';
  duration?: number; // Milliseconds (default: 300; pulse default: 1200)
  easing?: string; // CSS easing function (default: 'ease'; pulse default: 'ease-in-out')
  delay?: number; // Milliseconds (default: 0)
  // slide / scale options
  direction?: 'left' | 'right' | 'up' | 'down'; // Slide direction (default: 'up')
  distance?: string; // Slide/scale distance (default: '40px' for slide, '0.95' for scale)
};

/**
 * One or more animation effects composed together.
 * Each effect independently controls its own CSS property and timing.
 *
 * Scroll triggers (scrollReveal / scrollLeave) are $animate node-level props,
 * not part of the transition config.
 *
 * @example Single effect
 * enterTransition: { type: 'fade', duration: 400 }
 *
 * @example Composed effects with independent timing
 * enterTransition: [
 *   { type: 'fade', duration: 400, easing: 'ease' },
 *   { type: 'slide', direction: 'left', distance: '60px', duration: 700, easing: 'ease-out' },
 * ]
 */
export type TransitionConfig = TransitionEffect | TransitionEffect[];

/**
 * Parametric theme overrides — the vocabulary lives in `@we/themes` (its owner: the keys map onto
 * design-system CSS custom properties). Re-exported here because schema nodes carry a `theme`.
 */
export type { ThemeOverrides, ThemeRole } from '@we/themes/presets';
import type { ThemeOverrides } from '@we/themes/presets';

export type SchemaNode = {
  id?: string; // Stable node identifier for ID-based patching (assigned by ensureNodeIds)
  type?: string; // Used to look up the node's component in the registry (if not included, children rendered in a fragment)
  props?: Record<string, SchemaProp>; // Props to pass to the component
  slots?: Record<string, SchemaNode>; // Named slots for components that support them
  slot?: string; // The name of the slot this node should be rendered into
  routes?: RouteSchema[]; // Routes for routing components
  children?: (SchemaNode | string | OperatorToken)[]; // Child nodes, text strings, or operator tokens ($concat, $store, etc.)
  theme?: ThemeOverrides; // Scoped theme overrides — applied as CSS custom properties on a display:contents wrapper
  styles?: Record<string, string | number>; // Raw CSS escape hatch — applied as inline styles on the node wrapper element
  $localState?: Record<string, LocalStateField>; // Scoped local state — creates signals on mount, discarded on unmount
  $queries?: Record<string, QueryStateField>; // Hoisted reactive query subscriptions — results injected into $local, shared across entire subtree
};

// Types that need to be passed a framework specific NodeType (e.g. JSX.Element for Solid, React.ReactNode for React)
export type ComponentRegistry<NodeType = unknown> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (props: any) => NodeType;
};

export type RenderProps<NodeType = unknown> = {
  node: SchemaNode | null;
  /**
   * The injected stores bag. Typed as the declared contract rather than `Record<string, unknown>`
   * so the bindings the renderer depends on are checked at the boundary: with a bare index
   * signature every read came back `unknown`, a truthiness guard narrowed that to `{}`, and each
   * call site had to re-assert the shape by hand — which meant the contract was documentation
   * nothing enforced, and could drift from what the renderer actually read.
   */
  stores: RendererStores;
  registry: ComponentRegistry<NodeType>;
  context?: Record<string, unknown>;
  children?: NodeType;
};

export type RendererOutput<NodeType = unknown> = NodeType | null;

// --- Operator Token Types ---
// Opt-in types for schema authors. SchemaProp remains `Record<string, unknown>` for Zod compatibility.

export type StoreToken = { $store: string };
export type ConcatToken = { $concat: unknown[] };
export type ActionToken = {
  $action: string;
  args?: unknown[];
  onSuccess?: unknown[];
  onError?: unknown[];
  onFinally?: unknown[];
};
export type IfToken = { $if: { condition: unknown; then: unknown; else?: unknown } };
export type MapToken = { $map: { items: unknown; select: Record<string, unknown> } };
export type PickToken = { $pick: { from: unknown; props: string[] } };
export type EqToken = { $eq: unknown[] };
export type NeToken = { $ne: unknown[] };
export type LtToken = { $lt: unknown[] };
export type GtToken = { $gt: unknown[] };
export type InToken = { $in: unknown[] };
export type NotToken = { $not: unknown };
export type AndToken = { $and: unknown[] };
export type OrToken = { $or: unknown[] };
export type FilterToken = { $filter: { items: unknown; where: Record<string, unknown> } };
export type CountToken = { $count: { items: unknown } };
export type FindToken = { $find: { items: unknown; where?: Record<string, unknown>; select?: string } };
export type PluralToken = { $plural: { count: unknown; one: string; other: string } };
export type QueryToken = {
  $query: {
    /** The entity to query (neutral). */
    entity: string;
    where?: Record<string, unknown>;
    order?: Record<string, unknown>;
    /**
     * A literal, or a token resolving to one — `{ $local: 'pageSize' }` is how a "load more"
     * button works, since raising the local re-runs the query with a bigger window. Params are
     * deep-resolved before the query is built, so a token here has always worked at runtime.
     */
    limit?: number | Record<string, unknown>;
    offset?: number | Record<string, unknown>;
    include?: Record<string, unknown>;
    /**
     * Neutral drill-down: fetch this entity's instances anchored to `anchorId` via the anchor entity's
     * `via` relation. The adapter resolves `via` to a backend handle (AD4M: → the relation's predicate).
     */
    scope?: { via: string; anchorId: string | number | Record<string, unknown>; anchor?: string };
    subscribe?: boolean;
    /** Store path to the dataset handle (e.g. '$currentDataset', 'testStore.perspective'). */
    dataset?: string;
  };
};

export type LocalStateField = {
  type: 'string' | 'boolean' | 'number' | 'file' | 'function' | 'object';
  /** Literal seed value, or any schema expression token (e.g. { $store: '...' }) evaluated once at mount. */
  initial: string | boolean | number | null | Record<string, unknown>;
  validate?: ValidationRule[];
  /**
   * Persist this field on the device (localStorage) under the given key, so it survives a
   * reload. For *preferences* — display density, collapsed rails — things a shared link should
   * NOT impose on its recipient. The key is explicit and global to the deployment
   * (`'cards.displayMode'`), so two views naming the same key deliberately share the setting;
   * pick namespaced names. The stored value wins over `initial` on mount; `$resetLocal` clears
   * it. Ignored for 'file' and 'function' fields, which have no JSON form.
   */
  persist?: string;
  /**
   * Mirror this field into a URL query parameter, so the view is shareable and survives a
   * reload as part of the address. For *view state* — selected content type, sort, filters:
   * what a link's recipient should see exactly as the sender does. A string names the param;
   * the object form adds `push: true` for changes that deserve a Back entry (content-type
   * switches; leave sort/filter changes on the default replace). Precedence on mount:
   * URL param > persisted value > `initial`; setting the field back to its initial removes
   * the param, keeping URLs clean. Requires the host to bind `$routeParams` (the app shell
   * does); degrades to plain local state elsewhere. See
   * docs/architecture/routing-and-view-state.md for which state belongs where.
   */
  syncParam?: string | { name: string; push?: boolean };
};

/**
 * The host's URL-query-parameter binding, injected into the stores bag as `$routeParams`.
 * What lets `$localState`'s `syncParam` read and write the URL without the renderer knowing
 * which router the host runs.
 */
export interface RouteParamsBinding {
  get(name: string): string | undefined;
  set(name: string, value: string | null, options?: { push?: boolean }): void;
}

/** A single entry in $queries — a reactive subscription hoisted to the node root. */
export type QueryStateField = QueryToken['$query'];

// --- Validation Rule Types ---

export type RequiredRule = { rule: 'required'; message?: string };
export type MinLengthRule = { rule: 'minLength'; value: number; message?: string };
export type MaxLengthRule = { rule: 'maxLength'; value: number; message?: string };
export type MinRule = { rule: 'min'; value: number; message?: string };
export type MaxRule = { rule: 'max'; value: number; message?: string };
export type PatternRule = { rule: 'pattern'; value: string; message?: string };
export type MatchRule = { rule: 'match'; field: string; message?: string };

export type ValidationRule = RequiredRule | MinLengthRule | MaxLengthRule | MinRule | MaxRule | PatternRule | MatchRule;

export type LocalToken = { $local: string };
export type SetLocalToken =
  | { $setLocal: string; from: string }
  | { $setLocal: string; value: unknown }
  | { $setLocal: string; merge: Record<string, unknown> }
  /** Add to a number field. The schema layer's only arithmetic — see `resolveSetLocalProp`. */
  | { $setLocal: string; by: number };
export type ErrorToken = { $error: string };
export type ValidToken = { $valid: string };
export type TouchedToken = { $touched: string };
export type FormValidToken = { $formValid: string };
export type TouchToken = { $touch: string };
export type ResetLocalToken = { $resetLocal: string };
export type ToggleLocalToken = { $toggleLocal: string };
export type CallLocalToken = { $callLocal: string };

/** Descriptor returned by the shared resolver — pure data, no framework effects */
export type QueryDescriptor = {
  entity: string;
  params: Record<string, unknown>;
  subscribe: boolean;
  dataset?: string;
  include?: Record<string, boolean | Record<string, unknown>>;
};

/** Union of all prop-level operator tokens */
export type OperatorToken =
  | StoreToken
  | ConcatToken
  | ActionToken
  | IfToken
  | MapToken
  | PickToken
  | EqToken
  | NeToken
  | LtToken
  | GtToken
  | InToken
  | NotToken
  | AndToken
  | OrToken
  | QueryToken
  | LocalToken
  | SetLocalToken
  | ErrorToken
  | ValidToken
  | TouchedToken
  | FormValidToken
  | TouchToken
  | ResetLocalToken
  | ToggleLocalToken
  | CallLocalToken
  | FilterToken
  | CountToken
  | FindToken
  | PluralToken;
