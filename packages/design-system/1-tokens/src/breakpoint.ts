/**
 * Breakpoints — the widths at which a layout is allowed to change its mind.
 *
 * ## Why these are not the `layout` tokens
 *
 * `layout` names *container intents* — "narrow modals, auth forms", "content columns" — and every
 * one of its ~10 call sites uses it as a `maxWidth`. That is a different concept: a cap is a
 * statement about how wide a thing should ever get, a breakpoint is a threshold at which a
 * different arrangement takes over. They happen to want the same numbers today, and they are
 * declared separately anyway, because they will want to diverge: a breakpoint at 700 with no 700px
 * container cap, a 500px modal cap with no breakpoint there. Deriving one from the other would mean
 * tightening an auth-form cap silently moved a layout threshold.
 *
 * The values match `layout`'s deliberately. `var(--we-layout-md)` being 900 while breakpoint `md`
 * meant 768 (Tailwind's number) is the kind of collision that bites forever.
 *
 * ## Why three, and why `base` is not in the table
 *
 * `base` is the unqualified value — what a prop means with no tier attached — so it has no
 * threshold and nothing to generate. That is what makes responsiveness purely additive: `width:
 * '100%'` and `baseProps: { width: '100%' }` are the same declaration, so every template already
 * written stays valid and one prop can become responsive without restructuring anything around it.
 *
 * `layout.xs` (420) is deliberately absent. It sits between phone portrait and phone landscape,
 * rarely warrants a layout change, and every tier multiplies the generated CSS in both design-system
 * families. It stays useful as a `maxWidth`, which is what it is for. Add a tier when a real case
 * appears, not in advance.
 *
 * ## Why a deployment cannot change them
 *
 * Two reasons, and the second is the one that decides it.
 *
 * Mechanically, a query condition cannot read a custom property — `@container (min-width:
 * var(--x))` never matches — so these are literals baked into generated CSS whatever we would
 * prefer. "Deployment-overridable" could only ever mean a fork editing a constant and rebuilding.
 *
 * More importantly, templates are portable. A template installed from the marketplace is authored
 * against what `mdUpProps` *means*, and a deployment moving `md` to 768 would silently change the
 * layout of every installed template it did not write. That is the same failure a theme redefining
 * a scale position produces, except it breaks arrangement rather than colour. Themes vary because
 * identity should; a coordinate system that portable content is authored against must not.
 */
export type BreakpointToken = 'sm' | 'md' | 'lg';

export const breakpoint = {
  sm: '640px', // large phone landscape / small tablet
  md: '900px', // tablet landscape, split panes
  lg: '1200px', // desktop
} satisfies Record<BreakpointToken, string>;

/**
 * Every tier including `base`, ascending.
 *
 * Exported as the ordered list rather than left for each consumer to write out, because *order is
 * precedence* everywhere this is used: the generated CSS emits `base → sm → md → lg` so that a
 * later rule wins at equal specificity, and the tier a surface resolves to is the last one whose
 * threshold it clears. Two consumers disagreeing about that order would produce a cascade that is
 * wrong only between two breakpoints, which is the hardest kind of wrong to notice.
 */
export const TIERS = ['base', 'sm', 'md', 'lg'] as const;

export type Tier = (typeof TIERS)[number];
