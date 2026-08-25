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
 * ## Why there is a sentinel inside it
 *
 * Because **an element cannot query itself**: `@container` matches descendants of the container,
 * never the container. So the tier cannot be written onto the surface, and something inside it has
 * to carry the answer. That something is a zero-size, out-of-flow box — see
 * {@link SURFACE_TIER_ATTR} — rather than a `display: contents` wrapper, which Firefox declines to
 * evaluate container queries for at all. Content renders directly in the surface, so a surface adds
 * exactly one layout box and dropping one anywhere rearranges nothing.
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

/**
 * Marks the tier sentinel — a zero-size, out-of-flow box whose only job is to be somewhere the tier
 * can land.
 *
 * It exists because of two constraints that meet awkwardly. An element cannot query itself, so the
 * tier cannot be written onto the surface; and **Firefox does not evaluate container queries for an
 * element with `display: contents`**, so it cannot be written onto a transparent wrapper either —
 * that reports `base` at every width in Firefox while working in Chrome, which is the worst
 * available failure. A real box out of flow satisfies both engines and costs nothing.
 */
export const SURFACE_TIER_ATTR = 'data-we-surface-tier';

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

/** The surface's own CSS. */
export const surfaceStyles = (): Record<string, string> => ({
  'container-name': SURFACE_CONTAINER_NAME,
  'container-type': 'inline-size',
});

/**
 * The sentinel's geometry.
 *
 * Declared inline by whoever renders it rather than left to the stylesheet, because a host that
 * never injected the design-system CSS would otherwise get a visible empty box in every surface.
 * Only {@link TIER_VAR} comes from the stylesheet — the thing that is *supposed* to be absent when
 * the stylesheet is.
 *
 * Out of flow, so it contributes no gap in a flex or grid surface and cannot be the first child
 * some `:first-child` rule was aiming at. Zero-size and hidden, so it paints nothing and is not in
 * the accessibility tree.
 */
export const tierSentinelStyles = (): Record<string, string> => ({
  position: 'absolute',
  width: '0',
  height: '0',
  visibility: 'hidden',
  'pointer-events': 'none',
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
  const base = `[${SURFACE_TIER_ATTR}] { ${TIER_VAR}: ${TIERS[0]}; }`;
  const tiers = TIERS.slice(1).map(
    (tier) => `${tierQuery(tier as Exclude<Tier, 'base'>)} { [${SURFACE_TIER_ATTR}] { ${TIER_VAR}: ${tier}; } }`,
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

/**
 * Warn when something asks to be responsive with no surface above it.
 *
 * The one failure mode this design cannot make unreachable. A container query with no container
 * resolves to *false*, so `mdUpProps` written outside every surface renders its base value, looks
 * entirely correct, and never adapts — there is nothing to see and nothing to catch. The host
 * declares a surface wherever it mounts a schema tree, which covers everything a template can
 * reach; what is left is chrome placed at a screen edge (whose subject is the window, not a box)
 * and anything a future host forgets.
 *
 * So: loud in development, absent in production. Called from wherever an element with tier props
 * gets a ref — the two design-system families each have one place.
 */
export function warnIfUnsurfaced(el: Element | null | undefined, what: string): void {
  if (!el || typeof process === 'undefined' || process.env?.NODE_ENV === 'production') return;
  if (typeof el.closest !== 'function' || el.closest(`[${SURFACE_ATTR}]`)) return;
  console.warn(
    `[we] ${what} declares breakpoint props but sits outside every $surface, so they will never ` +
      `apply. Responsive values are measured against the nearest surface; chrome at a screen edge ` +
      `has none, and should adapt to the viewport instead.`,
  );
}
