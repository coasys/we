/**
 * What a path a template writes means, and the address it leads to.
 *
 * A template is mounted under a prefix it does not choose (`/space/<id>`), and a section of one is
 * mounted wherever a space puts it, so it cannot write absolute addresses to its own screens. It
 * writes them relative, and this decides relative to what. One function, so a link a template draws
 * (`href`) and a press it handles (`routeStore.navigate`) cannot mean two different things, and
 * neither can the main router and the shell overlay's.
 *
 * ## The rule
 *
 * Relative to the route the node is rendered in, as in most routers:
 *
 * - `.` (or nothing) is that route itself, `..` the route above it, `./board` a screen below it.
 *   This is what lets a section be portable: its links are to its own screens, wherever it is mounted.
 * - `~/board` is the template's own root, from anywhere in the template. Use it for home and for
 *   links between a template's screens: it means the same thing in a header as inside a route, so a
 *   fragment can move between the two without its links changing meaning.
 * - `?sort=new` is the page on screen with that query.
 * - An absolute path (`/settings`) or a URL is left as written: it is meant to leave the template.
 *
 * Template chrome, rendered outside every route, counts as the template's root. `..` never climbs
 * above the root: a template has no business addressing what it is mounted under, and a link that
 * tried would only ever land somewhere the template does not control.
 */

/**
 * Where a relative path is resolved from, as numbers of path segments of the address on screen.
 *
 * Numbers rather than paths because a route is declared as a pattern (`/board/:id`) and only the
 * address says what fills it: the first `depth` segments of the address *are* the route's path.
 */
export interface PathBase {
  /** How many segments the route a node is rendered in spans. */
  depth: number;
  /** How many segments the template's root spans: the prefix it is mounted under. */
  root: number;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Whether a path is resolved by `resolvePath` rather than used as written. */
export function isRelativePath(to: string): boolean {
  const path = to.trim();
  return !(path.startsWith('/') || path.startsWith('#') || SCHEME.test(path));
}

/**
 * The address `to` leads to, from `current` (the address on screen) and the node's `base`.
 *
 * Anything absolute is returned unchanged. A base deeper than the address is clamped to it, and a
 * root deeper than the base is the base's floor, so a caller that knows nothing passes
 * `{ depth: root, root }` and gets root-relative resolution.
 */
export function resolvePath(to: string, current: string, base: PathBase): string {
  const written = to.trim();
  if (!isRelativePath(written)) return written;

  const [currentPath] = current.split(/[?#]/);
  if (written.startsWith('?')) return `${currentPath || '/'}${written}`;

  const segments = currentPath.split('/').filter(Boolean);
  const root = Math.min(Math.max(base.root, 0), segments.length);
  const suffixAt = written.search(/[?#]/);
  let path = suffixAt === -1 ? written : written.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? '' : written.slice(suffixAt);

  let at: number;
  if (path === '~' || path.startsWith('~/')) {
    at = root;
    path = path.slice(1);
  } else {
    at = Math.min(Math.max(base.depth, root), segments.length);
    for (;;) {
      if (path === '.' || path === './') path = '';
      else if (path.startsWith('./')) path = path.slice(2);
      else if (path === '..' || path.startsWith('../')) {
        at = Math.max(root, at - 1);
        path = path.slice(path === '..' ? 2 : 3);
      } else break;
    }
  }

  const rest = path.split('/').filter((s) => s && s !== '.');
  return `/${[...segments.slice(0, at), ...rest].join('/')}${suffix}`;
}
