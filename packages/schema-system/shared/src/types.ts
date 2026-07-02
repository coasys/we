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

/** Parametric theme overrides — each field maps to a CSS custom property on the design system. */
export type ThemeOverrides = {
  // Named preset
  themeName?: string; // Named theme preset (e.g. 'dark', 'cyberpunk', 'retro') — sets data-we-theme attribute

  // Color
  primaryHue?: number; // --we-color-primary-hue
  successHue?: number; // --we-color-success-hue
  warningHue?: number; // --we-color-warning-hue
  dangerHue?: number; // --we-color-danger-hue
  neutralHue?: number; // --we-color-neutral-hue
  saturation?: string; // --we-color-saturation  (e.g. "50%")
  neutralSaturation?: string; // --we-color-neutral-saturation
  multiplier?: number; // --we-color-multiplier
  subtractor?: string; // --we-color-subtractor  (e.g. "108%")
  ringColor?: string; // --we-ring-color  (focus ring / accent color)

  // Typography
  fontFamily?: string; // --we-font-family
  letterSpacing?: string; // --we-theme-letter-spacing  (e.g. "0.05em" for airy headlines)
  lineHeight?: string; // --we-theme-line-height  (e.g. "1.5" or "relaxed")
  fontScale?: number; // scales root font-size (1 = 100%, 1.125 = 112.5%) — affects all rem-based tokens

  // Shape — radius cascade: component r= prop → component theme → group theme → token default
  controlRadius?: string; // --we-theme-control-radius  (buttons, badges, tags)
  surfaceRadius?: string; // --we-theme-surface-radius  (modals, drawers, alerts)
  inputRadius?: string; // --we-theme-input-radius  (inputs, selects, textareas)

  // Density — padding/gap cascade: component p=/gap= prop → component theme → group theme → size default
  controlPaddingX?: string; // --we-theme-control-padding-x  (button / badge / tag horizontal padding)
  controlGap?: string; // --we-theme-control-gap  (button / badge internal icon-text gap)
  controlHeight?: string; // --we-theme-control-height-offset  (px offset added to all fixed-height controls, e.g. '4px', '-4px')
  surfaceSpacing?: string; // --we-theme-surface-spacing  (card / modal / drawer padding)
  surfaceGap?: string; // --we-theme-surface-gap  (card / modal / drawer child gap)

  // Effects
  shadowIntensity?: 'flat' | 'subtle' | 'elevated' | 'dramatic'; // maps to --we-theme-shadow-preset
  surfaceOpacity?: number; // --we-theme-surface-opacity  (0–1, background alpha for surfaces)
  surfaceBlur?: number; // --we-theme-surface-blur  (px, backdrop-filter blur for frosted glass)

  // Motion
  animationSpeed?: 'none' | 'fast' | 'normal' | 'slow'; // maps to --we-theme-animation-speed-preset
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
    model: string;
    where?: Record<string, unknown>;
    order?: Record<string, unknown>;
    limit?: number;
    offset?: number;
    include?: Record<string, unknown>;
    parent?: Record<string, unknown>;
    subscribe?: boolean;
    /** Store path to resolve perspective from (e.g. 'testStore.perspective'). Defaults to adamStore.currentPerspective. */
    perspective?: string;
  };
};

export type LocalStateField = {
  type: 'string' | 'boolean' | 'number' | 'file' | 'function' | 'object';
  /** Literal seed value, or any schema expression token (e.g. { $store: '...' }) evaluated once at mount. */
  initial: string | boolean | number | null | Record<string, unknown>;
  validate?: ValidationRule[];
};

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
  | { $setLocal: string; merge: Record<string, unknown> };
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
  model: string;
  params: Record<string, unknown>;
  subscribe: boolean;
  perspective?: string;
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
