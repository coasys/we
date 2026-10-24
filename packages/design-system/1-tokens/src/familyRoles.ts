/**
 * Every colour family's roles, generated from the family registry (`families.ts`).
 *
 * Each family with a fill — the accent, the statuses and the ten palette hues — gets the same seven:
 *
 * | Role | What it is |
 * | --- | --- |
 * | `<family>` | the solid fill: a primary button, a solid badge |
 * | `on<Family>` | text and icons on that fill |
 * | `<family>Soft` | a tinted fill: a soft badge, a selected row, a status panel |
 * | `<family>Text` | the family as readable text on an ordinary surface or its own soft fill |
 * | `<family>Border` | a border in the family |
 * | `<family>Hover`, `<family>Active` | the fill under the pointer and while pressed |
 *
 * Neutral gets the same seven names, built from the roles that already mean those things for greys.
 *
 * ## A fill is off the ramp; its text, tint and border are on it
 *
 * The surface stack is defined relative to the page, so it inverts with the theme. A fill does not:
 * a red is red in a light theme and in a dark one, and an accent is the product's colour rather than
 * a distance from its background. So a fill states its own lightness (the family's `fill`, which a
 * theme can move) and takes only its hue and chroma budget from the theme. It was a ramp step once,
 * and in every dark theme that step inverted the accent to a pale lavender and the destructive
 * button to a pale pink.
 *
 * Text, tints and borders are the opposite case. They are relationships to the surface they sit on,
 * and the surface inverts, so a value that stayed put would be dark text on a dark background in half
 * the themes. They are ramp steps, which swing: step 700 is L 42% in a light theme and L 58% in a
 * dark one. The rule underneath both is that a role naming a *thing* is absolute and a role naming a
 * *relationship to its background* is a scale position.
 *
 * The fill's chroma ceiling is measured where the fill sits rather than where the ramp peaks: how
 * much chroma a hue can hold moves a long way with lightness, and the ramp's figure asked gold for
 * more than it has at L 0.6 and less than it has at L 0.76.
 *
 * ## The label starts white and is chosen when the theme is applied
 *
 * `on<Family>` declares near-white, which suits a fill dark enough to carry it. The contrast
 * derivation in `@we/themes` then chooses between near-white and near-black against where the fill
 * actually landed, so a bright fill gets a dark label without a theme having to pin one.
 *
 * ## States are steps from the fill, not ramp positions
 *
 * The label has to stay readable at rest, under the pointer and while pressed. Three independent
 * scale positions were three chances to drift somewhere no single label reaches — `black`'s pressed
 * accent at L 78.5% once dragged the whole choice down to Lc 35. Tied to the fill, the states move
 * with it, and the derivation decides which way they move (away from the label), per family.
 */
import {
  capitalise,
  CHROMATIC_FAMILIES,
  type ChromaticFamily,
  COLOR_FAMILIES,
  familyFillLightness,
  familySaturationVar,
} from './families.js';

type RoleSuffix = '' | 'Soft' | 'Text' | 'Border' | 'Hover' | 'Active';
export type FamilyRoleName<F extends string> = `${F}${RoleSuffix}` | `on${Capitalize<F>}`;
export type FamilyRole = FamilyRoleName<ChromaticFamily | 'neutral'>;

/** A family's hover or pressed state: a step from its fill, in the direction the derivation chose. */
const stateOf = (family: string, state: 'hover' | 'active'): string =>
  `oklch(from var(--we-role-${family}) calc(l + var(--we-state-${state}-${family}, var(--we-state-${state}))) c h)`;

function chromaticRoles(family: ChromaticFamily): Record<string, string> {
  const { soft, text, border, fillChroma } = COLOR_FAMILIES[family];
  const Family = capitalise(family);
  return {
    [family]:
      `oklch(calc(${familyFillLightness(family)} * 1%) ` +
      `calc(var(${familySaturationVar(family)}) / 100 * var(--we-color-${family}-fill-chroma-max, ${fillChroma})) ` +
      `var(--we-color-${family}-hue))`,
    [`on${Family}`]: 'oklch(100% 0 var(--we-color-neutral-hue))',
    [`${family}Soft`]: `var(--we-color-${family}-${soft})`,
    [`${family}Text`]: `var(--we-color-${family}-${text})`,
    [`${family}Border`]: `var(--we-color-${family}-${border})`,
    [`${family}Hover`]: stateOf(family, 'hover'),
    [`${family}Active`]: stateOf(family, 'active'),
  };
}

/**
 * Neutral's seven, from the roles that already mean those things for greys, so a `tone: 'neutral'`
 * element draws the way an untoned one always has: a solid neutral is the inverse surface with its
 * label, a soft one the filled-neutral control colour, its text the muted text, its border the
 * strong border.
 */
const NEUTRAL_ROLES = {
  neutral: 'var(--we-role-surface-inverse)',
  onNeutral: 'var(--we-role-on-inverse)',
  neutralSoft: 'var(--we-role-control-surface)',
  neutralText: 'var(--we-role-text-muted)',
  neutralBorder: 'var(--we-role-border-strong)',
  neutralHover: stateOf('neutral', 'hover'),
  neutralActive: stateOf('neutral', 'active'),
};

export const FAMILY_ROLES = {
  ...Object.assign({}, ...CHROMATIC_FAMILIES.map(chromaticRoles)),
  ...NEUTRAL_ROLES,
} as Record<FamilyRole, string>;

/** The fallbacks a browser without relative colour needs for every family's states. */
export const FAMILY_STATE_FALLBACKS = Object.fromEntries(
  [...CHROMATIC_FAMILIES, 'neutral'].flatMap((family) => [
    [`${family}Hover`, `var(--we-role-${family})`],
    [`${family}Active`, `var(--we-role-${family})`],
  ]),
) as Record<`${ChromaticFamily | 'neutral'}${'Hover' | 'Active'}`, string>;

/** The accent's roles a `tone` re-points, as role-name suffixes: `accent`, `accentSoft`, …. */
const TONED_SUFFIXES = ['', 'Soft', 'Text', 'Border', 'Hover', 'Active'] as const;

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const roleVariable = (name: string): string => `--we-role-${kebab(name)}`;

/**
 * What `tone` sets on an element: the accent's roles, re-pointed at one family.
 *
 * Components draw their colour from the accent (`accent`, `on-accent`, `accent-soft`, the focus
 * ring, `shadow: 'glow'`), so re-pointing the accent inside an element recolours everything in it —
 * a primary button, a selected row, a ring — the way Radix's `color`, Chakra's `colorScheme` and
 * Shopify Polaris's `tone` do. One setting colours an element and everything in it; no component has
 * a colour prop of its own.
 *
 * The values are references to the family's own roles, which the theme has already corrected for
 * contrast — so a toned button's label is the family's label, chosen against the family's fill, and
 * nothing is measured again.
 *
 * `accent` writes the accent's own definitions rather than references, so `tone: 'accent'` inside a
 * purple-toned element restores the real accent instead of aliasing a variable to itself.
 */
export function toneVariables(tone: ChromaticFamily | 'neutral'): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const suffix of TONED_SUFFIXES) {
    const accentRole = `accent${suffix}`;
    vars[roleVariable(accentRole)] =
      tone === 'accent' ? FAMILY_ROLES[accentRole as FamilyRole] : `var(${roleVariable(`${tone}${suffix}`)})`;
  }
  const label = tone === 'accent' ? FAMILY_ROLES.onAccent : `var(${roleVariable(`on${capitalise(tone)}`)})`;
  vars['--we-role-on-accent'] = label;
  vars['--we-role-on-accent-muted'] = 'oklch(from var(--we-role-on-accent) l c h / 0.8)';
  // The focus ring and what reads it, restated here because each is worked out where it is declared.
  vars['--we-role-focus'] = 'var(--we-role-accent)';
  vars['--we-color-focus'] = 'var(--we-role-focus)';
  vars['--we-ring-color'] = 'var(--we-role-focus)';
  vars['--we-focus-outline'] = '0 0 0 var(--we-focus-ring-width) var(--we-color-focus)';
  // The gradient a `gradient` prop draws, swept ±25° around the toned fill's hue as the root one is
  // around the accent's.
  vars['--we-gradient-accent'] =
    'linear-gradient(135deg, oklch(from var(--we-role-accent) l c calc(h - 25)) 0%, ' +
    'oklch(from var(--we-role-accent) l c calc(h + 25)) 100%)';
  return vars;
}
