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

import type { TemplateSchema } from './types';

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
  theme?: BundleTheme;
  recordTypes?: BundleRecordType[];
  display?: BundleDisplay;
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
  const checkTemplate = (value: unknown, path: string, role: 'app' | 'space' | 'any') => {
    if (!isObject(value)) return problem(path, 'Not a template');
    const id = value.id;
    if (typeof id !== 'string' || !ID.test(id))
      problem(`${path}.id`, 'Needs an id of lowercase letters, digits and single dashes');
    else if (ids.has(id)) problem(`${path}.id`, `"${id}" is used twice`);
    else ids.add(id);
    const meta = value.meta;
    if (!isObject(meta)) return problem(`${path}.meta`, 'A template needs meta');
    if (role === 'app' && meta.role !== 'app') problem(`${path}.meta.role`, 'The app must have role "app"');
    if (role === 'any' && meta.role === 'app')
      problem(`${path}.meta.role`, 'An app goes in "app", not among the templates');
  };

  if (input.app !== undefined) checkTemplate(input.app, 'app', 'app');
  if (input.templates !== undefined) {
    if (!Array.isArray(input.templates)) problem('templates', 'templates must be a list');
    else input.templates.forEach((template, index) => checkTemplate(template, `templates.${index}`, 'any'));
  }

  if (input.theme !== undefined) {
    const theme = input.theme;
    if (!isObject(theme)) problem('theme', 'Not a theme');
    else {
      if (typeof theme.id !== 'string' || !ID.test(theme.id))
        problem('theme.id', 'Needs an id of lowercase letters, digits and single dashes');
      if (typeof theme.name !== 'string' || !theme.name) problem('theme.name', 'Needs a name');
      if (!isObject(theme.overrides)) problem('theme.overrides', 'Needs its overrides');
      if (theme.css !== undefined && typeof theme.css !== 'string') problem('theme.css', 'css must be text');
    }
  }

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
    input.theme === undefined
  )
    problem('', 'A bundle with no app, no templates and no theme has nothing to install');

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
