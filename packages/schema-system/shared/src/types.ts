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
export type TemplateSchema = SchemaNode & { id?: string; schemaVersion?: number; meta: TemplateMeta };
export type RouteSchema = SchemaNode & { path: string; redirect?: string };

// Transition configuration for $if operator (can be used in props via prop resolution)
export type TransitionConfig = {
  type: 'fade' | 'slide' | 'scale';
  duration?: number; // Milliseconds (default: 300)
  easing?: string; // CSS easing function (default: 'ease')
  delay?: number; // Milliseconds (default: 0)
};

/** Parametric theme overrides — each field maps to a CSS custom property on the design system. */
export type ThemeOverrides = {
  themeName?: string; // Named theme preset (e.g. 'dark', 'cyberpunk', 'retro') — sets data-we-theme attribute
  primaryHue?: number; // --we-color-primary-hue
  successHue?: number; // --we-color-success-hue
  warningHue?: number; // --we-color-warning-hue
  dangerHue?: number; // --we-color-danger-hue
  neutralHue?: number; // --we-color-neutral-hue
  saturation?: string; // --we-color-saturation  (e.g. "50%")
  neutralSaturation?: string; // --we-color-neutral-saturation
  multiplier?: number; // --we-color-multiplier
  subtractor?: string; // --we-color-subtractor  (e.g. "108%")
  fontFamily?: string; // --we-font-family
};

export type SchemaNode = {
  id?: string; // Stable node identifier for ID-based patching (assigned by ensureNodeIds)
  type?: string; // Used to look up the node's component in the registry (if not included, children rendered in a fragment)
  props?: Record<string, SchemaProp>; // Props to pass to the component
  slots?: Record<string, SchemaNode>; // Named slots for components that support them
  slot?: string; // The name of the slot this node should be rendered into
  routes?: RouteSchema[]; // Routes for routing components
  children?: (SchemaNode | string | OperatorToken)[]; // Child nodes, text strings, or operator tokens ($concat, $store, etc.)
  theme?: ThemeOverrides; // Scoped theme overrides — applied as CSS custom properties on a display:contents wrapper
  $localState?: Record<string, LocalStateField>; // Scoped local state — creates signals on mount, discarded on unmount
};

// Types that need to be passed a framework specific NodeType (e.g. JSX.Element for Solid, React.ReactNode for React)
export type ComponentRegistry<NodeType = unknown> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (props: any) => NodeType;
};

export type RenderProps<NodeType = unknown> = {
  node: SchemaNode | null;
  stores: Record<string, unknown>;
  registry: ComponentRegistry<NodeType>;
  context?: Record<string, unknown>;
  children?: NodeType;
};

export type RendererOutput<NodeType = unknown> = NodeType | null;

// --- Operator Token Types ---
// Opt-in types for schema authors. SchemaProp remains `Record<string, unknown>` for Zod compatibility.

export type StoreToken = { $store: string };
export type ConcatToken = { $concat: unknown[] };
export type ActionToken = { $action: string; args?: unknown[] };
export type IfToken = { $if: { condition: unknown; then: unknown; else?: unknown } };
export type MapToken = { $map: { items: unknown; select: Record<string, unknown> } };
export type PickToken = { $pick: { from: unknown; props: string[] } };
export type EqToken = { $eq: unknown[] };
export type NeToken = { $ne: unknown[] };
export type LtToken = { $lt: unknown[] };
export type GtToken = { $gt: unknown[] };
export type NotToken = { $not: unknown };
export type AndToken = { $and: unknown[] };
export type OrToken = { $or: unknown[] };
export type QueryToken = {
  $query: {
    model: string;
    where?: Record<string, unknown>;
    order?: Record<string, unknown>;
    limit?: number;
    offset?: number;
    include?: Record<string, unknown>;
    parent?: Record<string, unknown>;
    subscribe?: boolean;
    /** Store path to resolve perspective from (e.g. 'testStore.perspective'). Defaults to spaceStore.perspective. */
    perspectiveStore?: string;
  };
};

export type LocalStateField = {
  type: 'string' | 'boolean' | 'number' | 'file';
  initial: string | boolean | number | null;
  validate?: ValidationRule[];
};

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
export type SetLocalToken = { $setLocal: string; from: string } | { $setLocal: string; value: unknown };
export type ErrorToken = { $error: string };
export type ValidToken = { $valid: string };
export type TouchedToken = { $touched: string };
export type FormValidToken = { $formValid: string };
export type TouchToken = { $touch: string };
export type ResetLocalToken = { $resetLocal: string };
export type ToggleLocalToken = { $toggleLocal: string };

/** Descriptor returned by the shared resolver — pure data, no framework effects */
export type QueryDescriptor = {
  model: string;
  params: Record<string, unknown>;
  subscribe: boolean;
  perspectiveStore?: string;
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
  | ToggleLocalToken;
