import type { DesignSystemProps, ElementState } from '@we/design-system-types';
import {
  tokenVar,
  paddingKeys,
  marginKeys,
  radiusKeys,
  getMarginValues,
  getPaddingValues,
  getRadiusValues,
  mapFlexAxes,
  designSystemKeys,
  stateKeys,
} from '@we/design-system-utils';

/**
 * Design System CSS Generator
 *
 * Generates dynamic CSS for web components based on design system props.
 * Separates styles into host (:host) for layout/positioning and base ([part="base"])
 * for appearance, with support for state variants (hover, focus, active, disabled).
 */

const ELEMENT_STATES: ElementState[] = ['hover', 'focus', 'active', 'disabled'];

const HOST_PROP_KEYS = [
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  ...marginKeys,
] as Array<keyof DesignSystemProps>;

const BASE_PROP_KEYS = designSystemKeys.filter(
  (key) =>
    !HOST_PROP_KEYS.includes(key as (typeof HOST_PROP_KEYS)[number]) &&
    !stateKeys.includes(key as (typeof stateKeys)[number]) &&
    key !== 'styles',
) as Array<keyof DesignSystemProps>;

// Helper to set or remove a CSS property on an element
function setProperty(el: HTMLElement, name: string, value?: string) {
  if (value !== undefined && value !== null && value !== '') el.style.setProperty(name, value);
  else el.style.removeProperty(name);
}

// Update custom properties for given props and optional state
function updateCustomVars(
  el: HTMLElement,
  componentName: string,
  props: Partial<DesignSystemProps>,
  state?: ElementState,
) {
  const prefix = state ? `--we-${componentName}-${state}-` : `--we-${componentName}-`;

  // Host variables (layout in parent - applied to :host)
  const hasMargin = marginKeys.some((k) => typeof props[k] !== 'undefined' && props[k] !== null);
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
  setProperty(el, `${prefix}transition`, props.transition);
  setProperty(el, `${prefix}z-index`, props.zIndex?.toString());
  setProperty(el, `${prefix}margin`, hasMargin ? getMarginValues(props) : undefined);

  // Base variables (inner appearance - applied to [part="base"])
  const { main, cross } = mapFlexAxes(props, props.direction ?? 'row');
  const hasPadding = paddingKeys.some((k) => typeof props[k] !== 'undefined' && props[k] !== null);
  const hasRadius = radiusKeys.some((k) => typeof props[k] !== 'undefined' && props[k] !== null);
  setProperty(el, `${prefix}bg`, props.bg ? tokenVar('color', props.bg, '') : undefined);
  setProperty(el, `${prefix}color`, props.color ? tokenVar('color', props.color, '') : undefined);
  setProperty(el, `${prefix}opacity`, props.opacity?.toString());
  setProperty(el, `${prefix}border`, props.border);
  setProperty(el, `${prefix}shadow`, props.shadow);
  setProperty(el, `${prefix}transform`, props.transform);
  setProperty(el, `${prefix}transition`, props.transition);
  setProperty(el, `${prefix}text-align`, props.textAlign);
  setProperty(el, `${prefix}font-weight`, props.fontWeight);
  setProperty(el, `${prefix}font-size`, props.fontSize ? tokenVar('font', props.fontSize) : undefined);
  setProperty(el, `${prefix}line-height`, props.lineHeight);
  setProperty(el, `${prefix}letter-spacing`, props.letterSpacing);
  setProperty(el, `${prefix}text-decoration`, props.textDecoration);
  setProperty(el, `${prefix}text-transform`, props.textTransform);
  setProperty(el, `${prefix}cursor`, props.cursor);
  setProperty(el, `${prefix}pointer-events`, props.pointerEvents);
  setProperty(el, `${prefix}display`, props.display);
  setProperty(el, `${prefix}direction`, props.direction);
  setProperty(el, `${prefix}main-axis`, main);
  setProperty(el, `${prefix}cross-axis`, cross);
  setProperty(el, `${prefix}wrap`, 'wrap' in props ? (props.wrap ? 'wrap' : 'nowrap') : undefined);
  setProperty(el, `${prefix}gap`, props.gap ? tokenVar('space', props.gap) : undefined);
  setProperty(el, `${prefix}overflow`, props.overflow);
  setProperty(el, `${prefix}padding`, hasPadding ? getPaddingValues(props) : undefined);
  setProperty(el, `${prefix}radius`, hasRadius ? getRadiusValues(props) : undefined);
}

function updateAllCustomVars(el: HTMLElement, componentName: string, props: DesignSystemProps) {
  // Core variables
  updateCustomVars(el, componentName, props);

  // State variables
  ELEMENT_STATES.forEach((state) => {
    const stateProps = props[`${state}Props`];
    if (stateProps && typeof stateProps === 'object') updateCustomVars(el, componentName, stateProps, state);
  });
}

const defaultTransitionSpeed = '0.2s';

function hostStyles(componentName: string) {
  const prefix = `--we-${componentName}-`;
  return `
    display: flex;

    transition: var(${prefix}transition, ${defaultTransitionSpeed});
    width: var(${prefix}width);
    height: var(${prefix}height);
    min-width: var(${prefix}min-width);
    min-height: var(${prefix}min-height);
    max-width: var(${prefix}max-width);
    max-height: var(${prefix}max-height);
    position: var(${prefix}position);
    top: var(${prefix}top);
    right: var(${prefix}right);
    bottom: var(${prefix}bottom);
    left: var(${prefix}left);
    z-index: var(${prefix}z-index);
    margin: var(${prefix}margin);
  `.trim();
}

function baseStyles(componentName: string) {
  const prefix = `--we-${componentName}-`;
  return `
    width: 100%;
    height: 100%;

    transition: var(${prefix}transition, ${defaultTransitionSpeed});
    display: var(${prefix}display, flex);
    background: var(${prefix}bg);
    color: var(${prefix}color);
    opacity: var(${prefix}opacity);
    border: var(${prefix}border);
    box-shadow: var(${prefix}shadow);
    transform: var(${prefix}transform);
    text-align: var(${prefix}text-align);
    font-weight: var(${prefix}font-weight);
    font-size: var(${prefix}font-size);
    line-height: var(${prefix}line-height);
    letter-spacing: var(${prefix}letter-spacing);
    text-decoration: var(${prefix}text-decoration);
    text-transform: var(${prefix}text-transform);
    cursor: var(${prefix}cursor);
    pointer-events: var(${prefix}pointer-events);
    flex-direction: var(${prefix}direction);
    justify-content: var(${prefix}main-axis);
    align-items: var(${prefix}cross-axis);
    flex-wrap: var(${prefix}wrap);
    gap: var(${prefix}gap);
    overflow: var(${prefix}overflow);
    padding: var(${prefix}padding);
    border-radius: var(${prefix}radius);
  `.trim();
}

function hostStateStyles(componentName: string, state: ElementState) {
  const defaultPrefix = `--we-${componentName}-`;
  const statePrefix = `${defaultPrefix}${state}-`;
  return `
    transition: var(${statePrefix}transition, var(${defaultPrefix}transition, ${defaultTransitionSpeed}));
    width: var(${statePrefix}width, var(${defaultPrefix}width));
    height: var(${statePrefix}height, var(${defaultPrefix}height));
    min-width: var(${statePrefix}min-width, var(${defaultPrefix}min-width));
    min-height: var(${statePrefix}min-height, var(${defaultPrefix}min-height));
    max-width: var(${statePrefix}max-width, var(${defaultPrefix}max-width));
    max-height: var(${statePrefix}max-height, var(${defaultPrefix}max-height));
    position: var(${statePrefix}position, var(${defaultPrefix}position));
    top: var(${statePrefix}top, var(${defaultPrefix}top));
    right: var(${statePrefix}right, var(${defaultPrefix}right));
    bottom: var(${statePrefix}bottom, var(${defaultPrefix}bottom));
    left: var(${statePrefix}left, var(${defaultPrefix}left));
    z-index: var(${statePrefix}z-index, var(${defaultPrefix}z-index));
    margin: var(${statePrefix}margin, var(${defaultPrefix}margin));
  `.trim();
}

function baseStateStyles(componentName: string, state: ElementState) {
  const defaultPrefix = `--we-${componentName}-`;
  const statePrefix = `${defaultPrefix}${state}-`;
  return `
    transition: var(${statePrefix}transition, var(${defaultPrefix}transition, ${defaultTransitionSpeed}));
    background: var(${statePrefix}bg, var(${defaultPrefix}bg));
    color: var(${statePrefix}color, var(${defaultPrefix}color));
    opacity: var(${statePrefix}opacity, var(${defaultPrefix}opacity));
    border: var(${statePrefix}border, var(${defaultPrefix}border));
    box-shadow: var(${statePrefix}shadow, var(${defaultPrefix}shadow));
    transform: var(${statePrefix}transform, var(${defaultPrefix}transform));
    text-align: var(${statePrefix}text-align, var(${defaultPrefix}text-align));
    font-weight: var(${statePrefix}font-weight, var(${defaultPrefix}font-weight));
    font-size: var(${statePrefix}font-size, var(${defaultPrefix}font-size));
    line-height: var(${statePrefix}line-height, var(${defaultPrefix}line-height));
    letter-spacing: var(${statePrefix}letter-spacing, var(${defaultPrefix}letter-spacing));
    text-decoration: var(${statePrefix}text-decoration, var(${defaultPrefix}text-decoration));
    text-transform: var(${statePrefix}text-transform, var(${defaultPrefix}text-transform));
    cursor: var(${statePrefix}cursor, var(${defaultPrefix}cursor));
    pointer-events: var(${statePrefix}pointer-events, var(${defaultPrefix}pointer-events));
    display: var(${statePrefix}display, var(${defaultPrefix}display, flex));
    flex-direction: var(${statePrefix}direction, var(${defaultPrefix}direction));
    justify-content: var(${statePrefix}main-axis, var(${defaultPrefix}main-axis));
    align-items: var(${statePrefix}cross-axis, var(${defaultPrefix}cross-axis));
    flex-wrap: var(${statePrefix}wrap, var(${defaultPrefix}wrap));
    gap: var(${statePrefix}gap, var(${defaultPrefix}gap));
    overflow: var(${statePrefix}overflow, var(${defaultPrefix}overflow));
    padding: var(${statePrefix}padding, var(${defaultPrefix}padding));
    border-radius: var(${statePrefix}radius, var(${defaultPrefix}radius));
  `.trim();
}

// Check if any of the given keys have overrides in stateProps compared to props
function hasPropOverride(
  keys: (keyof DesignSystemProps)[],
  stateProps: Partial<DesignSystemProps>,
  props: Partial<DesignSystemProps>,
) {
  return keys.some((k) => stateProps[k] !== null && stateProps[k] !== props[k]);
}

// Generate the complete design system CSS for an element based on its props
export function getDesignSystemCSS(el: HTMLElement, props: Partial<DesignSystemProps>): string {
  // Extract component name from tag for variable prefixes
  const componentName = el.tagName.toLowerCase().replace('we-', '');

  // Update custom variables
  updateAllCustomVars(el, componentName, props);

  // Now set ready attribute so we can ensure the design system CSS is applied after static CSS defined in the elements file
  const ready = 'data-we-static-css-ready';
  el.setAttribute(ready, '');

  // Build core styles
  const styles: string[] = [];
  styles.push(`:host([${ready}]) { ${hostStyles(componentName)} }`);
  styles.push(`:host([${ready}]) [part='base'] { ${baseStyles(componentName)} }`);

  // Build state styles
  for (const state of ELEMENT_STATES) {
    const stateProps = props[`${state}Props`];

    // Skip if no state props defined
    if (!stateProps || typeof stateProps !== 'object' || !Object.keys(stateProps).length) continue;

    // Check for state prop overrides & skip if no relevant changes
    const hasHostChange = hasPropOverride(HOST_PROP_KEYS, stateProps, props);
    const hasBaseChange = hasPropOverride(BASE_PROP_KEYS, stateProps, props);
    if (!hasHostChange && !hasBaseChange) continue;

    if (hasHostChange) {
      // Build host state styles
      const hostStateSelector = state === 'disabled' ? `:host([${ready}][disabled])` : `:host([${ready}]:${state})`;
      styles.push(`${hostStateSelector} { ${hostStateStyles(componentName, state)} }`);
    }

    if (hasBaseChange) {
      // Build base state styles
      const baseStateSelector =
        state === 'disabled'
          ? `:host([${ready}]) [part='base']:disabled, :host([${ready}]) [part='base'][aria-disabled='true']`
          : `:host([${ready}]) [part='base']:${state}:not(:disabled):not([aria-disabled='true'])`;
      styles.push(`${baseStateSelector} { ${baseStateStyles(componentName, state)} }`);
    }
  }

  return styles.join('\n');
}
