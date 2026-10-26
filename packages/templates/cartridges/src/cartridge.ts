/**
 * What a cartridge is, for this spike: a whole app as data.
 *
 * Not a product format. This is the hand-built shape the spike uses to find out what a cartridge
 * needs, before any install flow, consent screen or file format is designed around it. Everything in
 * one is something the host already understands as data:
 *
 * - a **shell** template (chrome, routes, the `$views` outlet),
 * - **sections**: view templates (`meta.role: 'view'`), installed as the space's own `Template`
 *   records, which is how a runtime-installed section already arrives,
 * - a **theme**: the parameter object a theme is,
 * - **shapes**: the kinds of record the app is about, in the format the model wizard writes,
 * - the **modules** it needs the host to have (it cannot bring any),
 * - and **sample content**, so it can be judged with something in it.
 *
 * The ceiling it lives under: a cartridge cannot bring new code. It composes what the host has.
 */
import {
  type Bundle,
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  type BundleBrand,
  type BundleRecordType,
  type BundleTheme,
  type SchemaNode,
  type TemplateSchema,
} from '@we/schema-shared';
import type { Fixture, FixtureAgent, FixtureRecord, FixtureShape, FixtureTheme } from '@we/template-fixtures';

export interface Cartridge {
  id: string;
  name: string;
  description: string;
  /** The chrome around every space, when the app brings its own rather than WE's. */
  app?: TemplateSchema & { id: string };
  shell: TemplateSchema & { id: string };
  sections: Array<TemplateSchema & { id: string }>;
  theme: FixtureTheme;
  /** More themes the app offers beside `theme`, which stays its default. */
  themes?: BundleTheme[];
  /** Pages of the app's own (`meta.role: 'page'`) — its About page, a guide. */
  pages?: Array<TemplateSchema & { id: string }>;
  /** What the app calls itself — its name, mark and About page — when it is not WE. */
  brand?: BundleBrand;
  /** Its own sign-in screen, around the host's password field. */
  bootScreen?: SchemaNode;
  shapes: FixtureShape[];
  /** Modules the host must have. A cartridge names them; it cannot ship one. */
  modules: string[];
  /** How the app shows spaces: its own shell for every space, or each space's own. */
  display: 'ours' | 'theirs';
  sample: {
    space: { name: string; description: string; avatar?: string };
    agents: FixtureAgent[];
    records: FixtureRecord[];
    /** Where a preview should land. */
    route: string;
  };
}

/**
 * The cartridge as a fixture: installed into a preview space the way the real app would hold it after
 * an install — the shell and sections as the space's `Template` records, the theme as its `Theme`,
 * the shapes as its `Shape` records — plus the sample content.
 */
export function toFixture(cartridge: Cartridge): Fixture {
  return {
    id: cartridge.id,
    templateId: cartridge.shell.id,
    space: { ...cartridge.sample.space, enabledViews: cartridge.sections.map((section) => section.id) },
    agents: cartridge.sample.agents,
    content: [],
    shapes: cartridge.shapes,
    records: cartridge.sample.records,
    templates: [cartridge.shell, ...cartridge.sections] as Fixture['templates'],
    theme: cartridge.theme,
    modules: cartridge.modules,
    route: cartridge.sample.route,
  };
}

/**
 * A shape, written as `draftToManifest` writes one: an entity extending `WeNode`, flagged and with
 * every member under its own predicate, so it is indistinguishable from one a community made in the
 * model wizard.
 */
export function shape(
  name: string,
  options: {
    icon: string;
    description: string;
    hint?: string;
    title?: string;
    summary?: string;
    properties: Record<string, Record<string, unknown>>;
    relations?: Record<string, { target: string; cardinality: 'one' | 'many' }>;
  },
): FixtureShape {
  const base = `we://shape/cartridge-${name.toLowerCase()}`;
  const snake = (member: string) => member.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const withPredicate = <T extends Record<string, unknown>>(members: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(members).map(([member, spec]) => [member, { ...spec, predicate: `${base}/${snake(member)}` }]),
    );
  return {
    name,
    icon: options.icon,
    description: options.description,
    manifest: {
      version: '1',
      entities: {
        [name]: {
          extends: 'WeNode',
          flag: { predicate: 'we://flag', value: `${base}/${snake(name)}` },
          ...(options.hint ? { interpretationHint: options.hint } : {}),
          properties: withPredicate(options.properties),
          relations: withPredicate(options.relations ?? {}),
          ...(options.title
            ? { display: { title: options.title, ...(options.summary ? { summary: options.summary } : {}) } }
            : {}),
        },
      },
    },
  };
}

/**
 * The cartridge as a bundle: what a deployment ships in its seed, or a person installs from a file.
 *
 * Section ids lose the cartridge's own prefix (`field-guide-species` becomes `species`), since an
 * install puts the bundle's id in front of every piece anyway. The modules a cartridge needs travel
 * as its shell's `meta.requires.modules` — the place a template says what it leans on — so an install
 * screen finds them by walking, as it finds everything else. The sample content stays behind: a
 * bundle installs an app, not somebody else's records.
 */
export function toBundle(cartridge: Cartridge, version = '1.0.0'): Bundle {
  const piece = (id: string) => (id.startsWith(`${cartridge.id}-`) ? id.slice(cartridge.id.length + 1) : id);
  const shellId = piece(cartridge.shell.id) === cartridge.id ? 'shell' : piece(cartridge.shell.id);
  const shell = {
    ...cartridge.shell,
    id: shellId,
    meta: {
      ...cartridge.shell.meta,
      requires: { modules: [...new Set([...(cartridge.shell.meta.requires?.modules ?? []), ...cartridge.modules])] },
    },
  };
  const theme = { ...cartridge.theme, id: piece(cartridge.theme.id) };
  const extra = (cartridge.themes ?? []).map((t) => ({ ...t, id: piece(t.id) }));
  // Every theme the app offers, its default first — what a template names in `meta.themeIds`.
  const themeIds = extra.length ? { themeIds: [theme.id, ...extra.map((t) => t.id)] } : {};
  // The app wears the cartridge's theme too: it is what stands in for the agent's default until they
  // choose one, so the chrome and the space it frames open in the same look.
  const app = cartridge.app
    ? {
        ...cartridge.app,
        id: piece(cartridge.app.id),
        meta: { ...cartridge.app.meta, themeId: theme.id, ...themeIds },
      }
    : undefined;
  return {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    id: cartridge.id,
    version,
    name: cartridge.name,
    description: cartridge.description,
    icon: cartridge.shell.meta.icon ?? 'app-window',
    author: { name: 'WE' },
    ...(app ? { app } : {}),
    templates: [
      { ...shell, meta: { ...shell.meta, themeId: theme.id, ...themeIds } },
      ...cartridge.sections.map((section) => ({ ...section, id: piece(section.id) })),
    ],
    ...(cartridge.pages?.length ? { pages: cartridge.pages } : {}),
    ...(extra.length ? { themes: [theme, ...extra] } : { theme }),
    recordTypes: cartridge.shapes.map((shape) => ({
      name: shape.name,
      ...(shape.icon ? { icon: shape.icon } : {}),
      ...(shape.description ? { description: shape.description } : {}),
      manifest: shape.manifest as BundleRecordType['manifest'],
    })),
    display: cartridge.display === 'ours' ? { spaces: 'ours', template: shellId } : { spaces: 'theirs' },
    ...(cartridge.brand ? { brand: cartridge.brand } : {}),
    ...(cartridge.bootScreen ? { bootScreen: cartridge.bootScreen } : {}),
  };
}
