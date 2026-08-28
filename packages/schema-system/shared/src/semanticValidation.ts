import { BASE_CLASS_LAYERS, getKeysForLayers, layerKeyMap, tierKeys } from '@we/design-utils';
import { role } from '@we/tokens';

import type { ContextData, StateMemberMeta } from './contextTypes';
import { checkExpression, ExpressionSyntaxError, isCallTime, isExpressionToken, parseExpression } from './expressions';
import type { ValidationError, ValidationResult } from './validators';
import { validateStructure } from './validators';

// ── Types ──────────────────────────────────────────────────────────

export type ValidationContext = {
  componentNames: Set<string>;
  componentProps: Map<string, Set<string>>;
  componentPropTypes: Map<string, Map<string, string>>;
  componentPropAllowedValues: Map<string, Map<string, string[]>>;
  universalProps: Set<string>;
  storeNames: Set<string>;
  storeMembers: Map<string, Set<string>>;
  storeMemberMeta: Map<string, Map<string, StateMemberMeta>>;
  modelNames: Set<string>;
  dsPropToLayer: Map<string, string>;
  /** Functions the host lends to expressions, from the generated context's `sources`. */
  hostFunctions: Set<string>;
};

// ── Constants ──────────────────────────────────────────────────────

const HTML_ELEMENTS = new Set([
  'div',
  'span',
  'p',
  'a',
  'img',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'colgroup',
  'col',
  'form',
  'input',
  'button',
  'select',
  'option',
  'optgroup',
  'textarea',
  'label',
  'fieldset',
  'legend',
  'section',
  'article',
  'nav',
  'header',
  'footer',
  'main',
  'aside',
  'figure',
  'figcaption',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'small',
  'sub',
  'sup',
  'video',
  'audio',
  'source',
  'canvas',
  'svg',
  'iframe',
  'details',
  'summary',
  'dialog',
  'menu',
  'slot',
  'template',
  'abbr',
  'address',
  'b',
  'bdi',
  'bdo',
  'cite',
  'data',
  'del',
  'dfn',
  'i',
  'ins',
  'kbd',
  'mark',
  'meter',
  'output',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'time',
  'u',
  'var',
  'wbr',
]);

// ── Helpers ────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function suggest(name: string, knownNames: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDist = 4; // only suggest if distance ≤ 3
  for (const known of knownNames) {
    const d = levenshtein(name.toLowerCase(), known.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = known;
    }
  }
  return best;
}

// DS layer keys whose runtime type isn't a plain token string (see DesignSystemProps
// in @we/design-types). Every other layer key is a token/CSS string.
const DS_PROP_TYPE_OVERRIDES: Record<string, string> = {
  wrap: 'boolean',
  opacity: 'number',
  bgImageOpacity: 'number',
  zIndex: 'string|number',
};

function classifyPropType(typeText: string): string {
  if (!typeText || typeText === 'unknown') return 'unknown';
  const t = typeText.replace(/\s*\|\s*undefined/g, '').trim();
  if (t === 'boolean') return 'boolean';
  if (t === 'number') return 'number';
  if (t === 'string') return 'string';
  // Union of string literals (e.g. "'primary' | 'secondary' | 'ghost'")
  if (t.includes('|') && extractAllowedValues(t)) return 'string';
  // Union containing 'string' → string
  if (t.includes('|') && t.split('|').some((p) => p.trim() === 'string')) return 'string';
  // Named types that accept both strings and numbers (e.g. ZIndexValue)
  if (t === 'ZIndexValue') return 'string|number';
  // Named types (e.g. ButtonVariant, SpaceValue) — all current enums are string-based
  if (/^[A-Z]/.test(t)) return 'string';
  return 'unknown';
}

/**
 * Parse a union of string literals into an array of allowed values.
 * Returns null if the type text is not a pure string literal union.
 * e.g. "'primary' | 'secondary' | 'ghost'" → ['primary', 'secondary', 'ghost']
 */
/** Check if a string looks like a CSS length value (e.g. "20px", "2rem", "50%", "1.5em") */
// Container-query units included in full: `cqi`/`cqb` were already here, but a box measured against
// a surface is usually reasoning about width and height rather than inline and block axes, and the
// call module has been writing `100cqh` through the `styles` escape hatch — the one place this
// check does not reach — since before surfaces existed.
const CSS_LENGTH_RE =
  /^-?\d+(\.\d+)?(px|em|rem|%|vh|vw|vmin|vmax|ch|ex|cap|lh|svh|svw|dvh|dvw|cqi|cqb|cqw|cqh|cqmin|cqmax)$/;

/**
 * A length that is *computed* rather than written out.
 *
 * `calc()` and friends are lengths wherever a length is allowed, and a custom property may hold
 * one, so a prop documented as `{css-length}` has to accept them or it rejects valid CSS. The
 * runtime already does: `isRawCSSValue` in `@we/design-utils` passes these through for every
 * token-resolved prop, and a primitive with a custom size writes whatever string it is given
 * straight onto its own variable.
 *
 * It bit a derived value first — `badgedAvatar` sizes its glyph as a fraction of the avatar's size
 * token, which is exactly the kind of expression a schema cannot write out as a number and should
 * not have to.
 */
const CSS_COMPUTED_LENGTH_RE = /^(calc|min|max|clamp|env|var)\(/i;

function extractAllowedValues(typeText: string): string[] | null {
  const t = typeText.replace(/\s*\|\s*undefined/g, '').trim();
  if (!t.includes('|')) {
    // Single literal e.g. "'primary'"
    const single = /^'([^']*)'$/.exec(t);
    return single ? [single[1]] : null;
  }
  const parts = t.split('|').map((p) => p.trim());
  const values: string[] = [];
  for (const part of parts) {
    const m = /^'([^']*)'$/.exec(part);
    if (!m) return null; // Not a pure string literal union
    values.push(m[1]);
  }
  return values.length > 0 ? values : null;
}

function isTokenObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.some((k) => k.startsWith('$'));
}

// ── Build context ──────────────────────────────────────────────────

export function buildValidationContext(data: ContextData): ValidationContext {
  const componentNames = new Set<string>();
  const componentProps = new Map<string, Set<string>>();
  const componentPropTypes = new Map<string, Map<string, string>>();
  const componentPropAllowedValues = new Map<string, Map<string, string[]>>();
  const dsPropToLayer = new Map<string, string>();

  // Build dsPropToLayer reverse map
  for (const [layer, keys] of Object.entries(layerKeyMap) as [string, readonly string[]][]) {
    for (const key of keys) {
      if (!dsPropToLayer.has(key)) {
        dsPropToLayer.set(key, layer);
      }
    }
  }

  // Primitives
  for (const prim of data.primitives) {
    componentNames.add(prim.tagName);
    const props = new Set<string>();
    const propTypes = new Map<string, string>();
    const propAllowed = new Map<string, string[]>();

    for (const p of prim.ownProps) {
      props.add(p.name);
      propTypes.set(p.name, classifyPropType(p.type));
      const allowed = extractAllowedValues(p.type);
      if (allowed) propAllowed.set(p.name, allowed);
    }

    // Add DS props based on superclass
    if (prim.superclass && BASE_CLASS_LAYERS[prim.superclass]) {
      const layers = BASE_CLASS_LAYERS[prim.superclass];
      const dsKeys = getKeysForLayers(layers);
      for (const key of dsKeys) {
        props.add(key);
        propTypes.set(key, DS_PROP_TYPE_OVERRIDES[key] ?? 'string');
      }
    }

    componentProps.set(prim.tagName, props);
    componentPropTypes.set(prim.tagName, propTypes);
    if (propAllowed.size > 0) componentPropAllowedValues.set(prim.tagName, propAllowed);
  }

  // Components and widgets
  for (const comp of data.components) {
    componentNames.add(comp.name);
    const props = new Set<string>();
    const propTypes = new Map<string, string>();
    const propAllowed = new Map<string, string[]>();
    for (const p of comp.props) {
      props.add(p.name);
      propTypes.set(p.name, classifyPropType(p.type));
      const allowed = extractAllowedValues(p.type);
      if (allowed) propAllowed.set(p.name, allowed);
    }

    // Add DS props based on superclass (mirrors the primitives loop above)
    if (comp.superclass && BASE_CLASS_LAYERS[comp.superclass]) {
      const layers = BASE_CLASS_LAYERS[comp.superclass];
      const dsKeys = getKeysForLayers(layers);
      for (const key of dsKeys) {
        props.add(key);
        propTypes.set(key, DS_PROP_TYPE_OVERRIDES[key] ?? 'string');
      }
    }

    componentProps.set(comp.name, props);
    componentPropTypes.set(comp.name, propTypes);
    if (propAllowed.size > 0) componentPropAllowedValues.set(comp.name, propAllowed);
  }

  // Universal props
  // Includes HTML global attributes that pass through to the DOM on all components
  //
  // The breakpoint tiers sit here alongside `styles` rather than in a layer, for the reason they
  // are not in `layerKeyMap` either: a layer answers "which kinds of property does this element
  // accept", and a tier is not a kind of property but a condition under which any of them apply.
  // What a tier bag may contain is bounded by the element's own layers where the CSS is generated.
  const universalProps = new Set([
    'style',
    'styles',
    'children',
    'ref',
    'key',
    'title',
    'id',
    'class',
    'tabindex',
    ...tierKeys,
  ]);

  // Stores
  const storeNames = new Set<string>();
  const storeMembers = new Map<string, Set<string>>();
  const storeMemberMeta = new Map<string, Map<string, StateMemberMeta>>();
  for (const store of data.storeEntries) {
    storeNames.add(store.name);
    const members = new Set<string>();
    const metaMap = new Map<string, StateMemberMeta>();
    for (const [key, meta] of Object.entries(store.state)) {
      members.add(key);
      metaMap.set(key, meta);
    }
    for (const a of store.actions) members.add(a);
    storeMembers.set(store.name, members);
    storeMemberMeta.set(store.name, metaMap);
  }

  // Feature-module stores, published by the host at `modules.<id>.<key>`.
  //
  // A namespace rather than a store, and deliberately given no `storeMembers` entry: which modules
  // exist is a property of the running deployment's seed, not of this build, so there is no list to
  // check a reference against and pretending otherwise would reject valid schemas. What it does buy
  // is that a module's own fragments — which can only talk to their store this way — stop being
  // unvalidatable. Before this they failed on the very first token, so no module fragment could be
  // checked at all, and a typo in one surfaces only as a component that silently renders nothing.
  storeNames.add('modules');

  // Models
  const modelNames = new Set<string>();
  for (const model of data.models) {
    modelNames.add(model.name);
  }

  for (const name of data.shellComponents ?? []) {
    componentNames.add(name);
  }

  const hostFunctions = new Set((data.sources ?? []).map((source) => source.name));

  return {
    componentNames,
    componentProps,
    componentPropTypes,
    componentPropAllowedValues,
    universalProps,
    storeNames,
    storeMembers,
    storeMemberMeta,
    modelNames,
    dsPropToLayer,
    hostFunctions,
  };
}

// ── Tree walker ────────────────────────────────────────────────────

interface WalkState {
  localScope: Set<string> | null; // null = no $localState in scope
  /**
   * Of those, the names contributed by `$queries` — which are read-only.
   *
   * Kept apart from `localScope` because a *read* does not care which declared it (that is the
   * point of one namespace), while a *write* very much does: `$setLocal` on a hoisted query warns
   * to the console and no-ops, so the control renders, takes the click and does nothing.
   */
  queryScope: Set<string>;
  /**
   * The declared `type` of each `$localState` field in scope, for the checks that care.
   *
   * Only `$toggleLocalIn` does today — it writes a set, and pointed at a boolean it would replace
   * that boolean with an array, which is silent at runtime and confusing everywhere the field is
   * read afterwards.
   */
  localTypes: Map<string, string>;
  /**
   * Names the enclosing nodes bound for an expression to read — `$each`'s `as`, `$single`'s,
   * `$agent`'s, `$surface`'s. What tells `post.title` from a typo, which the context-reference
   * strings never had: `'$psot.title'` resolved to nothing and nobody was told.
   */
  contextScope: Set<string>;
  hasRoutesAncestor: boolean;
  /** True only for the root template node and for route entry nodes — the positions the router
   *  actually reads routes arrays from. Child nodes that are not route entries must never own
   *  a routes array; if they do, nothing will render (the router never sees it). */
  isRouteEligible: boolean;
  /**
   * This schema is a fragment (a bare `SchemaNode` export), not a self-contained template.
   *
   * A fragment is by definition a piece of something else, and `$localState` is scoped to the node
   * that declares it — so a section composed into a page legitimately reads state that page owns.
   * Judging it standalone reports an error about correct code: the shell's language settings section
   * was flagged three times for reading `newLanguageAddress`, which the `/languages` route declares.
   */
  isFragment: boolean;
}

function walkNode(
  node: unknown,
  path: string,
  ctx: ValidationContext,
  state: WalkState,
  errors: ValidationError[],
): void {
  if (typeof node !== 'object' || node === null) return;
  const n = node as Record<string, unknown>;

  const type = n.type as string | undefined;
  if (!type || typeof type !== 'string') {
    /**
     * A node with no `type` is legitimate, and returning here used to discard its whole subtree.
     *
     * The case that matters is a **grouping route** — `{ path, children, routes }` with nothing to
     * render of its own, which is how a layout route nests its sub-routes. The default template's
     * `/space/:spaceId` is exactly that, so bailing here meant About, Globe, Cards, Flux, Graph and
     * Settings — every space view there is — were never validated at all. Unknown components and
     * misspelled props inside them passed silently, which is the opposite of what running this is
     * for.
     *
     * There is nothing to check *about* the node itself (no component, so no props to resolve
     * against one); what matters is that the walk continues through it.
     */
    checkRoutes(n, path, ctx, state, errors);
    const childState = Array.isArray(n.routes) ? { ...state, hasRoutesAncestor: true } : state;
    walkChildren(n, path, ctx, childState, errors);
    return;
  }

  /**
   * `$slot` outlet — where a module lets other modules contribute chrome.
   *
   * Checked rather than waved through with the other `$` types because the failure is silent in a
   * way none of theirs are: the host resolves the marker before the renderer ever sees it, so a
   * missing or misspelled `anchor` renders nothing at all and is indistinguishable from an anchor
   * nobody has contributed to. The registry reports the *other* half of this — a contribution aimed
   * at an anchor no module provides — so between them a typo is caught from whichever side it was
   * made on.
   */
  if (type === '$slot') {
    const anchor = (n.props as { anchor?: unknown } | undefined)?.anchor;
    if (typeof anchor !== 'string' || !anchor) {
      errors.push({
        path: `${path}.props.anchor`,
        message: '{ type: "$slot" } needs a non-empty "anchor" string naming the anchor it renders',
        severity: 'error',
      });
    }
    return;
  }

  // Skip operator nodes
  if (type.startsWith('$') && type !== '$routes') {
    // Still walk into operator internals
    walkOperatorNode(n, path, type, ctx, state, errors);
    return;
  }

  // $routes outlet
  if (type === '$routes') {
    if (!state.hasRoutesAncestor) {
      errors.push({
        path: `${path}.type`,
        message: '{ type: "$routes" } found but no "routes" array on any ancestor',
        severity: 'warning',
      });
    }
    return;
  }

  // Skip HTML elements
  if (HTML_ELEMENTS.has(type)) {
    walkChildren(n, path, ctx, state, errors);
    return;
  }

  // Check component exists
  if (!ctx.componentNames.has(type)) {
    const suggestion = suggest(type, ctx.componentNames);
    const didYouMean = suggestion ? ` Did you mean "${suggestion}"?` : '';
    errors.push({
      path: `${path}.type`,
      message: `Unknown component "${type}".${didYouMean}`,
      severity: 'error',
    });
    // Don't check props on unknown components
    walkChildren(n, path, ctx, state, errors);
    return;
  }

  /**
   * Bring this node's own `$localState` into scope *before* reading its props.
   *
   * Declaring state and consuming it on the same node is the ordinary shape — a button that owns a
   * `joining` flag sets it in `onClick` and reads it in `loading` — and checking props against the
   * parent scope reported every one of those as undeclared. The runtime has no such ordering: the
   * signals are created on mount, before any prop resolves.
   */
  const newState = updateLocalScope(n, state);

  checkHoistedQueries(n, path, ctx, newState, errors);

  // Check props
  const props = n.props as Record<string, unknown> | undefined;
  if (props && typeof props === 'object') {
    checkProps(props, path, type, ctx, newState, errors);
  }

  // Check routes
  checkRoutes(n, path, ctx, newState, errors);

  // If this node has routes, children need hasRoutesAncestor so $routes outlet is valid
  const childState = Array.isArray(n.routes) ? { ...newState, hasRoutesAncestor: true } : newState;

  // Walk children
  walkChildren(n, path, ctx, childState, errors);
}

function walkOperatorNode(
  n: Record<string, unknown>,
  path: string,
  type: string,
  ctx: ValidationContext,
  state: WalkState,
  errors: ValidationError[],
): void {
  const props = n.props as Record<string, unknown> | undefined;
  if (!props) return;

  /*
    Every prop on an operator node, checked as a token.

    Only `$if`'s condition used to be, which left the most data-dense prop in the language unexamined:
    `$each`'s `items` is where a `$query` lives, and nothing looked at it. That is the last link in the
    chain that let `spaceStore.signalTypesBySlug` outlive the store refactor that deleted it — the
    route wasn't walked, the docs still listed the member, and even once both were fixed the `$query`
    holding it sat in a prop nobody read.

    A generic pass rather than a per-operator list, so an operator added later is covered by default
    instead of silently exempt. There is no known-prop check to make here — an operator's props are
    its own grammar, not a component's registered surface.
  */
  for (const [key, value] of Object.entries(props)) {
    // `then`/`else` hold schema *nodes*, not tokens — walked below, where a token in that slot is
    // itself reported as the mistake it is.
    if (type === '$if' && (key === 'then' || key === 'else')) continue;
    checkTokenValue(value, `${path}.props.${key}`, ctx, state, errors);
  }

  if (type === '$if') {
    checkBranchSlot(props.then, `${path}.props.then`, ctx, state, errors);
    checkBranchSlot(props.else, `${path}.props.else`, ctx, state, errors);
  }

  // Walk children of operator nodes, with whatever name this one binds for them.
  walkChildren(n, path, ctx, withBoundName(type, props, state), errors);
}

/** The context name a binding operator gives its subtree, if this is one. */
const BINDING_DEFAULTS: Record<string, string> = {
  $each: 'item',
  $single: 'item',
  $agent: 'agent',
  $surface: 'surface',
};

function withBoundName(type: string, props: Record<string, unknown>, state: WalkState): WalkState {
  const fallback = BINDING_DEFAULTS[type];
  if (fallback === undefined) return state;
  const name = typeof props.as === 'string' && props.as ? props.as : fallback;
  const contextScope = new Set(state.contextScope);
  contextScope.add(name);
  return { ...state, contextScope };
}

/**
 * An expression, parsed and checked against what this node can see.
 *
 * Both halves report a column — the offset into the source the author wrote — because "somewhere
 * in this string" is not a location an authoring loop can act on, and the string can be long.
 */
function checkExpressionToken(
  source: string,
  path: string,
  ctx: ValidationContext,
  state: WalkState,
  errors: ValidationError[],
): void {
  let ast;
  try {
    ast = parseExpression(source);
  } catch (error) {
    if (error instanceof ExpressionSyntaxError) {
      errors.push({
        path: `${path}.$`,
        message: `Expression: ${error.message} (column ${error.span[0]})`,
        severity: 'error',
      });
      return;
    }
    throw error;
  }
  const issues = checkExpression(ast, {
    storeNames: ctx.storeNames,
    storeMembers: ctx.storeMembers,
    // A whole template with no `$localState` has an empty scope, not an unknowable one.
    locals: state.localScope ?? (state.isFragment ? null : new Set()),
    contextNames: state.contextScope,
    strict: !state.isFragment,
    hostFunctions: ctx.hostFunctions,
  });
  for (const issue of issues) {
    errors.push({
      path: `${path}.$`,
      message: `Expression: ${issue.message} (column ${issue.span[0]})`,
      severity: issue.severity,
    });
  }
}

/**
 * A `then`/`else` slot on a **block-level** `$if` node must hold a schema node.
 *
 * The renderer passes these straight to `renderNode`, so an operator token — `{ $if: … }`,
 * `{ $store: … }` — has no `type` and renders nothing at all. Silently, and only at runtime.
 *
 * The mistake is easy because both spellings are real and look interchangeable: `{ $if: … }` is
 * the prop-level operator, legal in any prop value, while `{ type: '$if', props: { … } }` is the
 * node. Nesting one conditional inside another's `else` is exactly where an author reaches for the
 * wrong one — and this validator used to accept it, which is how a token in that slot blanked WE's
 * entire sign-in screen with every check passing.
 */
function checkBranchSlot(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  state: WalkState,
  errors: ValidationError[],
): void {
  if (value === undefined || value === null) return;

  // Strings are legal — a text child.
  if (typeof value !== 'object') return;

  // A node stays a node whatever `$`-prefixed siblings it carries: `$localState` and `$queries`
  // live alongside `type`, so "has a $ key" alone does not make something a token.
  const record = value as Record<string, unknown>;
  const isNode = 'type' in record || 'children' in record;

  if (!isNode && isTokenObject(value)) {
    const keys = Object.keys(value).filter((k) => k.startsWith('$'));
    const asNode = keys.includes('$if')
      ? ` Write it as a node: { type: "$if", props: { … } }.`
      : ` This slot renders a node, so a "${keys[0]}" token here renders nothing.`;
    errors.push({
      path,
      message: `Operator token "${keys[0]}" used where a schema node is required.${asNode}`,
      severity: 'error',
    });
    // Still walk the token's internals so store/action typos inside it are reported too.
    checkTokenValue(value, path, ctx, state, errors);
    return;
  }

  walkNode(value, path, ctx, state, errors);
}

function updateLocalScope(n: Record<string, unknown>, state: WalkState): WalkState {
  // Both live on the node itself (siblings of type/props/children), not inside props.
  const localState = n.$localState as Record<string, unknown> | undefined;
  /**
   * Hoisted queries declare `$local` names too — they share one namespace with `$localState`, and a
   * node reads `{ $local: 'signalTypes' }` without caring which declared it.
   *
   * Missed until `$count`'s internals started being walked, at which point every read of a hoisted
   * query was reported as undeclared. Registering them here is what makes those reads legal — and,
   * in the other direction, makes a typo in a `$queries` key catchable at last.
   */
  const queries = n.$queries as Record<string, unknown> | undefined;

  const hasState = localState && typeof localState === 'object';
  const hasQueries = queries && typeof queries === 'object';
  if (!hasState && !hasQueries) return state;

  const newFields = new Set(state.localScope ?? []);
  const newTypes = new Map(state.localTypes);
  if (hasState)
    for (const [key, field] of Object.entries(localState)) {
      newFields.add(key);
      const declared = (field as { type?: unknown } | null)?.type;
      if (typeof declared === 'string') newTypes.set(key, declared);
    }
  const newQueries = new Set(state.queryScope);
  if (hasQueries)
    for (const key of Object.keys(queries)) {
      newQueries.add(key);
      // The renderer exposes a `<name>Loaded` flag beside each hoisted query —
      // false until the first result set — so templates can hold a skeleton
      // instead of flashing their empty state. Read-only, like the query itself.
      newQueries.add(`${key}Loaded`);
    }
  // A `$localState` field on the same node shadows the hoisted query of that name, so the write
  // check below must not treat it as read-only any more.
  if (hasState) for (const key of Object.keys(localState)) newQueries.delete(key);
  for (const key of newQueries) newFields.add(key);
  return { ...state, localScope: newFields, queryScope: newQueries, localTypes: newTypes };
}

/**
 * `BlockComposer` given an `onSave` but no `onReady`.
 *
 * The composer is pull-based: `onSave` fires when somebody calls the `save()` it hands out through
 * `onReady`, not when the user types. So this combination means the template has a save handler
 * nothing will ever trigger — and because `onReady` is optional, the composer falls back to
 * rendering a floppy-disk button of its own, leaving two buttons on screen of which only the
 * unexpected one works. The template's own button, wired to a draft that was never filled in,
 * submits `null` and fails inside `persistNode`, several frames from the cause.
 *
 * A hard-coded component rule rather than something derived, because the constraint is not
 * expressible in the manifest: it is a relationship *between* two optional props. Kept next to the
 * generic prop checks so the one component this applies to is visible rather than buried.
 *
 * The fix at a call site is almost always "use `composerModal` from `@we/template-kit`", which owns
 * the handshake.
 */
function checkComposerHandshake(
  props: Record<string, unknown>,
  path: string,
  componentType: string,
  errors: ValidationError[],
): void {
  if (componentType !== 'BlockComposer') return;
  if (props.onSave === undefined || props.onReady !== undefined) return;
  errors.push({
    path: `${path}.props.onSave`,
    message:
      'BlockComposer has "onSave" but no "onReady" — onSave only fires when the composer\'s own save() ' +
      'is called, and save() is handed out through onReady. Without it this handler never runs, and the ' +
      'composer renders its own save button instead. Use composerModal from @we/template-kit, or wire ' +
      'onReady to a function-typed $localState field and call it with $callLocal.',
    severity: 'error',
  });
}

/**
 * Semantic roles as a *template* spells them — kebab-case — mapped from the camelCase a `ThemeRole`
 * uses. The two spellings are unavoidable (one is a TypeScript key, the other a CSS custom property)
 * and confusing them fails in the worst possible way: `tokenVar` does not recognise `surfaceSunken`,
 * so it emits `var(--we-color-surfaceSunken)`, a variable that does not exist, and the declaration
 * is dropped. No error, no fallback — the element simply paints nothing, which reads as a layout
 * bug somewhere else entirely. Migrating the repo's templates to roles hit this on ~690 call sites
 * at once, all of them silent.
 */
const ROLE_SPELLINGS = new Map(
  Object.keys(role).map((name) => [name, name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)]),
);
const COLOUR_PROPS = new Set(['bg', 'color', 'borderColor', 'fadeColor', 'bgImageTint', 'ring']);
const BORDER_PROPS = new Set(['border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft']);

/** Flag a role named in camelCase, wherever a colour can appear — including behind `$if`. */
function checkColourValue(propName: string, value: unknown, path: string, errors: ValidationError[]): void {
  // A colour computed by an expression is one of its string literals — `open ? 'accentMuted' : 'surface'`.
  if (isExpressionToken(value)) {
    for (const literal of value.$.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)) {
      checkColourValue(propName, literal[1] ?? literal[2], path, errors);
    }
    return;
  }
  if (typeof value === 'string') {
    const candidate = BORDER_PROPS.has(propName) ? value.split(' ').slice(2).join(' ') : value;
    // Only when the two spellings actually differ — `page` and `surface` are the same either way.
    const kebab = ROLE_SPELLINGS.get(candidate);
    if (kebab && kebab !== candidate) {
      errors.push({
        path,
        message:
          `"${candidate}" is a role name in its TypeScript spelling; a schema writes roles kebab-cased. ` +
          `Use "${kebab}". As written it resolves to a CSS variable that does not exist, so nothing is painted.`,
        severity: 'error',
      });
    }
    return;
  }
}

/**
 * A string that was a reference in the old spelling — `'$post.title'`, `'$event.detail'`, `'$me.did'`.
 *
 * A plain string is text now, so this would render as the characters themselves — a title reading
 * `$post.title` — and nothing at runtime says so. The roots are the ones a reference could start
 * from; a literal that happens to begin with a dollar sign and a word is left alone.
 */
const LEGACY_REFERENCE =
  /^\$(event|arg|result|me|item|index|prev|surface|local|currentDataset|[a-zA-Z]+Store|modules)(\.[A-Za-z0-9_$]+)*$/;

function checkLegacyReference(value: unknown, path: string, errors: ValidationError[], dottedOnly = false): void {
  if (typeof value !== 'string' || !LEGACY_REFERENCE.test(value)) return;
  // In text, a bare `$arg` is as likely to be prose about the token as a reference to it.
  if (dottedOnly && !value.includes('.')) return;
  errors.push({
    path,
    message: `"${value}" is a reference in the old string spelling and would render as text. Write { "$": "${value.slice(1)}" }.`,
    severity: 'error',
  });
}

function checkProps(
  props: Record<string, unknown>,
  path: string,
  componentType: string,
  ctx: ValidationContext,
  state: WalkState,
  errors: ValidationError[],
): void {
  const knownProps = ctx.componentProps.get(componentType);
  const propTypes = ctx.componentPropTypes.get(componentType);

  checkComposerHandshake(props, path, componentType, errors);

  for (const [propName, propValue] of Object.entries(props)) {
    // Skip internal schema props
    if (propName === '$localState') continue;

    const propPath = `${path}.props.${propName}`;

    // Check for token values in props (regardless of whether prop is known)
    checkTokenValue(propValue, propPath, ctx, state, errors);

    if (COLOUR_PROPS.has(propName) || BORDER_PROPS.has(propName)) {
      checkColourValue(propName, propValue, propPath, errors);
    }

    // Universal props are always valid
    if (ctx.universalProps.has(propName)) continue;
    // Event handlers are always valid
    if (propName.startsWith('on') && propName.length > 2 && propName[2] === propName[2].toUpperCase()) continue;

    // Check if prop is known
    if (knownProps && !knownProps.has(propName)) {
      // Check if it's a DS prop from a layer this component doesn't support
      const layer = ctx.dsPropToLayer.get(propName);
      if (layer) {
        errors.push({
          path: propPath,
          message: `Unknown prop "${propName}" on "${componentType}" — "${propName}" requires the ${layer} layer`,
          severity: 'warning',
        });
      } else {
        /*
          The same nearest-name hint unknown components and models already get.

          Worth having generally, and worth having *now*: `mdProps` is the obvious way to spell the
          new breakpoint bags and the wrong one — `md` is already a size value on some fifteen
          primitives, so `mdUpProps` is what they are called. A warning that only says the prop is
          unknown leaves the author to find that out from the docs.
        */
        const suggestion = suggest(propName, [...knownProps, ...ctx.universalProps]);
        errors.push({
          path: propPath,
          message: `Unknown prop "${propName}" on "${componentType}"${suggestion ? ` — did you mean "${suggestion}"?` : ''}`,
          severity: 'warning',
        });
      }
      continue;
    }

    checkLegacyReference(propValue, propPath, errors);

    // Check prop type category (only for static values, not token objects)
    if (propTypes && !isTokenObject(propValue) && typeof propValue !== 'object') {
      const expectedCategory = propTypes.get(propName);
      if (expectedCategory && expectedCategory !== 'unknown') {
        const actualType = typeof propValue;
        if (actualType === 'string' || actualType === 'boolean' || actualType === 'number') {
          const allowed =
            expectedCategory === 'string|number'
              ? actualType === 'string' || actualType === 'number'
              : actualType === expectedCategory;
          if (!allowed) {
            errors.push({
              path: propPath,
              message: `Prop "${propName}" on "${componentType}" expects ${expectedCategory}, got ${actualType}`,
              severity: 'warning',
            });
            continue;
          }
        }
      }
    }

    // Check allowed values for string enums
    if (typeof propValue === 'string') {
      const allowedMap = ctx.componentPropAllowedValues.get(componentType);
      const allowed = allowedMap?.get(propName);
      if (allowed && !allowed.includes(propValue)) {
        // {css-length} is a placeholder meaning "any valid CSS length"
        const acceptsCssLength =
          allowed.includes('{css-length}') && (CSS_LENGTH_RE.test(propValue) || CSS_COMPUTED_LENGTH_RE.test(propValue));
        if (!acceptsCssLength) {
          errors.push({
            path: propPath,
            message: `Invalid value "${propValue}" for prop "${propName}" on "${componentType}". Allowed: ${allowed.map((v) => `'${v}'`).join(' | ')}`,
            severity: 'warning',
          });
        }
      }

      // Catch bare numbers on props that explicitly accept CSS lengths (e.g. "16" should be "16px")
      // Only flag props whose allowed values include {css-length} — all others may use bare numbers as content
      if (/^\d+(\.\d+)?$/.test(propValue) && allowed?.includes('{css-length}')) {
        errors.push({
          path: propPath,
          message: `Prop "${propName}" has bare number "${propValue}" — add a CSS unit (e.g. "${propValue}px") or use one of the component's declared token values.`,
          severity: 'warning',
        });
      }
    }
  }
}

function checkTokenValue(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  state: WalkState,
  errors: ValidationError[],
): void {
  if (typeof value !== 'object' || value === null) return;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      checkTokenValue(value[i], `${path}[${i}]`, ctx, state, errors);
    }
    return;
  }

  const obj = value as Record<string, unknown>;

  // An expression carries everything it references in its source; nothing else to walk.
  if (isExpressionToken(obj)) {
    checkExpressionToken(obj.$, path, ctx, state, errors);
    return;
  }

  // $action token
  if ('$action' in obj && typeof obj.$action === 'string') {
    checkActionRef(obj.$action, `${path}.$action`, ctx, errors);
    if (Array.isArray(obj.args)) checkActionArgs(obj.args, `${path}.args`, errors);
  }

  // $query token — the entity is checked against the manifest's known models.
  if ('$query' in obj && typeof obj.$query === 'object' && obj.$query !== null) {
    const query = obj.$query as Record<string, unknown>;
    if (typeof query.entity === 'string' && entityIsCheckable(query)) {
      checkModelRef(query.entity, `${path}.$query.entity`, ctx, errors);
    }
    checkQueryInternals(query, `${path}.$query`, ctx, state, errors);
  }

  // $setLocal token
  if ('$setLocal' in obj && typeof obj.$setLocal === 'string') {
    checkLocalRef(obj.$setLocal, `${path}.$setLocal`, 'setLocal', state, errors);
    checkLocalWrite(obj.$setLocal, `${path}.$setLocal`, 'setLocal', state, errors);
  }

  /*
    $toggleLocal and $callLocal were never checked at all, so a typo in either produced exactly the
    failure this validator exists to catch: the button renders, takes the click, warns to a console
    nobody has open, and does nothing.
  */
  if ('$toggleLocal' in obj && typeof obj.$toggleLocal === 'string') {
    checkLocalRef(obj.$toggleLocal, `${path}.$toggleLocal`, 'toggleLocal', state, errors);
    checkLocalWrite(obj.$toggleLocal, `${path}.$toggleLocal`, 'toggleLocal', state, errors);
  }

  if ('$toggleLocalIn' in obj && typeof obj.$toggleLocalIn === 'string') {
    checkLocalRef(obj.$toggleLocalIn, `${path}.$toggleLocalIn`, 'toggleLocalIn', state, errors);
    checkLocalWrite(obj.$toggleLocalIn, `${path}.$toggleLocalIn`, 'toggleLocalIn', state, errors);
    checkToggleLocalInField(obj, path, state, errors);
  }

  if ('$callLocal' in obj && typeof obj.$callLocal === 'string') {
    checkLocalRef(obj.$callLocal, `${path}.$callLocal`, 'callLocal', state, errors);
  }

  // $touch token
  if ('$touch' in obj && typeof obj.$touch === 'string') {
    if (obj.$touch !== '$all') {
      checkLocalRef(obj.$touch, `${path}.$touch`, 'touch', state, errors);
    }
  }

  // $resetLocal token — skip $scope
  if ('$resetLocal' in obj && typeof obj.$resetLocal === 'string') {
    if (obj.$resetLocal !== '$scope') {
      checkLocalRef(obj.$resetLocal, `${path}.$resetLocal`, 'resetLocal', state, errors);
      checkLocalWrite(obj.$resetLocal, `${path}.$resetLocal`, 'resetLocal', state, errors);
    }
  }

  // Recurse into nested token objects ($if, $concat, $map, $eq, $ne, etc.)
  // The handler conditional: an expression, and a handler or a list of them on each side.
  if ('$if' in obj && typeof obj.$if === 'object' && obj.$if !== null) {
    const ifObj = obj.$if as Record<string, unknown>;
    checkTokenValue(ifObj.condition, `${path}.$if.condition`, ctx, state, errors);
    checkTokenValue(ifObj.then, `${path}.$if.then`, ctx, state, errors);
    checkTokenValue(ifObj.else, `${path}.$if.else`, ctx, state, errors);
  }
}

/**
 * `$queries` — hoisted subscriptions declared on a node — get the same treatment as an inline
 * `$query`.
 *
 * They had none at all: not the entity, not a `$store` in a `where`. The shape is identical to the
 * prop-level token minus its wrapper, so the same two checks apply.
 */
function checkHoistedQueries(
  n: Record<string, unknown>,
  path: string,
  ctx: ValidationContext,
  state: WalkState,
  errors: ValidationError[],
): void {
  const queries = n.$queries as Record<string, unknown> | undefined;
  if (!queries || typeof queries !== 'object') return;

  for (const [name, query] of Object.entries(queries)) {
    if (!query || typeof query !== 'object') continue;
    const q = query as Record<string, unknown>;
    const qPath = `${path}.$queries.${name}`;
    if (typeof q.entity === 'string' && entityIsCheckable(q)) checkModelRef(q.entity, `${qPath}.entity`, ctx, errors);
    checkQueryInternals(q, qPath, ctx, state, errors);
  }
}

/**
 * Walk anything nested inside a `$query`, checking every token found on the way down.
 *
 * Only `entity` used to be checked, so a `$store` inside a `where` clause was never looked at — which
 * is how `spaceStore.signalTypesBySlug.like.id` survived the store refactor that deleted it, leaving
 * a like-count projection filtering on `undefined` with every check passing.
 *
 * A query's tokens hide behind *plain* objects (`where: { field: { $store } }`,
 * `include: { $alias: { where: { … } } }`), and `checkTokenValue` only recurses through operator
 * shapes it recognises. So this descends the plain structure and hands each token over as it finds
 * one, stopping at tokens rather than recursing into them — they walk their own internals, and
 * walking them twice would report everything twice.
 *
 * Deliberately **not** checked here: relation names in `include`/`scope.via`, and entity names beyond
 * the existing `entity` check. Those resolve against the *perspective's* manifest at runtime, which
 * includes foreign schemas synced in from other apps (Flux's `Channel`, `Conversation`) that this
 * validator has no picture of. Reporting them would be a stream of false positives on templates that
 * work.
 */
function checkQueryInternals(
  query: Record<string, unknown>,
  path: string,
  ctx: ValidationContext,
  state: WalkState,
  errors: ValidationError[],
): void {
  for (const [key, value] of Object.entries(query)) {
    // `entity` is a bare model name, already checked by the caller.
    if (key === 'entity') continue;
    // `include` keys are aliases (`$likeCount`), not tokens — descend per entry so a `$`-prefixed
    // alias is never mistaken for an operator.
    if (key === 'include' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [alias, spec] of Object.entries(value as Record<string, unknown>)) {
        checkNestedTokens(spec, `${path}.include.${alias}`, ctx, state, errors);
      }
      continue;
    }
    checkNestedTokens(value, `${path}.${key}`, ctx, state, errors);
  }
}

/** Descend plain structure; hand any token to {@link checkTokenValue} and let it own its internals. */
function checkNestedTokens(
  value: unknown,
  path: string,
  ctx: ValidationContext,
  state: WalkState,
  errors: ValidationError[],
): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      checkNestedTokens(value[i], `${path}[${i}]`, ctx, state, errors);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  if (isTokenObject(value)) {
    checkTokenValue(value, path, ctx, state, errors);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    checkNestedTokens(child, `${path}.${key}`, ctx, state, errors);
  }
}

/**
 * An expression about the event, nested where it is evaluated before the event exists.
 *
 * `args` resolve at render time. At the top level an expression naming `event`/`arg` is deferred to
 * the callback — that is how `args: [{ $: 'event.detail' }]` works. Inside another token it is
 * evaluated at once, against no event, and becomes a constant: `{ $setLocal: 'x', value: { $: '…' } }`
 * is fine (a handler), but an object argument holding one is not. Nothing errors at runtime — the
 * store is handed a plausible argument — so this is only findable by noticing a control that does
 * not work.
 */
function checkActionArgs(args: unknown[], path: string, errors: ValidationError[]): void {
  const walk = (value: unknown, at: string, insideOperator: boolean): void => {
    if (isExpressionToken(value)) {
      if (!insideOperator) return;
      try {
        if (!isCallTime(parseExpression(value.$))) return;
      } catch {
        return;
      }
      errors.push({
        path: at,
        message:
          `An expression reading the event is nested inside another token, where it is evaluated before the ` +
          `event exists and becomes a constant. Put the whole computation in one expression at the top level of args.`,
        severity: 'error',
      });
      return;
    }
    if (typeof value === 'string') {
      checkLegacyReference(value, at, errors);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${at}[${i}]`, insideOperator));
      return;
    }
    if (value && typeof value === 'object') {
      const isOperator = Object.keys(value).some((k) => k.startsWith('$'));
      for (const [k, v] of Object.entries(value)) walk(v, `${at}.${k}`, insideOperator || isOperator);
    }
  };

  args.forEach((arg, i) => walk(arg, `${path}[${i}]`, false));
}

function checkActionRef(ref: string, path: string, ctx: ValidationContext, errors: ValidationError[]): void {
  const dotIdx = ref.indexOf('.');
  if (dotIdx === -1) return; // malformed, structural validation handles this

  const storeName = ref.slice(0, dotIdx);
  const methodName = ref.slice(dotIdx + 1);

  if (!ctx.storeNames.has(storeName)) {
    const known = [...ctx.storeNames].join(', ');
    errors.push({
      path,
      message: `Unknown store "${storeName}" in $action "${ref}". Known stores: ${known}`,
      severity: 'error',
    });
    return;
  }

  const members = ctx.storeMembers.get(storeName);
  if (members && !members.has(methodName)) {
    // Filter to actions only (not state)
    const known = [...members].join(', ');
    errors.push({
      path,
      message: `Unknown method "${methodName}" on store "${storeName}". Known members: ${known}`,
      severity: 'warning',
    });
  }
}

/**
 * Whether a query's entity name can be judged here at all.
 *
 * `dataset` names where the data lives, and naming one is the author saying the entity belongs to a
 * schema this validator has no manifest for: a foreign app's models synced into the space (Flux's
 * `Channel`, `Conversation`) or a manifest installed at runtime (the query test page's `TestItem`).
 * Both are real entities that resolve fine against the *perspective's* manifest; only `@we/models`
 * is knowable statically.
 *
 * So the rule is the one the schema docs already state — external data carries `dataset` — and
 * checking the name anyway turned every such query into a false error the moment operator props
 * started being walked. A query with no `dataset` targets the current space's WE models, which is
 * exactly the case worth checking.
 */
function entityIsCheckable(query: Record<string, unknown>): boolean {
  return query.dataset === undefined;
}

function checkModelRef(name: string, path: string, ctx: ValidationContext, errors: ValidationError[]): void {
  if (!ctx.modelNames.has(name)) {
    const suggestion = suggest(name, ctx.modelNames);
    const didYouMean = suggestion ? ` Did you mean "${suggestion}"?` : '';
    errors.push({
      path,
      message: `Unknown model "${name}" in $query.${didYouMean}`,
      severity: 'error',
    });
  }
}

/**
 * A write to a name a `$queries` entry owns.
 *
 * `$queries` and `$localState` share one `$local` namespace so a reader need not care which
 * declared a name — but query results are read-only. `$setLocal` against one warns and no-ops, so
 * the control renders, accepts the click, and does nothing at all.
 */
/**
 * `$toggleLocalIn` writes a set, so the field it names has to be one, and it has to be given
 * something to put in it.
 *
 * Both mistakes are otherwise silent: a missing `value` toggles `undefined` in and out of the array
 * forever, and a field declared `boolean` is quietly replaced by an array the first time it is
 * clicked, so every read of it downstream starts answering a different question.
 */
function checkToggleLocalInField(
  obj: Record<string, unknown>,
  path: string,
  state: WalkState,
  errors: ValidationError[],
): void {
  if (!('value' in obj) || obj.value === undefined) {
    errors.push({
      path: `${path}.$toggleLocalIn`,
      message: '$toggleLocalIn needs a "value" — the entry to add or remove, e.g. { value: "$group.id" }',
      severity: 'error',
    });
  }

  const field = String(obj.$toggleLocalIn).split('.')[0];
  const declared = state.localTypes.get(field);
  if (declared !== undefined && declared !== 'array') {
    errors.push({
      path: `${path}.$toggleLocalIn`,
      message:
        `$toggleLocalIn writes a set to "${field}", which is declared as "${declared}". ` +
        `Declare it as { type: 'array', initial: [] }.`,
      severity: 'error',
    });
  }
}

function checkLocalWrite(
  fieldName: string,
  path: string,
  tokenType: string,
  state: WalkState,
  errors: ValidationError[],
): void {
  const rootField = fieldName.split('.')[0];
  if (!state.queryScope.has(rootField)) return;
  errors.push({
    path,
    message:
      `$${tokenType} writes to "${rootField}", which is declared by $queries and is read-only. ` +
      `The write will warn and no-op at runtime. Declare it in $localState instead, or write to a different field.`,
    severity: 'error',
  });
}

function checkLocalRef(
  fieldName: string,
  path: string,
  tokenType: string,
  state: WalkState,
  errors: ValidationError[],
): void {
  // Skip special values
  if (fieldName === '$all' || fieldName === '$scope') return;

  if (state.localScope === null) {
    // A fragment's scope is supplied by whatever page composes it, which is not in view here. The
    // check still runs in full against that page, where the answer is knowable.
    if (state.isFragment) return;
    errors.push({
      path,
      message: `$${tokenType} references "${fieldName}" but no $localState is declared in scope`,
      severity: 'error',
    });
    return;
  }

  // Dot paths read into an object-typed field (`{ $local: 'location.city' }`), so only the root
  // segment is a declaration. Checking the whole string rejected a documented read — it went
  // unnoticed because the subtrees using it were never walked: a branch node carrying $localState
  // was misread as an operator token, and everything beneath it skipped.
  const rootField = fieldName.split('.')[0];

  if (!state.localScope.has(rootField)) {
    const declared = [...state.localScope].join(', ');
    errors.push({
      path,
      message: `$${tokenType} references "${fieldName}" but $localState only declares: ${declared}`,
      severity: 'error',
    });
  }
}

function checkRoutes(
  n: Record<string, unknown>,
  path: string,
  ctx: ValidationContext,
  state: WalkState,
  errors: ValidationError[],
): void {
  const routes = n.routes as unknown[] | undefined;
  if (!Array.isArray(routes)) return;

  // Guard: routes array on a non-root, non-route child node is dead — the router only reads
  // routes from the root template node and from route entry nodes themselves. Placing routes
  // on a regular child (e.g. a Column inside children[]) means the router never finds them
  // and nothing will render.
  if (!state.isRouteEligible) {
    errors.push({
      path: `${path}.routes`,
      message:
        'routes array on a non-root, non-route child node — the router never reads routes from here and nothing will render. ' +
        'Move the routes array to the root template node or a route entry.',
      severity: 'error',
    });
  }

  // Check for duplicate route paths
  const paths = new Map<string, number[]>();
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i] as Record<string, unknown> | undefined;
    if (!route || typeof route !== 'object') continue;
    const routePath = route.path as string | undefined;
    if (typeof routePath !== 'string') continue;
    const indices = paths.get(routePath) ?? [];
    indices.push(i);
    paths.set(routePath, indices);
  }

  for (const [routePath, indices] of paths) {
    if (indices.length > 1) {
      const positions = indices.map((i) => `routes[${i}]`).join(' and ');
      errors.push({
        path: `${path}.routes`,
        message: `Duplicate route path "${routePath}" at ${positions}`,
        severity: 'warning',
      });
    }
  }

  // Guard: route entry whose component type is "$routes".
  // $routes is a slot marker for the router's injected JSX children. As a leaf route entry
  // it has no children injected, so it returns null — every navigation to that path renders
  // nothing. A route entry's type should be a real layout/content component.
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i] as Record<string, unknown> | undefined;
    if (route && typeof route === 'object' && route.type === '$routes') {
      errors.push({
        path: `${path}.routes[${i}].type`,
        message:
          `Route at "${(route.path as string | undefined) ?? `[${i}]`}" uses type "$routes" — this renders null as a leaf route. ` +
          "A route entry's type is the component displayed when that path is active; " +
          'use a layout component (e.g. "Column") and put the content in children.',
        severity: 'error',
      });
    }
  }

  // Check that children contain a $routes outlet
  if (!hasRoutesOutlet(n)) {
    errors.push({
      path: `${path}.routes`,
      message: 'Node has "routes" array but no { type: "$routes" } in children',
      severity: 'warning',
    });
  }

  /*
    Walk route nodes. `isRouteEligible` so route entries may define sub-routes of their own.

    **Local scope resets at a route boundary**, and that is the renderer's behaviour rather than a
    conservative choice: `buildRoutes` renders each route through its own `RenderSchema` call, which
    starts with no inherited context. So a `$localState` field or a `$queries` entry declared on the
    template root is invisible to everything below a `$routes` outlet.

    Carrying the parent's scope across here made the validator disagree with the renderer in the
    quietest possible direction — it *approved* reads that resolve to nothing at runtime. A feed
    whose hoisted `signalTypes` query sat on the template root passed validation and then rendered
    no signal controls at all, with a `field "signalTypes" not declared` line in the console as the
    only evidence.
  */
  const routeState = {
    ...state,
    hasRoutesAncestor: true,
    isRouteEligible: true,
    /*
      An **empty** scope, not `null`. The two mean different things here: `null` is "unknown", which
      is how a fragment validated on its own is treated so that reading a local its eventual parent
      declares is not an error. Below a route there is nothing unknown — the renderer starts that
      subtree with no context at all — so an empty set is the accurate statement, and it is what
      makes the orphan check run rather than be skipped.
    */
    localScope: new Set<string>(),
    localTypes: new Map<string, string>(),
    queryScope: new Set<string>(),
    contextScope: new Set<string>(),
  };
  for (let i = 0; i < routes.length; i++) {
    walkNode(routes[i], `${path}.routes[${i}]`, ctx, routeState, errors);
  }
}

function hasRoutesOutlet(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const n = node as Record<string, unknown>;
  if (n.type === '$routes') return true;
  const children = n.children as unknown[] | undefined;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (hasRoutesOutlet(child)) return true;
    }
  }
  const slots = n.slots as Record<string, unknown> | undefined;
  if (slots && typeof slots === 'object') {
    for (const slotNode of Object.values(slots)) {
      if (hasRoutesOutlet(slotNode)) return true;
    }
  }
  /**
   * A `$if` keeps its branches in `props`, not `children` — and putting the outlet behind a gate is
   * the normal shape, not an exotic one: the default template renders its space routes only once the
   * dataset is confirmed to be a WE space. Without this the outlet is invisible here and the node is
   * accused of having routes with nowhere to render them.
   */
  const props = n.props as Record<string, unknown> | undefined;
  if (props && typeof props === 'object') {
    if (hasRoutesOutlet(props.then) || hasRoutesOutlet(props.else)) return true;
  }
  return false;
}

function walkChildren(
  n: Record<string, unknown>,
  path: string,
  ctx: ValidationContext,
  state: WalkState,
  errors: ValidationError[],
): void {
  // Update local scope before walking children.
  // Children walked here are layout/content nodes, not route entries, so they must not
  // define routes arrays (isRouteEligible = false). Route entries are walked directly by
  // checkRoutes with isRouteEligible = true.
  const childState = { ...updateLocalScope(n, state), isRouteEligible: false };

  // Children
  const children = n.children as unknown[] | undefined;
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childPath = `${path}.children[${i}]`;
      if (typeof child === 'string') {
        checkLegacyReference(child, childPath, errors, true);
        continue;
      }
      if (typeof child !== 'object' || child === null) continue;

      /*
        An expression sitting directly in `children` — a count-noun label, a store member for a
        name, a local for a label. Legal (the children union accepts tokens, which is how a computed
        label is written at all) but *not a node*, so it must be checked as a token rather than
        walked as one.

        Walking it as a node is what used to happen, and since a token has no `type` it fell into
        the grouping-node branch, which looks for routes and children and finds neither — so every
        store path and local reference inside an expression in a children array went unexamined.
        The gap was invisible because the same expressions are checked everywhere else: move
        `{ $: 'local.signalTypes' }` from a prop into a children array and the validator stopped
        having an opinion about it.

        `type`/`children` still win, so a node carrying `$localState` or `$queries` stays a node.
      */
      const record = child as Record<string, unknown>;
      if (!('type' in record) && !('children' in record) && isTokenObject(child)) {
        checkTokenValue(child, childPath, ctx, childState, errors);
        continue;
      }

      walkNode(child, childPath, ctx, childState, errors);
    }
  }

  // Slots
  const slots = n.slots as Record<string, unknown> | undefined;
  if (slots && typeof slots === 'object') {
    for (const [slotName, slotNode] of Object.entries(slots)) {
      if (typeof slotNode === 'object' && slotNode !== null) {
        walkNode(slotNode, `${path}.slots.${slotName}`, ctx, childState, errors);
      }
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────

export function validateSemantic(schema: unknown, context: ValidationContext): ValidationResult {
  // If the schema declares custom stores/components in meta, extend the known sets for this validation
  // meta.stores supports two formats:
  //   string[]  — just declares store names exist (original behavior)
  //   Record<string, { actions?: string[]; state?: string[] }> — declares names + additional members
  const meta = (schema as Record<string, unknown>)?.meta as
    | {
        stores?: string[] | Record<string, true | { actions?: string[]; state?: string[] }>;
        components?: string[];
      }
    | undefined;

  if (meta?.stores || meta?.components?.length) {
    const newStoreNames = new Set(context.storeNames);
    const newStoreMembers = new Map(context.storeMembers);

    if (meta.stores) {
      if (Array.isArray(meta.stores)) {
        // string[] — just add names
        for (const name of meta.stores) newStoreNames.add(name);
      } else {
        // Record — add names and merge members
        for (const [name, decl] of Object.entries(meta.stores)) {
          newStoreNames.add(name);
          // `true` means "store exists, accept all members" — remove any global restrictions.
          // Object with actions/state merges those as additional known members.
          if (decl === true) {
            newStoreMembers.delete(name);
          } else {
            const existing = newStoreMembers.get(name) ?? new Set<string>();
            const merged = new Set(existing);
            if (decl.actions) for (const a of decl.actions) merged.add(a);
            if (decl.state) for (const s of decl.state) merged.add(s);
            newStoreMembers.set(name, merged);
          }
        }
      }
    }

    context = {
      ...context,
      storeNames: newStoreNames,
      storeMembers: newStoreMembers,
      ...(meta.components?.length && {
        componentNames: new Set([...context.componentNames, ...meta.components]),
      }),
    };
  }

  const errors: ValidationError[] = [];
  // `meta` is what makes a schema a template — a self-contained thing that must declare everything
  // it reads. Anything else is a fragment; see `WalkState.isFragment`.
  const state: WalkState = {
    localScope: null,
    localTypes: new Map<string, string>(),
    queryScope: new Set(),
    contextScope: new Set(),
    hasRoutesAncestor: false,
    isRouteEligible: true,
    isFragment: !meta,
  };

  walkNode(schema, '', context, state, errors);

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
  };
}

export function validateSchema(schema: unknown, context: ValidationContext): ValidationResult {
  const structural = validateStructure(schema);
  if (!structural.valid) return structural;

  const semantic = validateSemantic(schema, context);
  return {
    valid: semantic.errors.filter((e) => e.severity === 'error').length === 0,
    errors: [...structural.errors, ...semantic.errors],
  };
}
