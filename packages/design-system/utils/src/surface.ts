/**
 * Surfaces — the boxes a layout is allowed to measure itself against.
 *
 * A **surface** is a box that gives the content inside it a size to respond to. Four of them exist
 * in WE today, all host-owned: the template content area, the shell overlay, a docked module
 * panel's content region, and the editor's preview pane. A template may declare more — a two-pane
 * workspace whose right pane should adapt to its own width is a legitimate nested surface — and
 * nesting composes: the innermost surface wins, for CSS and for the reported tier alike.
 *
 * ## Why the host declares them and a template usually does not
 *
 * A container query with no container resolves to *false*, silently. So a `mdUpProps` written
 * inside a tree with no surface above it renders its base value, looks entirely correct, and never
 * adapts. That failure is unreachable if the host guarantees a surface at every point where it
 * mounts a schema tree, and permanently available if it does not.
 *
 * ## Why a surface is two elements
 *
 * Because **an element cannot query itself**: `@container` matches descendants of the container,
 * never the container. So the outer box declares the container and the inner box is the first
 * element able to see it — which is what makes {@link TIER_VAR} readable at all. Everything renders
 * inside the inner box.
 *
 * ## Why the tier is decided in CSS and read back, rather than computed
 *
 * The tier a surface is at could be derived in JS from a measured width. It must not be, for a
 * reason that only shows up at the boundaries: **container queries evaluate the content box**, so a
 * JS comparison against `getBoundingClientRect()` disagrees with the CSS by exactly the surface's
 * padding and border, and a template branching on the tier would disagree with its own children's
 * `*UpProps` in a band a few pixels wide. Instead the `@container` rules below set {@link TIER_VAR}
 * on the inner box and JS reads the answer, so there is one set of thresholds and the two mechanisms
 * are the same decision rather than two decisions that agree most of the time.
 *
 * A surface should therefore carry no padding or border of its own — put those on a box inside it.
 * Nothing enforces that; it simply keeps the two boxes the same size, which is one less thing to
 * reason about.
 *
 * ## `inline-size`, not `size`
 *
 * Height queries need a definite height, which not every surface has, and the one problem here that
 * genuinely needs both axes — packing fixed-aspect tiles into a box — is a computation CSS cannot
 * express and is solved in JS regardless. `inline-size` is also the containment that costs nothing:
 * a surface's width is already decided by its parent in all four host cases.
 *
 * Note this means a surface's own inline size may not depend on its contents. Every host site is
 * width-driven already; a template declaring a surface on a shrink-to-fit box would find it
 * stretch.
 */
import { breakpoint, type Tier, TIERS } from '@we/tokens';

/** Marks the outer box — the element that *is* the container. */
export const SURFACE_ATTR = 'data-we-surface';

/** Marks the inner box — the first element that can see the container, and where the tier lands. */
export const SURFACE_INNER_ATTR = 'data-we-surface-inner';

/**
 * The container's name.
 *
 * Named rather than anonymous, and that is load-bearing rather than tidy: an anonymous query binds
 * to the nearest container of *any* kind, and the call module makes every video tile a size
 * container so its picture can be measured. Without a name, a `mdUpProps` on anything inside a tile
 * would silently be answered by a 200px cell instead of by the panel.
 */
export const SURFACE_CONTAINER_NAME = 'we-surface';

/** Where the resolved tier lands. Inherits, so any descendant can read it too. */
export const TIER_VAR = '--we-tier';

/** The outer box's own CSS. */
export const surfaceStyles = (): Record<string, string> => ({
  'container-name': SURFACE_CONTAINER_NAME,
  'container-type': 'inline-size',
});

/** `@container` prelude for one tier — the single place a threshold becomes a query. */
export const tierQuery = (tier: Exclude<Tier, 'base'>): string =>
  `@container ${SURFACE_CONTAINER_NAME} (min-width: ${breakpoint[tier]})`;

/**
 * The rules that decide a surface's tier.
 *
 * Emitted `base` first and then ascending, because **container queries add no specificity**: every
 * rule below is a bare attribute selector, so which one wins is decided purely by declaration
 * order, and a base rule written with any extra specificity would outrank every tier above it. This
 * is the same "declaration order is precedence order" rule the interactive-state CSS already
 * depends on, and it fails the same way — silently, and only between two breakpoints.
 */
export function generateTierCSS(): string {
  const base = `[${SURFACE_INNER_ATTR}] { ${TIER_VAR}: ${TIERS[0]}; }`;
  const tiers = TIERS.slice(1).map(
    (tier) => `${tierQuery(tier as Exclude<Tier, 'base'>)} { [${SURFACE_INNER_ATTR}] { ${TIER_VAR}: ${tier}; } }`,
  );
  return [base, ...tiers].join('\n');
}

/**
 * Read the tier CSS decided for this surface.
 *
 * Falls back to `base` when nothing answers — a host that never injected the design-system
 * stylesheet, or a test environment with no container-query support. That is the honest degradation:
 * `*UpProps` is inert under exactly the same conditions, so both mechanisms report the same
 * un-adapted layout rather than disagreeing about it.
 */
export function readTier(el: Element | null | undefined): Tier {
  if (!el || typeof getComputedStyle !== 'function') return 'base';
  const raw = getComputedStyle(el).getPropertyValue(TIER_VAR).trim();
  return (TIERS as readonly string[]).includes(raw) ? (raw as Tier) : 'base';
}
