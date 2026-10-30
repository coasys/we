/**
 * Images a theme lays on every surface of a kind — an orb of light behind the page, a grain on
 * every card.
 *
 * Keyed by surface role, and painted wherever that role is the fill: `bg: 'surface'` paints the
 * surface colour and, over it, the theme's surface image. So a theme decorates every card at once,
 * which a template's own `bgImage` — one element's picture — was never for.
 *
 * Gradients only. A theme arrives from other people, and an image fetched from a URL reports who
 * opened the space, from where and when; the theme writer drops anything that is not a gradient.
 *
 * Every one holds still while the content inside its box scrolls over it, as a wallpaper does — the
 * default attachment, which places the image against the box rather than the content. Not `fixed`:
 * that places it against the window, which the browser cannot hand to the GPU, so the whole surface
 * was repainted on every frame anything moved over it — a call window dragged across a page with the
 * theme's orbs ran at a crawl — and it misdrew where a moving layer crossed it, the rail and the tree
 * flickering to the page's image behind them.
 */
export const SURFACE_IMAGE_ROLES = ['chrome', 'page', 'surface', 'surfaceRaised', 'surfaceSunken'] as const;
export type SurfaceImageRole = (typeof SURFACE_IMAGE_ROLES)[number];

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The variable a surface image is written to: `--we-surface-image-surface-raised`. */
export const surfaceImageVar = (role: SurfaceImageRole): string => `--we-surface-image-${kebab(role)}`;

/** The surface role a `bg` value names, kebab-case as a schema spells it, or undefined. */
export function surfaceImageRoleOf(bg: string | undefined): SurfaceImageRole | undefined {
  return SURFACE_IMAGE_ROLES.find((role) => kebab(role) === bg);
}
