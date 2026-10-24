/**
 * SHADOW TOKEN DEFINITIONS
 *
 * One model for elevation and for glow, both read from the theme.
 *
 * ## Shadows
 *
 * The four steps are built from the `shadowColor` role and a strength, `--we-theme-shadow-strength`,
 * which a theme's `shadowIntensity` sets: flat themes zero it, dramatic ones raise it. They were
 * black at four fixed alphas, so `shadowIntensity` reached only the one component that read a
 * variable of its own, a pinned `shadowColor` reached nothing, and every `shadow: 'md'` in every
 * template was the same grey smudge in every theme. Each step keeps the alpha it had at strength 1.
 *
 * Built on `:root` and restated wherever a theme applies (see `THEME_DERIVED_VARIABLES`), because a
 * variable naming a role is settled where it is declared.
 *
 * ## Glow
 *
 * `glow` is the accent as light: a thin ring and a soft halo in the accent, at the theme's
 * `glowIntensity`. Not a variable like the steps: it names the accent, which `tone` re-points inside
 * an element, so it is written out in place (`GLOW_SHADOW`) and resolves where it is drawn — a
 * `tone: 'teal'` card glows teal.
 */

export type ShadowToken = 'sm' | 'md' | 'lg' | 'xl' | 'glow';
export type ShadowValue = ShadowToken | (string & {});

const tint = (alpha: number) =>
  `color-mix(in srgb, var(--we-role-shadow-color) calc(${alpha * 100}% * var(--we-theme-shadow-strength, 1)), transparent)`;

/** The elevation steps, each as it was at strength 1. */
export const shadow = {
  sm: `0 1px 2px ${tint(0.05)}`,
  md: `0 4px 6px ${tint(0.1)}`,
  lg: `0 10px 15px ${tint(0.1)}`,
  xl: `0 20px 25px ${tint(0.15)}`,
} satisfies Record<Exclude<ShadowToken, 'glow'>, string>;

/** The accent as light, written in place so `tone` colours it — see the note above. */
export const GLOW_SHADOW =
  '0 0 0 1px color-mix(in srgb, var(--we-role-accent) calc(60% * var(--we-theme-glow-strength, 0.35) / 0.35), transparent), ' +
  '0 0 var(--we-theme-glow-size, 16px) color-mix(in srgb, var(--we-role-accent) calc(var(--we-theme-glow-strength, 0.35) * 100%), transparent)';
