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
        // DS props are all string-typed (token values)
        propTypes.set(key, 'string');
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

  // Models
  const modelNames = new Set<string>();
  for (const model of data.models) {
    modelNames.add(model.name);
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
  hasRoutesAncestor: boolean;
  /** True only for the root template node and for route entry nodes — the positions the router
   *  actually reads routes arrays from. Child nodes that are not route entries must never own
   *  a routes array; if they do, nothing will render (the router never sees it). */
  isRouteEligible: boolean;
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
  if (!type || typeof type !== 'string') return;

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

  // Check props
  const props = n.props as Record<string, unknown> | undefined;
  if (props && typeof props === 'object') {
    checkProps(props, path, type, ctx, state, errors);
  }

  // Update local scope if $localState is present
  const newState = updateLocalScope(n, state);

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

  if (type === '$each') {
    // Walk the item template
    if (props.item && typeof props.item === 'object') {
      walkNode(props.item, `${path}.props.item`, ctx, state, errors);
    }
  }

  if (type === '$if') {
    checkTokenValue(props.condition, `${path}.props.condition`, ctx, state, errors);
    if (props.then && typeof props.then === 'object' && !isTokenObject(props.then)) {
      walkNode(props.then, `${path}.props.then`, ctx, state, errors);
    } else if (props.then) {
      checkTokenValue(props.then, `${path}.props.then`, ctx, state, errors);
    }
    if (props.else && typeof props.else === 'object' && !isTokenObject(props.else)) {
      walkNode(props.else, `${path}.props.else`, ctx, state, errors);
    } else if (props.else) {
      checkTokenValue(props.else, `${path}.props.else`, ctx, state, errors);
    }
  }

  // Walk children of operator nodes
  walkChildren(n, path, ctx, state, errors);
}

function updateLocalScope(n: Record<string, unknown>, state: WalkState): WalkState {
  // $localState lives on the node itself (sibling of type/props/children), not inside props
  const localState = n.$localState as Record<string, unknown> | undefined;
  if (!localState || typeof localState !== 'object') return state;

  const newFields = new Set(state.localScope ?? []);
  for (const key of Object.keys(localState)) {
    newFields.add(key);
  }
  return { ...state, localScope: newFields };
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
  }

  // $query token
  if ('$query' in obj && typeof obj.$query === 'object' && obj.$query !== null) {
    const query = obj.$query as Record<string, unknown>;
    if (typeof query.model === 'string') {
      checkModelRef(query.model, `${path}.$query.model`, ctx, errors);
    }
  }

  // $local token
  if ('$local' in obj && typeof obj.$local === 'string') {
    checkLocalRef(obj.$local, `${path}.$local`, 'local', state, errors);
  }

  // $setLocal token
  if ('$setLocal' in obj && typeof obj.$setLocal === 'string') {
    checkLocalRef(obj.$setLocal, `${path}.$setLocal`, 'setLocal', state, errors);
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
    // $resetLocal: "$scope" is always valid — skip
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
    checkTokenValue(mapObj.source, `${path}.$map.source`, ctx, state, errors);
    if (mapObj.select && typeof mapObj.select === 'object') {
      for (const [k, v] of Object.entries(mapObj.select as Record<string, unknown>)) {
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
    errors.push({
      path,
      message: `$${tokenType} references "${fieldName}" but no $localState is declared in scope`,
      severity: 'error',
    });
    return;
  }

  if (!state.localScope.has(fieldName)) {
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
  const state: WalkState = { localScope: null, hasRoutesAncestor: false, isRouteEligible: true };

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
