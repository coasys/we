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
 * `page` and `chrome` hold still while the content scrolls over them, as a wallpaper does; the rest
 * move with the box they paint.
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

/** Whether a surface image holds still behind scrolling content. */
export const surfaceImageFixed = (role: SurfaceImageRole): boolean => role === 'page' || role === 'chrome';
