/**
 * Type roles, and the keys a theme can set per component.
 *
 * ## Type roles
 *
 * A theme says how *kinds* of text look — headings, body, a field's label, a control's words, a
 * badge, the small capitals above a group — rather than how each component sets its type. Every
 * component that draws one of these reads its role, so "headings in a display face at 300" is one
 * setting that reaches `we-text`'s heading variants, markdown and HTML headings alike.
 *
 * A role holds no defaults of its own. Each component keeps the value it had and reads the role in
 * front of it, so a theme that sets nothing renders exactly as before, and a role a theme does set
 * replaces that value wherever the role is drawn.
 *
 * ## Component overrides
 *
 * The narrow tier: one component, or one component in one variant, set apart from its family. The
 * keys are the ones a family already has — the vocabulary does not grow per component — and each
 * writes one variable a component reads ahead of its family:
 *
 * `--we-theme-<component>-<key>` for every variant, `--we-theme-<component>--<variant>-<key>` for one.
 *
 * The double dash keeps a variant from reading as part of a component's name: `button--soft` cannot
 * collide with a component called `button-soft`.
 */
/** `letterSpacing` → `letter-spacing`. */
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The kinds of text a theme can style. */
export const TYPE_ROLES = ['heading', 'body', 'label', 'control', 'badge', 'overline'] as const;
export type TypeRole = (typeof TYPE_ROLES)[number];

/** What a type role can set, and the CSS property each becomes. */
export const TYPE_ROLE_KEYS = {
  family: 'font-family',
  weight: 'font-weight',
  letterSpacing: 'letter-spacing',
  lineHeight: 'line-height',
  textTransform: 'text-transform',
  color: 'color',
} as const;
export type TypeRoleKey = keyof typeof TYPE_ROLE_KEYS;

/** The variable one key of one role writes: `--we-type-heading-weight`. */
export const typeRoleVar = (role: TypeRole, key: TypeRoleKey): string => `--we-type-${role}-${kebab(key)}`;

/**
 * The keys a theme can set on one component, each the same word a family uses.
 *
 * `type` names a type role; `fill`, `text` and `border` name colour roles. The geometry keys take a
 * length or a token, as the family settings do.
 */
export const COMPONENT_THEME_KEYS = [
  'radius',
  'padding',
  'gap',
  'borderWidth',
  'shadow',
  'type',
  'fill',
  'text',
  'border',
] as const;
export type ComponentThemeKey = (typeof COMPONENT_THEME_KEYS)[number];

/** The variable a component override writes, for every variant or for one. */
export const componentThemeVar = (component: string, key: string, variant?: string): string =>
  `--we-theme-${component}${variant ? `--${variant}` : ''}-${kebab(key)}`;

/**
 * A component's own value for one key, read ahead of what it would otherwise be.
 *
 * Variant first, then the component, then `fallback` — the family, the type role, or the value the
 * component always had. With no fallback the chain ends unset, which for an inherited property is
 * inherit: a component that never set a value keeps inheriting when no theme says otherwise.
 */
export function componentChain(component: string, key: string, variant: string | null | undefined, fallback?: string) {
  const own = `var(${componentThemeVar(component, key)}${fallback ? `, ${fallback}` : ''})`;
  return variant ? `var(${componentThemeVar(component, key, variant)}, ${own})` : own;
}

/**
 * A type role's declarations for a stylesheet, each falling back to the value that rule had.
 *
 * For text a component draws in its own CSS rather than through its DS props — a form field's
 * label, a group's overline. A key with no fallback ends unset, which is inherit for every one of
 * these properties, so a rule that never set it keeps inheriting. `omit` leaves a key out where the
 * role must not reach: a tooltip's words are measured against its inverse fill, not the page.
 */
export function typeRoleDeclarations(
  role: TypeRole,
  fallbacks: Partial<Record<TypeRoleKey, string>> = {},
  omit: readonly TypeRoleKey[] = [],
): string {
  return (Object.entries(TYPE_ROLE_KEYS) as [TypeRoleKey, string][])
    .filter(([key]) => !omit.includes(key))
    .map(([key, property]) => {
      const fallback = fallbacks[key];
      return `${property}: var(${typeRoleVar(role, key)}${fallback ? `, ${fallback}` : ''});`;
    })
    .join(' ');
}
