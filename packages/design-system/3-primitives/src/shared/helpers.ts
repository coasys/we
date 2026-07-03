import type { DesignSystemProps, ElementState } from '@we/design-types';
import type { DSLayer, PropSpec } from '@we/design-utils';
import {
  BASE_FLEX_SPECS as BASE_FLEX,
  BASE_LAYOUT_SPECS as BASE_LAYOUT,
  BASE_TYPOGRAPHY_SPECS as BASE_TYPOGRAPHY,
  BASE_VISUAL_SPECS as BASE_VISUAL,
  computeBgImageComposite,
  declCSS as decl,
  getMarginValues,
  getPaddingValues,
  getRadiusValues,
  HOST_LAYOUT_SPECS as HOST_LAYOUT,
  isBgImageFaded,
  joinDeclsCSS as joinDecls,
  joinStateDeclsCSS as joinStateDecls,
  mapFlexAxes,
  marginKeys,
  paddingKeys,
  parseBorder,
  radiusKeys,
  resolveBgImageUrl,
  resolveFontFamily,
  resolveFontWeight,
  resolveLineHeight,
  stateDeclCSS as stateDecl,
  tokenVar,
  zIndexVar,
} from '@we/design-utils';

/**
 * Design System CSS Helpers
 *
 * Two responsibilities:
 * 1. Generate static CSS stylesheets (once per component class) that read CSS custom properties
 * 2. Update CSS custom properties on the host element at runtime based on DS props
 */

const ELEMENT_STATES: ElementState[] = ['hover', 'focus', 'active', 'disabled'];

// ────────────────────────────────────────────
// Component cascade configuration
// ────────────────────────────────────────────

/**
 * Per-component cascade config. When set, the static CSS emits a fallback
 * chain for radius and padding rather than a bare var():
 *
 *   border-radius: var(--we-button-radius,          ← explicit r= prop
 *     var(--we-theme-button-radius,                 ← component-specific theme override
 *       var(--we-theme-control-radius,              ← group theme override
 *         var(--we-button-size-radius,              ← size-aware structural default (CSS host rule)
 *           var(--we-radius-400)))));               ← absolute token fallback
 *
 * radiusDefault and paddingDefault are optional. When absent, getStaticDSStyles()
 * auto-derives them from the component's DEFAULT_PROPS (via getPaddingValues /
 * getRadiusValues). Only set them explicitly when the value cannot be derived —
 * e.g. button's size-aware radius chain, or wrapper components that have no r/px
 * in DEFAULT_PROPS but still need a non-zero cascade fallback.
 */
interface ComponentCascade {
  radiusGroup?: string; // e.g. '--we-theme-control-radius'
  radiusDefault?: string; // explicit override; omit to auto-derive from DEFAULT_PROPS
  paddingGroup?: string; // e.g. '--we-theme-control-padding-x'
  paddingDefault?: string; // explicit override; omit to auto-derive from DEFAULT_PROPS
  nativePadding?: boolean; // if true, padding is omitted from [part='base'] — the component owns it in CSS_STYLES
  gapGroup?: string; // e.g. '--we-theme-control-gap'
  gapDefault?: string; // explicit override; omit to auto-derive from DEFAULT_PROPS
}

const COMPONENT_CASCADE: Record<string, ComponentCascade> = {
  // Media
  avatar: { radiusDefault: '50%' },
  // Controls
  button: {
    radiusGroup: '--we-theme-control-radius',
    // Explicit: size-aware CSS var chain — not derivable from DEFAULT_PROPS alone.
    radiusDefault: 'var(--we-button-size-radius, var(--we-radius-400))',
    // Padding is owned by CSS_STYLES (x-only, 0 y) — nativePadding suppresses the generic declaration.
    nativePadding: true,
    gapGroup: '--we-theme-control-gap',
    gapDefault: 'var(--we-button-size-gap, var(--we-space-300))',
  },
  badge: {
    radiusGroup: '--we-theme-control-radius',
    nativePadding: true,
    gapGroup: '--we-theme-control-gap',
    gapDefault: 'var(--we-badge-size-gap, 0)',
  },
  tag: { radiusGroup: '--we-theme-control-radius', nativePadding: true },
  checkbox: { gapGroup: '--we-theme-control-gap', gapDefault: 'var(--we-space-200)' },
  radio: { gapGroup: '--we-theme-control-gap', gapDefault: 'var(--we-space-200)' },
  switch: { gapGroup: '--we-theme-control-gap', gapDefault: 'var(--we-space-200)' },
  slider: { gapGroup: '--we-theme-control-gap', gapDefault: 'var(--we-space-300)' },
  'menu-item': {
    paddingGroup: '--we-theme-control-padding-x',
    gapGroup: '--we-theme-control-gap',
    gapDefault: 'var(--we-space-300)',
  },
  'progress-bar': { radiusGroup: '--we-theme-control-radius' },
  // Inputs
  input: { radiusGroup: '--we-theme-input-radius', paddingGroup: '--we-theme-input-spacing' },
  textarea: { radiusGroup: '--we-theme-input-radius', nativePadding: true },
  select: {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: wrapper — no r in DEFAULT_PROPS
    paddingGroup: '--we-theme-input-spacing',
    paddingDefault: '0', // Explicit: wrapper div — inner parts own their own padding
  },
  'number-input': {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: intentionally matches input theme, not DEFAULT_PROPS r:'400'
    paddingGroup: '--we-theme-input-spacing',
    paddingDefault: '0 var(--we-space-300)', // Explicit: no px in DEFAULT_PROPS
  },
  'date-picker': {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: wrapper — no r in DEFAULT_PROPS
    paddingGroup: '--we-theme-input-spacing',
    paddingDefault: '0', // Explicit: wrapper div — inner parts own their own padding
  },
  'color-picker': {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: wrapper — no r in DEFAULT_PROPS
    paddingGroup: '--we-theme-input-spacing',
    paddingDefault: '0', // Explicit: wrapper div — inner parts own their own padding
  },
  'icon-picker': {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: wrapper — no r in DEFAULT_PROPS
  },
  'file-upload': { radiusGroup: '--we-theme-input-radius', paddingGroup: '--we-theme-surface-spacing' },
  'form-field': {
    radiusGroup: '--we-theme-input-radius',
    radiusDefault: 'var(--we-radius-300)', // Explicit: wrapper — no r in DEFAULT_PROPS
    gapGroup: '--we-theme-control-gap',
    gapDefault: 'var(--we-space-100)',
  },
  // Tabs
  tab: { radiusGroup: '--we-theme-control-radius', paddingGroup: '--we-theme-tab-spacing' },
  // Surfaces
  modal: {
    radiusGroup: '--we-theme-surface-radius',
    paddingGroup: '--we-theme-surface-spacing',
    gapGroup: '--we-theme-surface-gap',
  },
  drawer: {
    radiusGroup: '--we-theme-surface-radius',
    paddingGroup: '--we-theme-surface-spacing',
    gapGroup: '--we-theme-surface-gap',
  },
  menu: { radiusGroup: '--we-theme-surface-radius', nativePadding: true },
  alert: {
    radiusGroup: '--we-theme-surface-radius',
    paddingGroup: '--we-theme-surface-spacing',
    gapGroup: '--we-theme-surface-gap',
  },
  blockquote: { radiusGroup: '--we-theme-surface-radius', paddingGroup: '--we-theme-surface-spacing' },
  code: { radiusGroup: '--we-theme-surface-radius' },
};

const DEFAULT_TRANSITION = 'all var(--we-transition-200, 150ms) ease';

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
  rawExplicitProps?: Partial<DesignSystemProps>,
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
  setProperty(el, `${prefix}z-index`, zIndexVar(props.zIndex));
  setProperty(el, `${prefix}margin`, hasMargin ? getMarginValues(props) : undefined);
  setProperty(el, `${prefix}flex`, props.flex);
  setProperty(el, `${prefix}align-self`, props.alignSelf);

  // Visual
  setProperty(el, `${prefix}bg`, props.bg ? tokenVar('color', props.bg, '') : undefined);
  setProperty(el, `${prefix}color`, props.color ? tokenVar('color', props.color, '') : undefined);
  setProperty(el, `${prefix}opacity`, props.opacity?.toString());
  syncBorderVars(el, prefix, props);

  // bg-image — faded images render via a ::before overlay (see getStaticDSStyles),
  // since bgImageOpacity needs the image on its own paint layer, independent of the
  // element's own content — CSS can't scope opacity to one background layer. The
  // unfaded (common) case bypasses that entirely and sets a plain background-image
  // directly on [part='base'] instead — no pseudo-element, no custom-property
  // indirection, same as before bgImageOpacity existed. Both paths resolve the URL
  // through resolveBgImageUrl (data URI -> short-lived object URL): a large base64
  // payload embedded as a CSS custom property value hits a real, empirically-confirmed
  // length ceiling in Chromium (silently dropped, no error) — resolveBgImageUrl keeps
  // the actual CSS value fixed-length regardless of the source image's size.
  // Not state-varied (no {state}-bg-image-* writes) — swapping the image itself on
  // hover/active/focus is out of scope, unlike the rest of this fn.
  if (!state) {
    const isFaded = isBgImageFaded(props);
    setProperty(el, `${prefix}bg-image-composite`, isFaded ? computeBgImageComposite(props) : undefined);
    setProperty(
      el,
      `${prefix}bg-image`,
      props.bgImage && !isFaded ? `url("${resolveBgImageUrl(props.bgImage)}")` : undefined,
    );
    setProperty(el, `${prefix}bg-image-fit`, props.bgImage ? (props.bgFit ?? 'cover') : undefined);
    setProperty(el, `${prefix}bg-image-position`, props.bgImage ? (props.bgPosition ?? 'center') : undefined);
  }

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
  setProperty(el, `${prefix}visibility`, props.visibility);
  const hasRadius = radiusKeys.some((k) => props[k] !== undefined && props[k] !== null);
  // Only set the instance radius var when the prop was explicitly passed (not from DEFAULT_PROPS).
  // If not explicitly set, the static CSS fallback chain handles it via --we-theme-*-radius.
  const radiusExplicit = !rawExplicitProps || radiusKeys.some((k) => rawExplicitProps[k] !== undefined);
  setProperty(el, `${prefix}radius`, hasRadius && radiusExplicit ? getRadiusValues(props) : undefined);

  // Layout on base
  setProperty(el, `${prefix}display`, props.display);
  setProperty(el, `${prefix}overflow`, props.overflow);
  setProperty(el, `${prefix}overflow-x`, props.overflowX);
  setProperty(el, `${prefix}overflow-y`, props.overflowY);
  setProperty(el, `${prefix}scrollbar-width`, props.scrollbarWidth);
  setProperty(el, `${prefix}scrollbar-gutter`, props.scrollbarGutter);

  // Flex
  const { main, cross } = mapFlexAxes(props, props.direction ?? 'row');
  setProperty(el, `${prefix}direction`, props.direction);
  setProperty(el, `${prefix}main-axis`, main);
  setProperty(el, `${prefix}cross-axis`, cross);
  setProperty(el, `${prefix}wrap`, 'wrap' in props ? (props.wrap ? 'wrap' : 'nowrap') : undefined);
  // Only set the instance gap var when explicitly passed — not from SIZE_DEFAULTS or DEFAULT_PROPS.
  // When not explicit, the static CSS fallback chain handles it via --we-theme-control-gap.
  const gapExplicit = !rawExplicitProps || rawExplicitProps['gap'] !== undefined;
  setProperty(el, `${prefix}gap`, props.gap && gapExplicit ? tokenVar('space', props.gap) : undefined);
  const hasPadding = paddingKeys.some((k) => props[k] !== undefined && props[k] !== null);
  // Same guard as radius — only set the instance padding var when explicitly passed.
  const paddingExplicit = !rawExplicitProps || paddingKeys.some((k) => rawExplicitProps[k] !== undefined);
  setProperty(el, `${prefix}padding`, hasPadding && paddingExplicit ? getPaddingValues(props) : undefined);

  // Typography
  setProperty(el, `${prefix}text-align`, props.textAlign);
  setProperty(el, `${prefix}font-family`, resolveFontFamily(props.fontFamily));
  setProperty(el, `${prefix}font-weight`, resolveFontWeight(props.fontWeight));
  setProperty(el, `${prefix}font-size`, props.fontSize ? tokenVar('font-size', props.fontSize) : undefined);
  setProperty(el, `${prefix}line-height`, resolveLineHeight(props.lineHeight));
  setProperty(
    el,
    `${prefix}letter-spacing`,
    props.letterSpacing ? tokenVar('letter-spacing', props.letterSpacing) : undefined,
  );
  setProperty(el, `${prefix}text-decoration`, props.textDecoration);
  setProperty(el, `${prefix}text-transform`, props.textTransform);
}

export function updateAllCustomVars(
  el: HTMLElement,
  componentName: string,
  props: Partial<DesignSystemProps>,
  rawExplicitProps?: Partial<DesignSystemProps>,
) {
  updateCustomVars(el, componentName, props, rawExplicitProps);
  ELEMENT_STATES.forEach((state) => {
    const stateProps = props[`${state}Props`];
    // State props are always treated as explicit — no DEFAULT_PROPS fill state blocks.
    if (stateProps && typeof stateProps === 'object') updateCustomVars(el, componentName, stateProps, undefined, state);
  });
}

// ────────────────────────────────────────────
// Static CSS generation (once per component class)
// ────────────────────────────────────────────
//
// PropSpec tables (HOST_LAYOUT, BASE_VISUAL, BASE_LAYOUT, BASE_FLEX, BASE_TYPOGRAPHY) and
// the decl/stateDecl/joinDecls/joinStateDecls builders live in @we/design-utils — shared
// with the Solid DS-interop stylesheet so hoverProps/activeProps/focusProps support the
// same property surface on both component families. See that file for the fallback
// semantics rationale.

// Build a PropSpec with an optional cascade fallback chain for a single prop.
function cascadeSpec(
  componentName: string,
  cssProp: string,
  varSuffix: string,
  groupVar: string | undefined,
  tokenDefault: string | undefined,
): PropSpec {
  if (!groupVar) {
    // No theme group — emit a direct token fallback so DEFAULT_PROPS values still take
    // effect even though the runtime no longer sets the custom var for non-explicit props.
    return tokenDefault ? [cssProp, varSuffix, tokenDefault] : [cssProp, varSuffix];
  }
  if (!tokenDefault) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[DS] ${componentName}: "${varSuffix}" has a cascade group (${groupVar}) but no fallback value. ` +
          `Add the corresponding prop to ${componentName}'s DEFAULT_PROPS so it can be auto-derived, ` +
          `or set ${varSuffix}Default explicitly in COMPONENT_CASCADE. ` +
          `Without a fallback, ${cssProp} will reset to its initial value when no theme variable is set.`,
      );
    }
    return [cssProp, varSuffix];
  }
  const compThemeVar = `--we-theme-${componentName}-${varSuffix}`;
  return [cssProp, varSuffix, `var(${compThemeVar}, var(${groupVar}, ${tokenDefault}))`];
}

/**
 * Generate static CSS string for a DS component. Called once per component class.
 * The CSS reads CSS custom properties that are set at runtime by updateAllCustomVars().
 *
 * @param defaultProps - The component's DEFAULT_PROPS. Used to auto-derive paddingDefault and
 * radiusDefault when they are not explicitly set in COMPONENT_CASCADE.
 */
export function getStaticDSStyles(
  componentName: string,
  layers?: readonly DSLayer[],
  defaultProps?: Partial<DesignSystemProps>,
): string {
  const l = new Set<DSLayer>(layers ?? ['layout', 'visual', 'flex', 'typography', 'state']);
  const p = `--we-${componentName}-`;
  const cascade = COMPONENT_CASCADE[componentName];

  // Auto-derive cascade fallback defaults from DEFAULT_PROPS when not explicitly set.
  // Explicit values in COMPONENT_CASCADE always take precedence.
  const dp = defaultProps as Record<string, unknown> | undefined;
  const radiusDefault =
    cascade?.radiusDefault ??
    (dp && radiusKeys.some((k) => dp[k] !== undefined)
      ? getRadiusValues(defaultProps as DesignSystemProps)
      : undefined);
  const paddingDefault =
    cascade?.paddingDefault ??
    (dp && paddingKeys.some((k) => dp[k] !== undefined)
      ? getPaddingValues(defaultProps as DesignSystemProps)
      : undefined);
  const gapDefault =
    cascade?.gapDefault ?? (dp && dp['gap'] !== undefined ? tokenVar('space', dp['gap'] as string) : undefined);

  // Build per-component visual and flex specs with cascade fallbacks where applicable.
  const baseVisual: PropSpec[] = BASE_VISUAL.map((spec) =>
    spec[1] === 'radius'
      ? cascadeSpec(componentName, 'border-radius', 'radius', cascade?.radiusGroup, radiusDefault)
      : spec,
  );
  const baseFlex: PropSpec[] = BASE_FLEX.flatMap((spec) => {
    if (spec[1] === 'gap') {
      return [cascadeSpec(componentName, 'gap', 'gap', cascade?.gapGroup, gapDefault)];
    }
    if (spec[1] === 'padding') {
      if (cascade?.nativePadding) return []; // padding owned by CSS_STYLES, not [part='base']
      return [cascadeSpec(componentName, 'padding', 'padding', cascade?.paddingGroup, paddingDefault)];
    }
    return [spec];
  });

  const styles: string[] = [];

  // ── Host (:host) ──
  // Transition lives on [part='base'], not :host. The host is the outer positioning shell
  // (width, height, margin) — these properties rarely animate and hosting a transition
  // here would add a redundant animation layer for every nested content primitive.
  const hostLines: string[] = [`display: var(${p}host-display, flex);`];
  if (l.has('layout')) hostLines.push(joinDecls(p, HOST_LAYOUT));
  styles.push(`:host { ${hostLines.join('\n    ')} }`);

  // ── Base ([part="base"]) ──
  const baseLines: string[] = ['width: 100%;', 'height: 100%;'];
  if (l.has('visual')) {
    baseLines.push(`transition: var(${p}transition, ${DEFAULT_TRANSITION});`);
    baseLines.push(joinDecls(p, baseVisual));
  }
  if (l.has('layout')) baseLines.push(joinDecls(p, BASE_LAYOUT));
  if (l.has('flex')) baseLines.push(joinDecls(p, baseFlex));
  if (l.has('typography')) baseLines.push(joinDecls(p, BASE_TYPOGRAPHY));

  const hasBase = l.has('visual') || l.has('layout') || l.has('flex') || l.has('typography');
  if (hasBase) {
    styles.push(`[part='base'] { ${baseLines.join('\n    ')} }`);
  }

  // ── bg-image ──
  // Unfaded case: a plain background-image directly on [part='base'] — safe to declare
  // unconditionally since it has an explicit `none` fallback (see the "always-emitted
  // property needs a static fallback" rule this file follows throughout).
  //
  // Faded case (bgImageOpacity set): needs its own paint layer, so it renders via a
  // ::before overlay instead (CSS has no way to scope `opacity` to one background —
  // see computeBgImageComposite). Gated on the `bgimage` reflected attribute (Lit's
  // default attribute-name conversion for `bgImage` — lowercased, no dash) so
  // components that never set bgImage don't pay for an extra paint layer.
  //
  // isolation: isolate is required, not optional: position:relative alone does not
  // establish a new stacking context, so the ::before's z-index:-1 would otherwise
  // escape to compete in whatever ancestor stacking context actually exists instead of
  // staying scoped to "behind this element's own content" — isolation:isolate fixes
  // that with no other visual side effects.
  if (l.has('visual')) {
    styles.push(
      `[part='base'] { background-image: var(${p}bg-image, none); background-size: var(${p}bg-image-fit, cover); ` +
        `background-position: var(${p}bg-image-position, center); background-repeat: no-repeat; }\n` +
        `:host([bgimage]) [part='base'] { position: relative; isolation: isolate; }\n` +
        `:host([bgimage]) [part='base']::before { content: ''; position: absolute; inset: 0; z-index: -1; ` +
        `border-radius: inherit; pointer-events: none; ` +
        `background-image: var(${p}bg-image-composite); background-size: var(${p}bg-image-fit, cover); ` +
        `background-position: var(${p}bg-image-position, center); background-repeat: no-repeat; }`,
    );
  }

  // ── State selectors ──
  if (l.has('state')) {
    const hostSpecs: PropSpec[] = [];
    if (l.has('layout')) hostSpecs.push(...HOST_LAYOUT);

    const baseSpecs: PropSpec[] = [];
    if (l.has('visual')) baseSpecs.push(...baseVisual);
    if (l.has('layout')) baseSpecs.push(...BASE_LAYOUT);
    if (l.has('flex')) baseSpecs.push(...baseFlex);
    if (l.has('typography')) baseSpecs.push(...BASE_TYPOGRAPHY);

    for (const state of ELEMENT_STATES) {
      const sp = `${p}${state}-`;

      // Host state — layout props only, no transition (see :host comment above)
      if (hostSpecs.length > 0) {
        const lines: string[] = [];
        lines.push(joinStateDecls(sp, p, hostSpecs));
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
