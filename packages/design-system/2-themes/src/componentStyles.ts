/**
 * A theme's type roles and component overrides, as variables.
 *
 * Both are written as plain variables and read by components through chains declared where the
 * component draws (see `componentChain` in @we/tokens), so nothing here has to know which components
 * exist. A component a module registers tomorrow reads `components.<its name>` the day it ships.
 *
 * Values are authored the way the matching family setting is: a token name where the family takes
 * one (`'semibold'`, `'300'`, `'pill'`), a role name for a colour, otherwise raw CSS. Unknown words
 * pass through as CSS, so `'600'` and `'0.02em'` work without a token.
 */
import {
  componentThemeVar,
  font,
  GLOW_SHADOW,
  radius,
  shadow,
  space,
  TYPE_ROLE_KEYS,
  type TypeRole,
  type TypeRoleKey,
  typeRoleVar,
} from '@we/tokens';

import type { ComponentOverride, ThemeOverrides, TypeStyle } from './overrides';

/**
 * A shadow token as the value a component reads. `glow` has no variable of its own — it is written
 * out where it is drawn, so `tone` can colour it (see `GLOW_SHADOW`) — and passed through as the
 * bare word it was a `box-shadow` of nothing.
 */
const resolveShadow = (value: string): string =>
  value === 'glow' ? GLOW_SHADOW : has(shadow, value) ? `var(--we-shadow-${value})` : value;

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const has = (table: object, key: string) => Object.prototype.hasOwnProperty.call(table, key);

/** A colour role by name, either spelling, as the variable it is. */
const roleColor = (role: string): string => `var(--we-role-${kebab(role)})`;

/** The shape families a radius may name instead of a size, as the DS `r` prop accepts. */
const RADIUS_FAMILIES = ['control', 'surface', 'input', 'avatar', 'media'];

const resolveRadius = (value: string): string => {
  if (has(radius, value)) return `var(--we-radius-${value})`;
  if (RADIUS_FAMILIES.includes(value)) return `var(--we-theme-${value === 'media' ? 'surface' : value}-radius)`;
  return value;
};

/** Each part of a padding or gap shorthand, a space token where it names one. */
const resolveSpace = (value: string): string =>
  value
    .split(/\s+/)
    .map((part) => (has(space, part) ? `var(--we-space-${part})` : part))
    .join(' ');

const TYPE_VALUE: Record<TypeRoleKey, (value: string) => string> = {
  family: (v) => v,
  weight: (v) => (has(font.weight, v) ? `var(--we-font-weight-${v})` : v),
  letterSpacing: (v) => (has(font.letterSpacing, v) ? `var(--we-letter-spacing-${v})` : v),
  lineHeight: (v) => (has(font.lineHeight, v) ? `var(--we-line-height-${v})` : v),
  textTransform: (v) => v,
  color: roleColor,
};

/** Write each type role a theme sets: `--we-type-heading-weight: 300`. */
export function writeTypeStyles(theme: ThemeOverrides, into: Record<string, string>): void {
  for (const [role, style] of Object.entries(theme.typeStyles ?? {}) as [TypeRole, TypeStyle][]) {
    for (const key of Object.keys(TYPE_ROLE_KEYS) as TypeRoleKey[]) {
      const value = style?.[key];
      if (value === undefined || value === '') continue;
      into[typeRoleVar(role, key)] = TYPE_VALUE[key](String(value));
    }
  }
}

/**
 * The type keys a component reads, by the CSS property's name, and the role key each comes from.
 * `type: 'label'` on a component points each of these at the label role's variable.
 */
export const COMPONENT_TYPE_PROPERTIES: Record<string, TypeRoleKey> = {
  fontFamily: 'family',
  fontWeight: 'weight',
  letterSpacing: 'letterSpacing',
  lineHeight: 'lineHeight',
  textTransform: 'textTransform',
};

function writeOverride(
  component: string,
  override: Omit<ComponentOverride, 'variants'>,
  variant: string | undefined,
  into: Record<string, string>,
): void {
  const set = (key: string, value: string | undefined) => {
    if (value !== undefined && value !== '') into[componentThemeVar(component, key, variant)] = value;
  };
  set('radius', override.radius && resolveRadius(override.radius));
  set('padding', override.padding && resolveSpace(override.padding));
  set('gap', override.gap && resolveSpace(override.gap));
  set('borderWidth', override.borderWidth);
  set('shadow', override.shadow && resolveShadow(override.shadow));
  set('fill', override.fill && roleColor(override.fill));
  set('border', override.border && roleColor(override.border));
  if (override.type) {
    for (const [property, key] of Object.entries(COMPONENT_TYPE_PROPERTIES)) {
      set(property, `var(${typeRoleVar(override.type, key)})`);
    }
  }
  // An explicit `text` wins over the colour the type role brings with it.
  set(
    'text',
    override.text ? roleColor(override.text) : override.type && `var(${typeRoleVar(override.type, 'color')})`,
  );
}

/** Write each component override: `--we-theme-button-radius`, `--we-theme-button--soft-border-width`. */
export function writeComponentOverrides(theme: ThemeOverrides, into: Record<string, string>): void {
  for (const [component, override] of Object.entries(theme.components ?? {})) {
    if (!override || !/^[a-z][a-z0-9-]*$/.test(component)) continue;
    const { variants, ...own } = override;
    writeOverride(component, own, undefined, into);
    for (const [variant, variantOverride] of Object.entries(variants ?? {})) {
      if (variantOverride && /^[a-z][a-z0-9-]*$/.test(variant))
        writeOverride(component, variantOverride, variant, into);
    }
  }
}
