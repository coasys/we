import type { DesignSystemProps, ElementState } from '@we/design-types';
import type { DSLayer } from '@we/design-utils';
import {
  getMarginValues,
  getPaddingValues,
  getRadiusValues,
  mapFlexAxes,
  marginKeys,
  paddingKeys,
  parseBorder,
  radiusKeys,
  tokenVar,
} from '@we/design-utils';

/**
 * Design System CSS Helpers
 *
 * Two responsibilities:
 * 1. Generate static CSS stylesheets (once per component class) that read CSS custom properties
 * 2. Update CSS custom properties on the host element at runtime based on DS props
 */

const ELEMENT_STATES: ElementState[] = ['hover', 'focus', 'active', 'disabled'];
const DEFAULT_TRANSITION = '0.2s';

// ────────────────────────────────────────────
// Runtime: CSS custom property updates
// ────────────────────────────────────────────

function setProperty(el: HTMLElement, name: string, value?: string) {
  if (value !== undefined && value !== null && value !== '') el.style.setProperty(name, value);
  else el.style.removeProperty(name);
}

/**
 * Sync border CSS custom properties. When the `border` shorthand is set, its
 * components (width, color, per-side values) are extracted and written as
 * sub-property vars so that static CSS declarations like
 * `border-color: var(--we-button-border-color)` resolve to the shorthand's
 * own values instead of becoming guaranteed-invalid. Explicit sub-property
 * overrides (e.g. borderColor) take priority over extracted values.
 */
function syncBorderVars(el: HTMLElement, prefix: string, props: Partial<DesignSystemProps>) {
  setProperty(el, `${prefix}border`, props.border ? parseBorder(props.border) : undefined);

  if (props.border) {
    const parsed = parseBorder(props.border);
    const parts = parsed.split(' ');
    if (parts.length >= 3) {
      const [width, , ...colorParts] = parts;
      const color = colorParts.join(' ');
      if (!props.borderColor) setProperty(el, `${prefix}border-color`, color);
      if (!props.borderWidth) setProperty(el, `${prefix}border-width`, width);
    }
    if (!props.borderTop) setProperty(el, `${prefix}border-top`, parsed);
    if (!props.borderRight) setProperty(el, `${prefix}border-right`, parsed);
    if (!props.borderBottom) setProperty(el, `${prefix}border-bottom`, parsed);
    if (!props.borderLeft) setProperty(el, `${prefix}border-left`, parsed);
  } else {
    setProperty(el, `${prefix}border-color`, props.borderColor ? tokenVar('color', props.borderColor, '') : undefined);
    setProperty(el, `${prefix}border-top`, props.borderTop ? parseBorder(props.borderTop) : undefined);
    setProperty(el, `${prefix}border-right`, props.borderRight ? parseBorder(props.borderRight) : undefined);
    setProperty(el, `${prefix}border-bottom`, props.borderBottom ? parseBorder(props.borderBottom) : undefined);
    setProperty(el, `${prefix}border-left`, props.borderLeft ? parseBorder(props.borderLeft) : undefined);
    setProperty(el, `${prefix}border-width`, props.borderWidth);
  }
  if (props.border && props.borderColor)
    setProperty(el, `${prefix}border-color`, tokenVar('color', props.borderColor, ''));
  if (props.border && props.borderWidth) setProperty(el, `${prefix}border-width`, props.borderWidth);
}

function updateCustomVars(
  el: HTMLElement,
  componentName: string,
  props: Partial<DesignSystemProps>,
  state?: ElementState,
) {
  const prefix = state ? `--we-${componentName}-${state}-` : `--we-${componentName}-`;

  // Layout: host positioning
  const hasMargin = marginKeys.some((k) => props[k] !== undefined && props[k] !== null);
  setProperty(el, `${prefix}width`, props.width);
  setProperty(el, `${prefix}height`, props.height);
  setProperty(el, `${prefix}min-width`, props.minWidth);
  setProperty(el, `${prefix}min-height`, props.minHeight);
  setProperty(el, `${prefix}max-width`, props.maxWidth);
  setProperty(el, `${prefix}max-height`, props.maxHeight);
  setProperty(el, `${prefix}position`, props.position);
  setProperty(el, `${prefix}top`, props.top);
  setProperty(el, `${prefix}right`, props.right);
  setProperty(el, `${prefix}bottom`, props.bottom);
  setProperty(el, `${prefix}left`, props.left);
  setProperty(el, `${prefix}z-index`, props.zIndex?.toString());
  setProperty(el, `${prefix}margin`, hasMargin ? getMarginValues(props) : undefined);

  // Visual
  setProperty(el, `${prefix}bg`, props.bg ? tokenVar('color', props.bg, '') : undefined);
  setProperty(el, `${prefix}color`, props.color ? tokenVar('color', props.color, '') : undefined);
  setProperty(el, `${prefix}opacity`, props.opacity?.toString());
  syncBorderVars(el, prefix, props);

  setProperty(el, `${prefix}shadow`, props.shadow ? tokenVar('shadow', props.shadow) : undefined);
  setProperty(el, `${prefix}ring`, props.ring ?? undefined);
  // Compose box-shadow from shadow + ring (both are optional, comma-separated when both present)
  const shadowVal = props.shadow ? tokenVar('shadow', props.shadow) : undefined;
  const ringVal = props.ring ?? undefined;
  if (shadowVal || ringVal) {
    const parts = [ringVal, shadowVal].filter(Boolean).join(', ');
    setProperty(el, `${prefix}box-shadow`, parts);
  } else {
    setProperty(el, `${prefix}box-shadow`, undefined);
  }
  setProperty(el, `${prefix}transform`, props.transform);
  setProperty(el, `${prefix}transition`, props.transition);
  setProperty(el, `${prefix}cursor`, props.cursor);
  setProperty(el, `${prefix}pointer-events`, props.pointerEvents);
  const hasRadius = radiusKeys.some((k) => props[k] !== undefined && props[k] !== null);
  setProperty(el, `${prefix}radius`, hasRadius ? getRadiusValues(props) : undefined);

  // Layout on base
  setProperty(el, `${prefix}display`, props.display);
  setProperty(el, `${prefix}overflow`, props.overflow);

  // Flex
  const { main, cross } = mapFlexAxes(props, props.direction ?? 'row');
  setProperty(el, `${prefix}direction`, props.direction);
  setProperty(el, `${prefix}main-axis`, main);
  setProperty(el, `${prefix}cross-axis`, cross);
  setProperty(el, `${prefix}wrap`, 'wrap' in props ? (props.wrap ? 'wrap' : 'nowrap') : undefined);
  setProperty(el, `${prefix}gap`, props.gap ? tokenVar('space', props.gap) : undefined);
  const hasPadding = paddingKeys.some((k) => props[k] !== undefined && props[k] !== null);
  setProperty(el, `${prefix}padding`, hasPadding ? getPaddingValues(props) : undefined);

  // Typography
  setProperty(el, `${prefix}text-align`, props.textAlign);
  setProperty(el, `${prefix}font-family`, props.fontFamily);
  setProperty(el, `${prefix}font-weight`, props.fontWeight);
  setProperty(el, `${prefix}font-size`, props.fontSize ? tokenVar('font-size', props.fontSize) : undefined);
  setProperty(el, `${prefix}line-height`, props.lineHeight ? tokenVar('line-height', props.lineHeight) : undefined);
  setProperty(
    el,
    `${prefix}letter-spacing`,
    props.letterSpacing ? tokenVar('letter-spacing', props.letterSpacing) : undefined,
  );
  setProperty(el, `${prefix}text-decoration`, props.textDecoration);
  setProperty(el, `${prefix}text-transform`, props.textTransform);
}

export function updateAllCustomVars(el: HTMLElement, componentName: string, props: Partial<DesignSystemProps>) {
  updateCustomVars(el, componentName, props);
  ELEMENT_STATES.forEach((state) => {
    const stateProps = props[`${state}Props`];
    if (stateProps && typeof stateProps === 'object') updateCustomVars(el, componentName, stateProps, state);
  });
}

// ────────────────────────────────────────────
// Static CSS generation (once per component class)
// ────────────────────────────────────────────

// Property spec: [css-property, var-suffix, default?]
type PropSpec = [string, string] | [string, string, string];

// Host properties (layout layer — outer box positioning)
const HOST_LAYOUT: PropSpec[] = [
  ['width', 'width'],
  ['height', 'height'],
  ['min-width', 'min-width'],
  ['min-height', 'min-height'],
  ['max-width', 'max-width'],
  ['max-height', 'max-height'],
  ['position', 'position'],
  ['top', 'top'],
  ['right', 'right'],
  ['bottom', 'bottom'],
  ['left', 'left'],
  ['z-index', 'z-index'],
  ['margin', 'margin'],
];

// Base properties by layer (inner element appearance/layout)
const BASE_VISUAL: PropSpec[] = [
  ['background', 'bg'],
  ['color', 'color'],
  ['opacity', 'opacity'],
  ['border', 'border'],
  ['border-color', 'border-color'],
  ['border-top', 'border-top'],
  ['border-right', 'border-right'],
  ['border-bottom', 'border-bottom'],
  ['border-left', 'border-left'],
  ['border-width', 'border-width'],
  ['box-shadow', 'box-shadow'],
  ['transform', 'transform'],
  ['cursor', 'cursor'],
  ['pointer-events', 'pointer-events'],
  ['border-radius', 'radius'],
];

const BASE_LAYOUT: PropSpec[] = [
  ['display', 'display', 'flex'],
  ['overflow', 'overflow'],
];

const BASE_FLEX: PropSpec[] = [
  ['flex-direction', 'direction'],
  ['justify-content', 'main-axis'],
  ['align-items', 'cross-axis'],
  ['flex-wrap', 'wrap'],
  ['gap', 'gap'],
  ['padding', 'padding'],
];

const BASE_TYPOGRAPHY: PropSpec[] = [
  ['text-align', 'text-align'],
  ['font-family', 'font-family'],
  ['font-weight', 'font-weight'],
  ['font-size', 'font-size'],
  ['font-style', 'font-style'],
  ['line-height', 'line-height'],
  ['letter-spacing', 'letter-spacing'],
  ['text-decoration', 'text-decoration'],
  ['text-transform', 'text-transform'],
];

// Generate a CSS declaration from a prop spec
function decl(prefix: string, [cssProp, varSuffix, fallback]: PropSpec): string {
  return fallback ? `${cssProp}: var(${prefix}${varSuffix}, ${fallback});` : `${cssProp}: var(${prefix}${varSuffix});`;
}

// Generate a state CSS declaration (falls back to default prefix)
function stateDecl(sp: string, dp: string, [cssProp, varSuffix, fallback]: PropSpec): string {
  const defaultRef = fallback ? `var(${dp}${varSuffix}, ${fallback})` : `var(${dp}${varSuffix})`;
  return `${cssProp}: var(${sp}${varSuffix}, ${defaultRef});`;
}

function joinDecls(prefix: string, specs: PropSpec[]): string {
  return specs.map((s) => decl(prefix, s)).join('\n    ');
}

function joinStateDecls(sp: string, dp: string, specs: PropSpec[]): string {
  return specs.map((s) => stateDecl(sp, dp, s)).join('\n    ');
}

/**
 * Generate static CSS string for a DS component. Called once per component class.
 * The CSS reads CSS custom properties that are set at runtime by updateAllCustomVars().
 */
export function getStaticDSStyles(componentName: string, layers?: readonly DSLayer[]): string {
  const l = new Set<DSLayer>(layers ?? ['layout', 'visual', 'flex', 'typography', 'state']);
  const p = `--we-${componentName}-`;

  const styles: string[] = [];

  // ── Host (:host) ──
  const hostLines: string[] = [`display: var(${p}host-display, flex);`];
  if (l.has('layout')) hostLines.push(joinDecls(p, HOST_LAYOUT));
  if (l.has('visual')) hostLines.push(`transition: var(${p}transition, ${DEFAULT_TRANSITION});`);
  styles.push(`:host { ${hostLines.join('\n    ')} }`);

  // ── Base ([part="base"]) ──
  const baseLines: string[] = ['width: 100%;', 'height: 100%;'];
  if (l.has('visual')) {
    baseLines.push(`transition: var(${p}transition, ${DEFAULT_TRANSITION});`);
    baseLines.push(joinDecls(p, BASE_VISUAL));
  }
  if (l.has('layout')) baseLines.push(joinDecls(p, BASE_LAYOUT));
  if (l.has('flex')) baseLines.push(joinDecls(p, BASE_FLEX));
  if (l.has('typography')) baseLines.push(joinDecls(p, BASE_TYPOGRAPHY));

  const hasBase = l.has('visual') || l.has('layout') || l.has('flex') || l.has('typography');
  if (hasBase) {
    styles.push(`[part='base'] { ${baseLines.join('\n    ')} }`);
  }

  // ── State selectors ──
  if (l.has('state')) {
    const hostSpecs: PropSpec[] = [];
    if (l.has('layout')) hostSpecs.push(...HOST_LAYOUT);

    const baseSpecs: PropSpec[] = [];
    if (l.has('visual')) baseSpecs.push(...BASE_VISUAL);
    if (l.has('layout')) baseSpecs.push(...BASE_LAYOUT);
    if (l.has('flex')) baseSpecs.push(...BASE_FLEX);
    if (l.has('typography')) baseSpecs.push(...BASE_TYPOGRAPHY);

    for (const state of ELEMENT_STATES) {
      const sp = `${p}${state}-`;

      // Host state
      if (hostSpecs.length > 0 || l.has('visual')) {
        const lines: string[] = [];
        if (l.has('visual'))
          lines.push(`transition: var(${sp}transition, var(${p}transition, ${DEFAULT_TRANSITION}));`);
        if (hostSpecs.length > 0) lines.push(joinStateDecls(sp, p, hostSpecs));
        const sel =
          state === 'disabled' ? ':host([disabled])' : `:host(:${state === 'focus' ? 'focus-within' : state})`;
        styles.push(`${sel} { ${lines.join('\n    ')} }`);
      }

      // Base state
      if (baseSpecs.length > 0) {
        const lines: string[] = [];
        if (l.has('visual'))
          lines.push(`transition: var(${sp}transition, var(${p}transition, ${DEFAULT_TRANSITION}));`);
        lines.push(joinStateDecls(sp, p, baseSpecs));
        const sel =
          state === 'disabled'
            ? `[part='base']:disabled, [part='base'][aria-disabled='true']`
            : `[part='base']:${state === 'focus' ? 'focus-within' : state}:not(:disabled):not([aria-disabled='true'])`;
        styles.push(`${sel} { ${lines.join('\n    ')} }`);
      }
    }
  }

  return styles.join('\n');
}
