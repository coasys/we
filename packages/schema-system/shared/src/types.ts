import type { RendererStores } from '@we/backend-shared';

// Pure framework-agnostic schema types
export type SchemaProp = string | number | boolean | Record<string, unknown> | SchemaProp[] | undefined;
export type StoreDeclaration = Record<string, true | { actions?: string[]; state?: string[] }>;
/**
 * A panel this interface has, and where it starts.
 *
 * Two things in one list, because from a template's side they are one question — "what panels does
 * this interface have" — and splitting them would mean two declarations that could disagree about
 * the same edge:
 *
 * - **`module`** places a panel some module already contributes. The template decides where it
 *   opens; the module still owns what is in it and whether it is open.
 * - **`node`** supplies the content itself. The shell owns the frame and the open flag, because
 *   there is no module to own them.
 *
 * Named positions only, never pixels — the same reason `DockSize` is a name. A template cannot see
 * the viewport, and a pixel it guessed would be wrong on a display it never ran on.
 */
export type TemplatePanel = {
  /**
   * Stable, and the author's to choose.
   *
   * Placements are remembered per panel id, so an id that changed when the list was reordered would
   * throw away wherever somebody had dragged it. Generated indices were the alternative and have
   * exactly that failure.
   */
  id: string;
  /** The module whose panel this places. Mutually exclusive with `node`. */
  module?: string;
  /**
   * Which of that module's panels, where it contributes more than one — its declared `name`.
   *
   * Unnecessary for a module with a single panel, which is most of them: the host resolves the name
   * to that one dock. A module with several has no default worth guessing — supplying a transcript
   * body into a settings panel is a silent wrong answer — so the host refuses and says so until an
   * entry names one.
   */
  dock?: string;
  /** The panel's content, for a panel the template supplies. Mutually exclusive with `module`. */
  node?: SchemaNode;
  /** Shown in the titlebar. Only meaningful with `node`; a module's panel names itself. */
  title?: string;
  /** Which of the eight positions it opens at. */
  snap?: 'top-left' | 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left';
  /** Where it sits *along* the edge among the panels sharing its lane — lower is nearer the start. */
  order?: number;
  /**
   * Which lane it is in, counting inward from the edge — 0 is against the edge.
   *
   * The second of an edge's two coordinates: `band` is how far in, `order` is where along. Two panels
   * that name the same band share one lane and divide the edge between them; a panel that names none
   * gets a lane of its own.
   *
   * Only meaningful with `displace`. A floating panel takes no room, so there is nothing for it to be
   * inboard of — every float on an edge already shares one lane, which is the column `order` divides.
   *
   * "Two sidebars down the left, one above the other, both pushing the content aside" is what this
   * makes sayable, and it was unreachable before: whether panels stacked inward or divided the edge
   * was decided by `displace`, which is a question about taking room and not about position.
   */
  band?: number;
  /** How much room it asks for. Resolved against the viewport by the host. */
  size?: 'sm' | 'md' | 'lg' | 'full';
  /**
   * Its share of the spare room in a floating column, relative to its neighbours. Absent means 1.
   *
   * "The transcript takes most of the height, the panel under it does not" is a large panel with
   * grow and a small one with `grow: 0`.
   */
  grow?: number;
  /** Push the content aside rather than covering it. Honoured on an edge snap only. */
  displace?: boolean;
  /**
   * Only while one of these segments is in the path. Absent means every route.
   *
   * What makes a layout change as somebody moves between sections — a graph wants a transcript
   * beside it and a task list does not. A section that declares its own `meta.panels` needs none of
   * this; `route` is for a shell that routes itself, which is how every showcase template works and
   * which has no sections to hang a declaration on.
   *
   * A list because "these two pages, not the third" is an ordinary thing to want and a single
   * segment could not say it. The alternative people reached for — the same `id` declared twice with
   * different routes — happens to work, since exactly one survives the filter and the dock id is
   * stable, but it is one panel written down twice for the two to disagree about later.
   *
   * It says *whether*, never *where*. A panel that moved from one route to the next would work
   * until the reader dragged it once: a stored placement is keyed by template and panel, not by
   * route, and it outranks every declaration — so per-route positions would silently stop applying
   * the first time somebody used the panel. Where a page genuinely needs its own arrangement, it
   * wants to be a **view** with its own `meta.panels`.
   */
  route?: string | string[];
  /**
   * Whether to open the panel as well as place it. Absent means yes.
   *
   * Opening a module's panel means invoking the action its launcher declares, and that action is not
   * always "open a panel": the call module's is `goToCall`, which **joins a call** when there is not
   * one. A template that placed the call window would therefore start a call on entering the space.
   *
   * So a declaration can place without opening. The panel appears where the template asked for it
   * *if* the module opens it, and the template never reaches for the module's own verb.
   */
  open?: boolean;
};

export type TemplateMeta = {
  name: string;
  description: string;
  icon: string;
  /**
   * A theme this template is designed to be seen in — a **suggestion**, never a setting.
   *
   * Resolved rather than written: it takes effect as a rung in the theme chain, so switching
   * template changes the look without overwriting anyone's choice, and switching back restores what
   * was there. See `spaceStore`'s theme resolution for the precedence, which turns on *who chose the
   * template* rather than on layer: a theme picked alongside a template stops applying once someone
   * overrides that template, because it was a decision about a different interface.
   *
   * Lives in `meta` rather than only on the `Template` model because built-in templates have no
   * model record — they are schemas in the registry — and because here it travels with a fork, a
   * publish and a `?template=` link. `Template.themeId` is the queryable mirror `saveTemplate`
   * writes.
   *
   * Honoured only when the theme resolves for this agent; a suggestion naming something they have
   * not installed is reported once and ignored, exactly as `?theme=` in a share link is.
   */
  themeId?: string;
  /**
   * What this template *is* — a whole interface, or one section inside one.
   *
   * A `'shell'` (the default, and what every template was before this existed) owns the space's
   * chrome, its route table and the arrangement everything sits in. A `'view'` owns a single
   * section: it renders at one segment under the shell's `$views` marker, and knows nothing about
   * what surrounds it.
   *
   * The distinction earns its place because it decides what a fork costs. A community that wants a
   * seventh section used to fork the whole shell and drift from upstream forever; with views, the
   * section is the unit — they install one, or write one, and the shell they share with everybody
   * else keeps improving underneath them.
   *
   * Optional and defaulted rather than required, so every template that predates this keeps working
   * unchanged and unannotated: absent means shell, which is what they all are.
   */
  role?: 'shell' | 'view';
  /**
   * For a `'view'`: the URL segment it renders at, and the identity a space enables or disables it
   * by. Ignored on a shell.
   *
   * The template's own suggestion, not a fixed address — a space's section list pairs a segment
   * with a view id, so two views can offer the same default segment and a community can put either
   * one at `/cards` without either template knowing. What it must be is *stable*: it is in the URL,
   * so changing it breaks every link anyone has shared.
   */
  segment?: string;
  /**
   * For a `'view'`: keep this section mounted when the user navigates to a sibling, rather than
   * unmounting it. Becomes the route's `keepAlive`. Ignored on a shell.
   *
   * The expensive-to-rebuild case, and it is narrower than it looks — a Cesium globe, a live map, a
   * running WebGL scene. Ordinary sections should not set it: a kept-alive view holds its
   * subscriptions open for as long as the space is, which is the cost that buys the instant return.
   */
  keepAlive?: boolean;
  /**
   * Fixed chrome this shell paints over the content, for floating panels to keep clear of.
   *
   * A template that pins a nav strip or a toolbar has the same problem a module's call bar does: a
   * panel snapped to that corner opens underneath it. Modules answer it with `chromeReserve` on
   * their store; a template is data and has no store, so it declares the box here and the host folds
   * it into the same sum.
   *
   * Report the height it has when **collapsed**, exactly as a module must. Chrome that grows as
   * somebody opens a disclosure would otherwise shove a floating panel down the screen mid-read.
   *
   * Structurally the same shape as `ChromeReserve` in `@we/module-shared`, restated rather than
   * imported: schema types are the layer modules point *at*, so naming a module type here would be
   * an edge pointing the wrong way.
   */
  chromeReserve?: { top?: number; bottom?: number; width?: number };
  /**
   * The panels this interface has, and where each one starts. See {@link TemplatePanel}.
   *
   * A **suggestion**, resolved live and never written — the same rung `themeId` occupies. A drag
   * beats it and is remembered per panel; the panel's own menu offers the way back. So switching
   * template or view is non-destructive, and an author improving a layout is not overruled by a
   * stray drag somebody made once.
   */
  panels?: TemplatePanel[];
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
 * - 'reveal' — animates the element open to the size its content actually wants, and closed
 *   again. The size axis the other three deliberately lack: fade and slide/scale move paint,
 *   this one moves the box. Use it for anything that opens in place — a disclosure, an
 *   accordion, a sidebar label appearing as the rail expands.
 * - 'pulse' — a persistent looping CSS `@keyframes` animation (not a one-shot enter/exit
 *   transition like the others — fade/slide/scale interpolate between two static states,
 *   which a CSS `transition` already does natively; a loop needs real keyframes, defined
 *   in the DS interop stylesheet). Starts once entered, stops on exit. `direction`/
 *   `distance` don't apply.
 */
export type TransitionEffect = {
  type: 'fade' | 'slide' | 'scale' | 'reveal' | 'pulse';
  duration?: number; // Milliseconds (default: 300; pulse default: 1200)
  easing?: string; // CSS easing function (default: 'ease'; pulse default: 'ease-in-out')
  delay?: number; // Milliseconds (default: 0)
  // slide / scale options
  direction?: 'left' | 'right' | 'up' | 'down'; // Slide direction (default: 'up')
  distance?: string; // Slide/scale distance (default: '40px' for slide, '0.95' for scale)
  // reveal options
  /**
   * Which way the element opens. 'block' (default) is vertical — the accordion case.
   * 'inline' is horizontal, for a label appearing beside an icon.
   */
  axis?: 'block' | 'inline';
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

// --- Token Types ---
// The tokens a schema writes besides nodes: one expression, the handler verbs, and a query.

/**
 * `{ $: '…' }` — an expression over the value layer. See `expressions/index.ts`. Every computed
 * value is one of these; a plain string is text.
 */
export type ExpressionToken = { $: string };
export type ActionToken = {
  $action: string;
  args?: unknown[];
  onSuccess?: unknown[];
  onError?: unknown[];
  onFinally?: unknown[];
};
/**
 * The conditional between handlers: `condition` is an expression, `then`/`else` a handler or a
 * list of them. The only `$if` token — a conditional value is a ternary, a conditional subtree the
 * node-level `{ type: '$if' }`.
 */
export type IfToken = { $if: { condition: unknown; then?: unknown; else?: unknown } };
export type QueryToken = {
  $query: {
    /**
     * The entity to query (neutral) — a name, or an expression that answers with one.
     *
     * The expression form is what lets a template list records of a type it was not written for:
     * `entity: { $: 'target' }` inside an `$each` over a store's list of model names renders a
     * group per model, and a model a community defines this afternoon joins the list with no
     * template change. Resolved against the same stores and row bindings as `where` and `order`,
     * and treated as "not yet" until it answers with a name.
     *
     * Prefer a literal wherever the type IS known: the validator can say nothing about a name it
     * only sees at runtime, and a typo in an expression fails as a silently empty list.
     */
    entity: string | Record<string, unknown>;
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
  /**
   * 'array' is a set of values rather than a shape — the type `$toggleLocalIn` writes and `$in`
   * reads. It exists because `$localState` field names are static, so per-row state (which rows
   * are expanded, which are selected) cannot be a boolean per row when the rows come from data.
   * Holding the ids instead moves the varying part into the value, where an expression can reach it.
   */
  type: 'string' | 'boolean' | 'number' | 'file' | 'function' | 'object' | 'array';
  /** Literal seed value, or any schema expression token (e.g. { $store: '...' }) evaluated once at mount. */
  initial: string | boolean | number | null | Record<string, unknown> | unknown[];
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

/** Write local state: `value` is a literal or an expression evaluated when the handler fires. */
export type SetLocalToken =
  { $setLocal: string; value: unknown } | { $setLocal: string; merge: Record<string, unknown> };
export type TouchToken = { $touch: string };
export type ResetLocalToken = { $resetLocal: string };
export type ToggleLocalToken = { $toggleLocal: string };
/** Add/remove one value in an array-typed field — per-row state whose rows come from data. */
export type ToggleLocalInToken = { $toggleLocalIn: string; value: unknown };
export type CallLocalToken = { $callLocal: string };

/** Descriptor returned by the shared resolver — pure data, no framework effects */
export type QueryDescriptor = {
  /**
   * The entity to query, as authored: a name, or an expression that answers with one.
   *
   * `unknown` rather than `string` because this resolver is pure and an expression can only be
   * evaluated against stores and a row's bindings, which the framework layer holds. Every other
   * part of a query — `where`, `order`, `limit`, `include` — already resolves that way; `entity`
   * was the one field a template had to know at authoring time, and that is what stopped a feed
   * listing records of a type its author had never heard of.
   *
   * A consumer must resolve it and treat an empty answer as "not yet", the way an unresolved
   * `where` condition is dropped rather than shipped with a hole in it.
   */
  entity: unknown;
  params: Record<string, unknown>;
  subscribe: boolean;
  dataset?: string;
  include?: Record<string, boolean | Record<string, unknown>>;
};

/** Union of every token a schema writes in a value or handler position. */
export type OperatorToken =
  | ExpressionToken
  | ActionToken
  | IfToken
  | QueryToken
  | SetLocalToken
  | TouchToken
  | ResetLocalToken
  | ToggleLocalToken
  | ToggleLocalInToken
  | CallLocalToken;
