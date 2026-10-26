/**
 * A bundle: an app as data — what a deployment ships in its seed or a person installs from a file.
 *
 * An app definition, in the plainest words: JSON that composes an experience out of what the host
 * already has. Its app (the chrome around every space), the space templates and sections it renders
 * with, a theme, the kinds of record it is about, and how it wants spaces shown. **It cannot bring
 * code.** A bundle names modules; it cannot ship one, and a module this build does not have is a part
 * of the app that stays empty.
 *
 * ## What is NOT in here, on purpose
 *
 * What a bundle needs and what it will be able to do. Both are worked out from its templates when it
 * is judged (`judgeBundle` in the app shell), never read from the file: a list an author writes is a
 * claim, a walk of what the templates actually reach is a fact, and an install screen must only ever
 * show facts.
 *
 * ## Versions
 *
 * `formatVersion` is this format's, and is what a reader checks before anything else; `version` is
 * the bundle's own, recorded against what it installed so a later version can be recognised as an
 * update to the same app rather than a second copy.
 */
import type { EntityManifest } from '@we/backend-shared';

import type { SchemaNode, TemplateSchema } from './types';

export const BUNDLE_FORMAT = 'we-bundle';
export const BUNDLE_FORMAT_VERSION = 1;

/** A bundle's theme: the parameter object a theme is, plus optional CSS. */
export interface BundleTheme {
  id: string;
  name: string;
  icon?: string;
  overrides: Record<string, unknown>;
  css?: string;
}

/**
 * What makes one app look like another: its name, its mark, and what its About page says.
 *
 * Read wherever the app names itself — the sidebar's header, the sign-in screen, the window title,
 * a toast saying a new version is available — in place of WE's own, while this bundle's app is the
 * one in use. A deployment that builds a bundle in is white-labelled by it; nothing in WE's own code
 * changes.
 *
 * The mark and wordmark are SVG source, drawn as images (`data:` URLs), so whatever is in them cannot
 * run — but `readBundle` still refuses one carrying script, event handlers or a reference to anywhere
 * outside the file, so a brand never looks like it does more than draw.
 */
export interface BundleBrand {
  /** The product's name, as a person reads it: "Coasys". */
  name: string;
  /** A square mark — an app icon, a favicon, the sidebar's header. SVG source. */
  mark?: string;
  /** The name drawn as type, where there is room. SVG source. */
  wordmark?: string;
  /** What the About page says, as Markdown. The host draws it on a page of its own. */
  about?: string;
  /**
   * The bundle's own page to open wherever the host offers "About" — by its id in `pages`. Wins
   * over `about` when both are given; `about` is then what a build that cannot open pages shows.
   */
  aboutPage?: string;
}

/** A kind of record the app is about, as the model wizard would save it: one entity, by name. */
export interface BundleRecordType {
  name: string;
  icon?: string;
  description?: string;
  manifest: EntityManifest;
}

/**
 * How spaces are shown in the app.
 *
 * `ours` — the bundle's space template renders every space (the right answer for a focused app such as
 * a field guide). `theirs` — each space keeps the template it chose, and the bundle's are offered beside
 * them. `template` names the bundle's space template meant by `ours`, by its id in the bundle.
 */
export interface BundleDisplay {
  spaces: 'ours' | 'theirs';
  template?: string;
}

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  formatVersion: typeof BUNDLE_FORMAT_VERSION;
  /** Stable and lowercase — what an install is recognised by, and the prefix its pieces install under. */
  id: string;
  version: string;
  name: string;
  description: string;
  icon: string;
  /** Who says they made it. A claim: a file attests nothing, and an install screen says so. */
  author?: { name?: string; did?: string };
  /** The chrome around every space: a template with `meta.role: 'app'`. */
  app?: TemplateSchema & { id: string };
  /** Space templates (no role) and sections (`meta.role: 'view'`). */
  templates?: Array<TemplateSchema & { id: string }>;
  /**
   * Pages of the app's own (`meta.role: 'page'`): its About page, a guide, anything it wants to say
   * that is not about a space. Each opens above everything, as the host's settings do, at
   * `shellStore.openShellView('<bundle id>--<page id>')`, and routes inside itself like any template.
   * Judged at the chrome tier, as the app is, and never drawn in safe mode.
   */
  pages?: Array<TemplateSchema & { id: string }>;
  /** One theme. A bundle offering several lists them in `themes` instead. */
  theme?: BundleTheme;
  /**
   * The themes the app offers, its default first. A template names the ones it is designed for in
   * `meta.themeIds`, by their ids here.
   */
  themes?: BundleTheme[];
  recordTypes?: BundleRecordType[];
  display?: BundleDisplay;
  /** The app's name, mark and About page. Absent, the app goes by WE's. */
  brand?: BundleBrand;
  /**
   * The sign-in screen, in place of WE's: any layout, drawn before anybody is signed in. It must
   * place the host's `CredentialField` — the one piece of it the app does not own — and is judged at
   * the chrome tier, as the app is. See `docs/architecture/protected-pieces.md`.
   */
  bootScreen?: SchemaNode;
}

/** Every theme a bundle brings, whichever of `theme` and `themes` it used. */
export function bundleThemes(bundle: Pick<Bundle, 'theme' | 'themes'>): BundleTheme[] {
  return bundle.themes ?? (bundle.theme ? [bundle.theme] : []);
}

/**
 * Why an SVG cannot be a brand's mark, or null when it can.
 *
 * It is drawn as an image, where nothing in it can run or load, so this is not what keeps anybody
 * safe; it keeps a brand honest. An `<svg>` root, and nothing that would mean something somewhere
 * else: no script, no event handler, no `javascript:`, no foreign HTML, and no reference to a file
 * or address outside itself (an `#id` or a `data:` URL is fine).
 */
export function svgProblem(svg: string): string | null {
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(svg))
    return 'is not SVG (it must start with <svg>)';
  if (/<script[\s/>]/i.test(svg)) return 'contains a script';
  if (/<foreignObject[\s/>]/i.test(svg)) return 'contains foreign HTML';
  if (/\son[a-z]+\s*=/i.test(svg)) return 'contains an event handler';
  if (/javascript:/i.test(svg)) return 'contains a javascript: URL';
  for (const match of svg.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']|url\(\s*["']?([^"')]*)/gi)) {
    const ref = (match[1] ?? match[2] ?? '').trim();
    if (ref && !ref.startsWith('#') && !ref.startsWith('data:')) return `refers to something outside itself (${ref})`;
  }
  return null;
}

/** Why a file is not a bundle this build can read, each with where in it. */
export interface BundleProblem {
  path: string;
  message: string;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENTITY_NAME = /^[A-Z][A-Za-z0-9]*$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read a decoded file as a bundle: the shape checked, nothing in it trusted.
 *
 * Structural only — whether each template is a template the renderer accepts, and what each reaches,
 * is judged in the app shell, which knows the component registry and the store surface. This answers
 * whether the file is a bundle at all, and finds the mistakes an author makes by hand: a duplicated
 * id, a display naming a template the bundle does not have, a record type whose manifest defines
 * something else.
 */
export function readBundle(
  input: unknown,
): { bundle: Bundle; problems: [] } | { bundle: null; problems: BundleProblem[] } {
  const problems: BundleProblem[] = [];
  const problem = (path: string, message: string) => problems.push({ path, message });

  if (!isObject(input)) return { bundle: null, problems: [{ path: '', message: 'Not a bundle: expected an object' }] };
  if (input.format !== BUNDLE_FORMAT)
    return {
      bundle: null,
      problems: [{ path: 'format', message: `Not a bundle: expected format "${BUNDLE_FORMAT}"` }],
    };
  if (input.formatVersion !== BUNDLE_FORMAT_VERSION)
    return {
      bundle: null,
      problems: [
        {
          path: 'formatVersion',
          message: `Made for bundle format ${String(input.formatVersion)}; this build reads format ${BUNDLE_FORMAT_VERSION}`,
        },
      ],
    };

  if (typeof input.id !== 'string' || !ID.test(input.id))
    problem('id', 'Needs an id of lowercase letters, digits and single dashes');
  for (const key of ['version', 'name'] as const) {
    if (typeof input[key] !== 'string' || !(input[key] as string).trim()) problem(key, `Needs a ${key}`);
  }
  for (const key of ['description', 'icon'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'string') problem(key, `${key} must be text`);
  }
  if (input.author !== undefined && !isObject(input.author)) problem('author', 'author must be an object');

  const ids = new Set<string>();
  const checkTemplate = (value: unknown, path: string, role: 'app' | 'page' | 'any') => {
    if (!isObject(value)) return problem(path, 'Not a template');
    const id = value.id;
    if (typeof id !== 'string' || !ID.test(id))
      problem(`${path}.id`, 'Needs an id of lowercase letters, digits and single dashes');
    else if (ids.has(id)) problem(`${path}.id`, `"${id}" is used twice`);
    else ids.add(id);
    const meta = value.meta;
    if (!isObject(meta)) return problem(`${path}.meta`, 'A template needs meta');
    if (role === 'app' && meta.role !== 'app') problem(`${path}.meta.role`, 'The app must have role "app"');
    if (role === 'page' && meta.role !== 'page') problem(`${path}.meta.role`, 'A page must have role "page"');
    if (role === 'any' && meta.role === 'app')
      problem(`${path}.meta.role`, 'An app goes in "app", not among the templates');
    if (role === 'any' && meta.role === 'page')
      problem(`${path}.meta.role`, 'A page goes in "pages", not among the templates');
  };

  if (input.app !== undefined) checkTemplate(input.app, 'app', 'app');
  if (input.templates !== undefined) {
    if (!Array.isArray(input.templates)) problem('templates', 'templates must be a list');
    else input.templates.forEach((template, index) => checkTemplate(template, `templates.${index}`, 'any'));
  }
  const pageIds = new Set<string>();
  if (input.pages !== undefined) {
    if (!Array.isArray(input.pages)) problem('pages', 'pages must be a list');
    else
      input.pages.forEach((page, index) => {
        checkTemplate(page, `pages.${index}`, 'page');
        if (isObject(page) && typeof page.id === 'string') pageIds.add(page.id);
      });
  }

  const themeIds = new Set<string>();
  const checkTheme = (theme: unknown, path: string) => {
    if (!isObject(theme)) return problem(path, 'Not a theme');
    if (typeof theme.id !== 'string' || !ID.test(theme.id))
      problem(`${path}.id`, 'Needs an id of lowercase letters, digits and single dashes');
    else if (themeIds.has(theme.id)) problem(`${path}.id`, `"${theme.id}" is used twice`);
    else themeIds.add(theme.id);
    if (typeof theme.name !== 'string' || !theme.name) problem(`${path}.name`, 'Needs a name');
    if (!isObject(theme.overrides)) problem(`${path}.overrides`, 'Needs its overrides');
    if (theme.css !== undefined && typeof theme.css !== 'string') problem(`${path}.css`, 'css must be text');
  };
  if (input.theme !== undefined && input.themes !== undefined)
    problem('themes', 'A bundle lists its themes in "themes" or brings one in "theme", not both');
  if (input.theme !== undefined) checkTheme(input.theme, 'theme');
  if (input.themes !== undefined) {
    if (!Array.isArray(input.themes)) problem('themes', 'themes must be a list');
    else input.themes.forEach((theme, index) => checkTheme(theme, `themes.${index}`));
  }

  if (input.brand !== undefined) {
    const brand = input.brand;
    if (!isObject(brand)) problem('brand', 'Not a brand');
    else {
      if (typeof brand.name !== 'string' || !brand.name.trim()) problem('brand.name', 'Needs the name the app goes by');
      for (const key of ['mark', 'wordmark'] as const) {
        if (brand[key] === undefined) continue;
        if (typeof brand[key] !== 'string') problem(`brand.${key}`, `${key} must be SVG source`);
        else {
          const why = svgProblem(brand[key] as string);
          if (why) problem(`brand.${key}`, `The ${key} ${why}`);
        }
      }
      if (brand.about !== undefined && typeof brand.about !== 'string') problem('brand.about', 'about must be text');
      if (brand.aboutPage !== undefined && !(typeof brand.aboutPage === 'string' && pageIds.has(brand.aboutPage)))
        problem('brand.aboutPage', `Names "${String(brand.aboutPage)}", which is not one of this bundle's pages`);
    }
  }

  if (input.bootScreen !== undefined && (!isObject(input.bootScreen) || typeof input.bootScreen.type !== 'string'))
    problem('bootScreen', 'The sign-in screen must be a template node');

  if (input.recordTypes !== undefined) {
    if (!Array.isArray(input.recordTypes)) problem('recordTypes', 'recordTypes must be a list');
    else {
      const names = new Set<string>();
      input.recordTypes.forEach((type, index) => {
        const path = `recordTypes.${index}`;
        if (!isObject(type)) return problem(path, 'Not a record type');
        const name = type.name;
        if (typeof name !== 'string' || !ENTITY_NAME.test(name))
          return problem(`${path}.name`, 'Needs a name in PascalCase');
        if (names.has(name)) problem(`${path}.name`, `"${name}" is defined twice`);
        names.add(name);
        const manifest = type.manifest;
        if (!isObject(manifest) || !isObject(manifest.entities))
          return problem(`${path}.manifest`, 'Needs a manifest with its entities');
        const defined = Object.keys(manifest.entities);
        if (defined.length !== 1 || defined[0] !== name)
          problem(
            `${path}.manifest`,
            `Must define exactly one entity, "${name}" — it defines ${defined.join(', ') || 'none'}`,
          );
      });
    }
  }

  if (input.display !== undefined) {
    const display = input.display;
    if (!isObject(display) || (display.spaces !== 'ours' && display.spaces !== 'theirs'))
      problem('display.spaces', 'Must be "ours" or "theirs"');
    else if (display.template !== undefined) {
      const shells = ((input.templates as unknown[]) ?? []).filter(
        (t) => isObject(t) && isObject(t.meta) && t.meta.role !== 'view',
      ) as Array<{ id?: unknown }>;
      if (!shells.some((t) => t.id === display.template))
        problem(
          'display.template',
          `Names "${String(display.template)}", which is not one of this bundle's space templates`,
        );
    } else if (display.spaces === 'ours') {
      problem('display.template', 'Showing every space "ours" needs the space template to show them with');
    }
  }

  if (
    input.app === undefined &&
    !(Array.isArray(input.templates) && input.templates.length) &&
    !(Array.isArray(input.pages) && input.pages.length) &&
    input.theme === undefined &&
    !(Array.isArray(input.themes) && input.themes.length)
  )
    problem('', 'A bundle with no app, no templates, no pages and no theme has nothing to install');

  return problems.length ? { bundle: null, problems } : { bundle: input as unknown as Bundle, problems: [] };
}

/**
 * The id a piece of a bundle is installed under: the bundle's id, two dashes, the piece's own.
 *
 * So a second install of the same bundle lands on the same records — an update, not a copy — and
 * nothing a bundle brings can take the id of a built-in or of somebody's own template. Two dashes
 * because an id never contains them (`readBundle` refuses it), so the split is unambiguous.
 */
export function bundlePieceId(bundleId: string, pieceId: string): string {
  return `${bundleId}--${pieceId}`;
}
