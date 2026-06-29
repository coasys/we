import { BASE_CLASS_LAYERS, getKeysForLayers } from '@we/design-utils';

import type { ContextData, PropEntry } from './contextTypes';

// ── Public types ────────────────────────────────────────────────────────────

export type PropLayer = 'component' | 'size' | 'position' | 'spacing' | 'flex' | 'visual' | 'typography' | 'state';

export interface PropMeta {
  name: string;
  /** Valid token / enum choices — present means show combobox, absent means free text */
  options?: string[];
  valueType: 'string' | 'boolean' | 'number';
  layer: PropLayer;
  optional: boolean;
}

export interface ComponentMeta {
  typeName: string;
  superclass?: string;
  /** All props available for this component (own + DS), deduped, layer-ordered */
  props: PropMeta[];
}

// ── Token option lists ──────────────────────────────────────────────────────

const SPACE = ['0', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000'];

const RADIUS = ['0', '100', '200', '300', '400', '500', '600', '700', '800', '900', 'pill', 'full'];

const SHADOW = ['sm', 'md', 'lg', 'xl'];

const COLOR_HUES = ['neutral', 'primary', 'success', 'warning', 'danger'];
const COLOR_SHADES = ['0', '25', '50', '75', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000'];
const COLOR = ['white', 'black', ...COLOR_HUES.flatMap((h) => COLOR_SHADES.map((l) => `${h}-${l}`))];

const FONT_SIZE = ['base', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000'];
const FONT_WEIGHT = [
  'regular',
  'medium',
  'semibold',
  'bold',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
];
const LINE_HEIGHT = ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose'];
const LETTER_SPACING = ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'];
const FONT_FAMILY = ['base', 'mozilla', 'boldonse'];

/** DS prop name → valid token / enum options */
const DS_PROP_OPTIONS: Record<string, string[]> = {
  // spacing (margins + padding + gap)
  m: SPACE,
  mx: SPACE,
  my: SPACE,
  mt: SPACE,
  mr: SPACE,
  mb: SPACE,
  ml: SPACE,
  p: SPACE,
  px: SPACE,
  py: SPACE,
  pt: SPACE,
  pr: SPACE,
  pb: SPACE,
  pl: SPACE,
  gap: SPACE,
  // radius
  r: RADIUS,
  rt: RADIUS,
  rb: RADIUS,
  rl: RADIUS,
  rr: RADIUS,
  rtl: RADIUS,
  rtr: RADIUS,
  rbr: RADIUS,
  rbl: RADIUS,
  // color
  bg: COLOR,
  color: COLOR,
  borderColor: COLOR,
  // shadow
  shadow: SHADOW,
  // typography
  fontSize: FONT_SIZE,
  fontWeight: FONT_WEIGHT,
  lineHeight: LINE_HEIGHT,
  letterSpacing: LETTER_SPACING,
  fontFamily: FONT_FAMILY,
  // enums
  textAlign: ['left', 'center', 'right', 'justify'],
  textDecoration: ['underline', 'line-through', 'overline', 'none'],
  textTransform: ['uppercase', 'lowercase', 'capitalize', 'none'],
  cursor: ['pointer', 'default', 'text', 'not-allowed'],
  pointerEvents: ['none', 'auto'],
  visibility: ['visible', 'hidden', 'collapse'],
  display: ['flex', 'block', 'inline', 'inline-block', 'grid', 'inline-flex'],
  position: ['relative', 'absolute', 'fixed', 'sticky'],
  overflow: ['hidden', 'auto', 'overlay'],
  overflowX: ['hidden', 'auto', 'overlay'],
  overflowY: ['hidden', 'auto', 'overlay'],
  direction: ['row', 'row-reverse', 'column', 'column-reverse'],
  ax: ['start', 'center', 'end', 'between', 'around', 'even', 'stretch'],
  ay: ['start', 'center', 'end', 'between', 'around', 'even', 'stretch'],
  bgFit: ['cover', 'contain'],
  scrollbarWidth: ['auto', 'thin', 'none'],
  scrollbarGutter: ['auto', 'stable', 'stable both-edges'],
};

/**
 * Fallback: token type alias name → options.
 * Used when a prop type is an opaque alias (e.g. "SpaceValue") rather than a resolved literal union.
 * Covers both @we/primitives (CEM extraction) and @we/components (TypeScript extraction).
 */
const TYPE_ALIAS_OPTIONS: Record<string, string[]> = {
  SpaceValue: SPACE,
  SpaceToken: SPACE,
  ColorValue: COLOR,
  ColorToken: COLOR,
  RadiusValue: RADIUS,
  RadiusToken: RADIUS,
  ShadowValue: SHADOW,
  ShadowToken: SHADOW,
  FontSizeValue: FONT_SIZE,
  FontSizeToken: FONT_SIZE,
  FontWeight: FONT_WEIGHT,
  FontWeightToken: FONT_WEIGHT,
  LineHeightValue: LINE_HEIGHT,
  LineHeightToken: LINE_HEIGHT,
  LetterSpacingValue: LETTER_SPACING,
  LetterSpacingToken: LETTER_SPACING,
  FontFamilyValue: FONT_FAMILY,
  FontFamilyToken: FONT_FAMILY,
  // Flex axis type aliases (from @we/design-types)
  FlexMainAxis: ['start', 'center', 'end', 'between', 'around', 'even'],
  FlexCrossAxis: ['start', 'center', 'end', 'stretch'],
  FlexDirection: ['row', 'row-reverse', 'column', 'column-reverse'],
  // Other enum aliases
  Display: ['flex', 'block', 'inline', 'inline-block', 'grid', 'inline-flex'],
  Position: ['relative', 'absolute', 'fixed', 'sticky'],
  Overflow: ['hidden', 'auto', 'overlay'],
  TextAlign: ['left', 'center', 'right', 'justify'],
  TextDecoration: ['underline', 'line-through', 'overline', 'none'],
  TextTransform: ['uppercase', 'lowercase', 'capitalize', 'none'],
  Cursor: ['pointer', 'default', 'text', 'not-allowed'],
  PointerEvents: ['none', 'auto'],
  Visibility: ['visible', 'hidden', 'collapse'],
  ScrollbarWidth: ['auto', 'thin', 'none'],
  ScrollbarGutter: ['auto', 'stable', 'stable both-edges'],
  ComponentSize: ['xs', 'sm', 'md', 'lg', 'xl'],
  ComponentVariant: ['neutral', 'primary', 'success', 'warning', 'danger'],
};

// ── Editor layer key index ──────────────────────────────────────────────────
// Maps every DS prop key to its editor layer. Independent of DSLayer (runtime)
// so we can group props differently in the panel without touching @we/design-utils.

const EDITOR_LAYER_FOR_KEY: Record<string, PropLayer> = {
  // Size — dimensions, display, overflow
  width: 'size',
  height: 'size',
  minWidth: 'size',
  minHeight: 'size',
  maxWidth: 'size',
  maxHeight: 'size',
  display: 'size',
  flex: 'size',
  alignSelf: 'size',
  overflow: 'size',
  overflowX: 'size',
  overflowY: 'size',
  scrollbarWidth: 'size',
  scrollbarGutter: 'size',
  // Position — positioning in the page flow
  position: 'position',
  top: 'position',
  right: 'position',
  bottom: 'position',
  left: 'position',
  zIndex: 'position',
  // Spacing — padding + margin (box model)
  p: 'spacing',
  px: 'spacing',
  py: 'spacing',
  pt: 'spacing',
  pr: 'spacing',
  pb: 'spacing',
  pl: 'spacing',
  m: 'spacing',
  mx: 'spacing',
  my: 'spacing',
  mt: 'spacing',
  mr: 'spacing',
  mb: 'spacing',
  ml: 'spacing',
  // Flex — container arrangement
  direction: 'flex',
  ax: 'flex',
  ay: 'flex',
  wrap: 'flex',
  gap: 'flex',
  // Visual — appearance, decoration, borders, radius
  bg: 'visual',
  bgImage: 'visual',
  bgFit: 'visual',
  bgPosition: 'visual',
  color: 'visual',
  opacity: 'visual',
  shadow: 'visual',
  ring: 'visual',
  cursor: 'visual',
  pointerEvents: 'visual',
  visibility: 'visual',
  transform: 'visual',
  transition: 'visual',
  border: 'visual',
  borderColor: 'visual',
  borderTop: 'visual',
  borderRight: 'visual',
  borderBottom: 'visual',
  borderLeft: 'visual',
  borderWidth: 'visual',
  r: 'visual',
  rt: 'visual',
  rb: 'visual',
  rl: 'visual',
  rr: 'visual',
  rtl: 'visual',
  rtr: 'visual',
  rbr: 'visual',
  rbl: 'visual',
  // Typography
  textAlign: 'typography',
  fontFamily: 'typography',
  fontWeight: 'typography',
  fontSize: 'typography',
  lineHeight: 'typography',
  letterSpacing: 'typography',
  textDecoration: 'typography',
  textTransform: 'typography',
};

// ── Skip filter ─────────────────────────────────────────────────────────────

const SKIP_TYPE_FRAGMENTS = ['=>', 'Record<', '[]', 'HTMLElement', 'JSX', 'Partial<', 'File', 'PerspectiveProxy'];
const SKIP_PROP_NAMES = new Set(['hoverProps', 'activeProps', 'focusProps', 'disabledProps', 'selectedProps']);

function isComplexType(raw: string): boolean {
  return SKIP_TYPE_FRAGMENTS.some((f) => raw.includes(f));
}

// ── PropEntry parsing ────────────────────────────────────────────────────────

/**
 * Parse a PropEntry into editor metadata.
 * Resolves boolean/number types and string-literal unions.
 * Falls back to TYPE_ALIAS_OPTIONS for known token type alias names.
 */
function parsePropEntry(entry: PropEntry, layer: PropLayer): PropMeta {
  // Strip optional modifier
  const raw = entry.type
    .replace(/\s*\|\s*undefined$/, '')
    .replace(/^\s*undefined\s*\|\s*/, '')
    .trim();

  if (raw === 'boolean') {
    return { name: entry.name, valueType: 'boolean', layer, optional: entry.optional };
  }

  if (raw === 'number') {
    return { name: entry.name, valueType: 'number', layer, optional: entry.optional };
  }

  // Resolved string-literal union: "'a' | 'b' | 'c'"
  const literalRe = /^(?:'[^']*'(?:\s*\|\s*'[^']*')*)\s*$/;
  if (literalRe.test(raw)) {
    const options =
      raw
        .match(/'([^']*)'/g)
        ?.map((s) => s.slice(1, -1))
        .filter(Boolean) ?? [];
    return { name: entry.name, valueType: 'string', options, layer, optional: entry.optional };
  }

  // Unresolved type alias — check the TYPE_ALIAS_OPTIONS map
  const aliasOptions = TYPE_ALIAS_OPTIONS[raw];
  if (aliasOptions) {
    return { name: entry.name, valueType: 'string', options: aliasOptions, layer, optional: entry.optional };
  }

  // Compound alias with | undefined already stripped — try each part
  // e.g. "SpaceValue | string" → try SpaceValue
  for (const part of raw.split('|').map((p) => p.trim())) {
    const partOptions = TYPE_ALIAS_OPTIONS[part];
    if (partOptions) {
      return { name: entry.name, valueType: 'string', options: partOptions, layer, optional: entry.optional };
    }
  }

  return { name: entry.name, valueType: 'string', layer, optional: entry.optional };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build prop metadata for a schema node type.
 *
 * Resolution priority for each prop:
 *  1. If the prop name is a known DS key (in LAYER_FOR_KEY), assign to DS layer
 *     and use DS_PROP_OPTIONS — this handles @we/components where DS props appear
 *     in the TS interface rather than being filtered by the CEM layer mechanism.
 *  2. Otherwise treat as a component-specific prop and parse from the type string,
 *     including TYPE_ALIAS_OPTIONS fallback for unresolved token type aliases.
 *  3. DS layer props (from BASE_CLASS_LAYERS) are added after ownProps for
 *     @we/primitives where they are absent from ownProps by CEM convention.
 *
 * Props are deduped by name (ownProps wins if both sources emit the same key).
 */
export function getComponentMeta(typeName: string, contextData: ContextData): ComponentMeta | null {
  const primitive = contextData.primitives.find((p) => p.tagName === typeName);
  const component = contextData.components.find((c) => c.name === typeName);

  const entry = primitive ?? component;
  if (!entry) return null;

  const superclass = entry.superclass;
  const dsLayers = superclass && BASE_CLASS_LAYERS[superclass] ? BASE_CLASS_LAYERS[superclass] : [];
  const dsKeys = new Set(getKeysForLayers(dsLayers));

  const seenNames = new Set<string>();
  const props: PropMeta[] = [];

  // ── 1. Own / component-specific props ──────────────────────────────────
  const ownProps = 'ownProps' in entry ? entry.ownProps : entry.props;
  for (const prop of ownProps) {
    if (SKIP_PROP_NAMES.has(prop.name)) continue;
    if (isComplexType(prop.type)) continue;
    if (seenNames.has(prop.name)) continue;

    const editorLayer = EDITOR_LAYER_FOR_KEY[prop.name];
    if (editorLayer) {
      // This prop is a known DS key — use editor layer and options
      props.push({
        name: prop.name,
        options: DS_PROP_OPTIONS[prop.name],
        valueType: 'string',
        layer: editorLayer,
        optional: prop.optional,
      });
    } else {
      // Component-specific prop — parse from type string
      props.push(parsePropEntry(prop, 'component'));
    }
    seenNames.add(prop.name);
  }

  // ── 2. DS layer props not already emitted (for @we/primitives with superclass) ──
  for (const key of dsKeys) {
    if (seenNames.has(key)) continue;
    if (SKIP_PROP_NAMES.has(key)) continue;
    const layer = EDITOR_LAYER_FOR_KEY[key] ?? 'size';
    props.push({
      name: key,
      options: DS_PROP_OPTIONS[key],
      valueType: 'string',
      layer,
      optional: true,
    });
    seenNames.add(key);
  }

  return { typeName, superclass, props };
}
