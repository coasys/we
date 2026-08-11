import { BASE_CLASS_LAYERS, getKeysForLayers, layerKeyMap } from '@we/design-utils';

import type { ContextData, StateMemberMeta } from './contextTypes';
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
const CSS_LENGTH_RE = /^-?\d+(\.\d+)?(px|em|rem|%|vh|vw|vmin|vmax|ch|ex|cap|lh|svh|svw|dvh|dvw|cqi|cqb)$/;

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
  const universalProps = new Set(['style', 'styles', 'children', 'ref', 'key', 'title', 'id', 'class', 'tabindex']);

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

  // Walk children of operator nodes
  walkChildren(n, path, ctx, state, errors);
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
  if (hasState) for (const key of Object.keys(localState)) newFields.add(key);
  const newQueries = new Set(state.queryScope);
  if (hasQueries) for (const key of Object.keys(queries)) newQueries.add(key);
  // A `$localState` field on the same node shadows the hoisted query of that name, so the write
  // check below must not treat it as read-only any more.
  if (hasState) for (const key of Object.keys(localState)) newQueries.delete(key);
  for (const key of newQueries) newFields.add(key);
  return { ...state, localScope: newFields, queryScope: newQueries };
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

  for (const [propName, propValue] of Object.entries(props)) {
    // Skip internal schema props
    if (propName === '$localState') continue;

    const propPath = `${path}.props.${propName}`;

    // Check for token values in props (regardless of whether prop is known)
    checkTokenValue(propValue, propPath, ctx, state, errors);

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
        errors.push({
          path: propPath,
          message: `Unknown prop "${propName}" on "${componentType}"`,
          severity: 'warning',
        });
      }
      continue;
    }

    // Check prop type category (only for static values, not token objects)
    // Skip $-prefixed strings — these are dynamic references (e.g. $each iteration vars)
    if (propTypes && !isTokenObject(propValue) && typeof propValue !== 'object') {
      const isDynamicRef = typeof propValue === 'string' && propValue.startsWith('$');
      const expectedCategory = propTypes.get(propName);
      if (expectedCategory && expectedCategory !== 'unknown' && !isDynamicRef) {
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
        const acceptsCssLength = allowed.includes('{css-length}') && CSS_LENGTH_RE.test(propValue);
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

  // $store token
  if ('$store' in obj && typeof obj.$store === 'string') {
    checkStoreRef(obj.$store, `${path}.$store`, ctx, errors);
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

  // $local token
  if ('$local' in obj && typeof obj.$local === 'string') {
    checkLocalRef(obj.$local, `${path}.$local`, 'local', state, errors);
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

  if ('$callLocal' in obj && typeof obj.$callLocal === 'string') {
    checkLocalRef(obj.$callLocal, `${path}.$callLocal`, 'callLocal', state, errors);
  }

  // $error token
  if ('$error' in obj && typeof obj.$error === 'string') {
    checkLocalRef(obj.$error, `${path}.$error`, 'error', state, errors);
  }

  // $valid token
  if ('$valid' in obj && typeof obj.$valid === 'string') {
    checkLocalRef(obj.$valid, `${path}.$valid`, 'valid', state, errors);
  }

  // $touched token
  if ('$touched' in obj && typeof obj.$touched === 'string') {
    checkLocalRef(obj.$touched, `${path}.$touched`, 'touched', state, errors);
  }

  // $touch token
  if ('$touch' in obj && typeof obj.$touch === 'string') {
    if (obj.$touch !== '$all') {
      checkLocalRef(obj.$touch, `${path}.$touch`, 'touch', state, errors);
    }
  }

  // $formValid token — skip $scope
  if ('$formValid' in obj && typeof obj.$formValid === 'string') {
    // $formValid: "$scope" is always valid — skip
  }

  // $resetLocal token — skip $scope
  if ('$resetLocal' in obj && typeof obj.$resetLocal === 'string') {
    if (obj.$resetLocal !== '$scope') {
      checkLocalRef(obj.$resetLocal, `${path}.$resetLocal`, 'resetLocal', state, errors);
      checkLocalWrite(obj.$resetLocal, `${path}.$resetLocal`, 'resetLocal', state, errors);
    }
  }

  // Recurse into nested token objects ($if, $concat, $map, $eq, $ne, etc.)
  if ('$if' in obj && typeof obj.$if === 'object' && obj.$if !== null) {
    const ifObj = obj.$if as Record<string, unknown>;
    checkTokenValue(ifObj.condition, `${path}.$if.condition`, ctx, state, errors);
    checkTokenValue(ifObj.then, `${path}.$if.then`, ctx, state, errors);
    checkTokenValue(ifObj.else, `${path}.$if.else`, ctx, state, errors);
  }

  if ('$concat' in obj && Array.isArray(obj.$concat)) {
    for (let i = 0; i < obj.$concat.length; i++) {
      checkTokenValue(obj.$concat[i], `${path}.$concat[${i}]`, ctx, state, errors);
    }
  }

  if ('$map' in obj && typeof obj.$map === 'object' && obj.$map !== null) {
    const mapObj = obj.$map as Record<string, unknown>;
    // `items`, not `source` — this read the wrong key since it was written, so a bad `$store`
    // inside a `$map`'s source was never reported.
    checkTokenValue(mapObj.items, `${path}.$map.items`, ctx, state, errors);
    if (mapObj.select && typeof mapObj.select === 'object') {
      for (const [k, v] of Object.entries(mapObj.select as Record<string, unknown>)) {
        checkMapSelectValue(v, `${path}.$map.select.${k}`, errors);
        checkTokenValue(v, `${path}.$map.select.${k}`, ctx, state, errors);
      }
    }
  }

  if ('$not' in obj) {
    checkTokenValue(obj.$not, `${path}.$not`, ctx, state, errors);
  }

  if ('$eq' in obj && Array.isArray(obj.$eq)) {
    for (let i = 0; i < obj.$eq.length; i++) {
      checkTokenValue(obj.$eq[i], `${path}.$eq[${i}]`, ctx, state, errors);
    }
  }

  if ('$ne' in obj && Array.isArray(obj.$ne)) {
    for (let i = 0; i < obj.$ne.length; i++) {
      checkTokenValue(obj.$ne[i], `${path}.$ne[${i}]`, ctx, state, errors);
    }
  }

  if ('$lt' in obj && Array.isArray(obj.$lt)) {
    for (let i = 0; i < obj.$lt.length; i++) {
      checkTokenValue(obj.$lt[i], `${path}.$lt[${i}]`, ctx, state, errors);
    }
  }

  if ('$gt' in obj && Array.isArray(obj.$gt)) {
    for (let i = 0; i < obj.$gt.length; i++) {
      checkTokenValue(obj.$gt[i], `${path}.$gt[${i}]`, ctx, state, errors);
    }
  }

  if ('$and' in obj && Array.isArray(obj.$and)) {
    for (let i = 0; i < obj.$and.length; i++) {
      checkTokenValue(obj.$and[i], `${path}.$and[${i}]`, ctx, state, errors);
    }
  }

  if ('$or' in obj && Array.isArray(obj.$or)) {
    for (let i = 0; i < obj.$or.length; i++) {
      checkTokenValue(obj.$or[i], `${path}.$or[${i}]`, ctx, state, errors);
    }
  }

  /*
    The array operators, whose internals were unchecked for the same reason `$query`'s were: their
    payload is a plain object, and everything above only recurses through shapes it recognises.

    `items` is the one that matters — it routinely holds a `$store` or a whole `$query`, and a typo in
    either produced an empty list and no complaint. `where` values are checked too, since they take
    the same tokens.
  */
  for (const op of ['$filter', '$find', '$count'] as const) {
    if (op in obj && typeof obj[op] === 'object' && obj[op] !== null) {
      const spec = obj[op] as Record<string, unknown>;
      checkNestedTokens(spec.items, `${path}.${op}.items`, ctx, state, errors);
      if (spec.where) checkNestedTokens(spec.where, `${path}.${op}.where`, ctx, state, errors);
    }
  }

  if ('$plural' in obj && typeof obj.$plural === 'object' && obj.$plural !== null) {
    checkNestedTokens((obj.$plural as Record<string, unknown>).count, `${path}.$plural.count`, ctx, state, errors);
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

function checkStoreRef(ref: string, path: string, ctx: ValidationContext, errors: ValidationError[]): void {
  const dotIdx = ref.indexOf('.');
  const storeName = dotIdx === -1 ? ref : ref.slice(0, dotIdx);

  if (!ctx.storeNames.has(storeName)) {
    const known = [...ctx.storeNames].join(', ');
    errors.push({
      path,
      message: `Unknown store "${storeName}" in $store token. Known stores: ${known}`,
      severity: 'error',
    });
    return;
  }

  if (dotIdx === -1) return;

  // Split remaining path: e.g. "sharedSpaces.length" → ["sharedSpaces", "length"]
  const rest = ref.slice(dotIdx + 1);
  const segments = rest.split('.');
  const rootMember = segments[0];

  // Validate root member exists on store
  const members = ctx.storeMembers.get(storeName);
  if (members && !members.has(rootMember)) {
    const known = [...members].join(', ');
    errors.push({
      path,
      message: `Unknown member "${rootMember}" on store "${storeName}". Known members: ${known}`,
      severity: 'warning',
    });
    return;
  }

  // Validate nested property access if type metadata is available
  if (segments.length > 1) {
    const meta = ctx.storeMemberMeta.get(storeName)?.get(rootMember);
    if (meta) {
      const nestedProp = segments[1];
      // .length is always valid on arrays
      if (meta.type === 'array' && nestedProp === 'length') return;
      // Check against known properties
      if (meta.properties && !meta.properties.includes(nestedProp)) {
        const known = meta.properties.join(', ');
        errors.push({
          path,
          message: `Unknown property "${nestedProp}" on "${storeName}.${rootMember}" (${meta.type}). Known properties: ${known}`,
          severity: 'warning',
        });
      }
    }
  }
}

/**
 * An `$event`/`$arg` reference buried inside an operator object in `$action` args can never resolve.
 *
 * Args are resolved once at render time, and only a *bare* `'$event.detail'` string survives that
 * pass to be substituted at call time. Wrap one in `$not`, `$if`, `$concat` — anything — and the
 * operator evaluates immediately, against a context with no event in it, where the reference is
 * just an unresolved `$`-string. That string is truthy, so the argument silently becomes a
 * constant: `{ $not: '$event.detail' }` is always `false`, and a switch bound to it only ever
 * sends one value.
 *
 * Nothing errors at runtime — the store is handed a plausible argument — so this is only findable
 * by noticing a control that does not work. Twice now, hence a rule. Pass the raw value and let the
 * store do the mapping, or take what the event emits directly.
 */
function checkActionArgs(args: unknown[], path: string, errors: ValidationError[]): void {
  const isEventRef = (v: unknown): v is string =>
    typeof v === 'string' && (v === '$event' || v === '$arg' || v.startsWith('$event.') || v.startsWith('$arg.'));

  const walk = (value: unknown, at: string, insideOperator: boolean): void => {
    if (isEventRef(value)) {
      if (insideOperator) {
        errors.push({
          path: at,
          message:
            `"${value}" is nested inside an operator, where it is evaluated before the event exists ` +
            `and resolves to a constant. Pass it as a bare argument and map the value in the store.`,
          severity: 'error',
        });
      }
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
 * A `$map` `select` value that looks like a reference but is resolved as a literal.
 *
 * `resolveSelectValue` substitutes a string only when it starts with `'$item.'`. Everything else is
 * passed through untouched, so a bare `'$item'` becomes the five characters `$item` — identical for
 * every row. Four participant stacks seeded their avatars that way and rendered the same generated
 * face for everybody, which reads as a styling quirk rather than as a bug, and survived four
 * separate reviews. The fix is a token object (`{ $concat: ['$item'] }`), which is always resolved.
 *
 * `'$item'` is an error because it is never intentional. Other `$`-strings are a warning: a literal
 * beginning with `$` is legal, just very rarely what somebody meant to write.
 */
function checkMapSelectValue(value: unknown, path: string, errors: ValidationError[]): void {
  if (typeof value !== 'string' || !value.startsWith('$')) return;
  if (value.startsWith('$item.')) return;

  if (value === '$item') {
    errors.push({
      path,
      message:
        `"$item" in a $map select is resolved as a literal, not as the current item — only ` +
        `"$item.<path>" is substituted. Every row will get the same value. ` +
        `Use { "$concat": ["$item"] } instead.`,
      severity: 'error',
    });
    return;
  }

  errors.push({
    path,
    message:
      `"${value}" in a $map select is passed through as a literal string. Only "$item.<path>" is ` +
      `substituted; wrap a context reference in a token object to have it resolved.`,
    severity: 'warning',
  });
}

/**
 * A write to a name a `$queries` entry owns.
 *
 * `$queries` and `$localState` share one `$local` namespace so a reader need not care which
 * declared a name — but query results are read-only. `$setLocal` against one warns and no-ops, so
 * the control renders, accepts the click, and does nothing at all.
 */
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

  // Walk route nodes. isRouteEligible = true so route entries themselves may define sub-routes.
  const routeState = { ...state, hasRoutesAncestor: true, isRouteEligible: true };
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
      if (typeof child === 'object' && child !== null) {
        walkNode(child, `${path}.children[${i}]`, ctx, childState, errors);
      }
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
    queryScope: new Set(),
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
