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
import type { TemplateSchema } from '@we/schema-shared';
import type { Fixture, FixtureAgent, FixtureRecord, FixtureShape, FixtureTheme } from '@we/template-fixtures';

export interface Cartridge {
  id: string;
  name: string;
  description: string;
  shell: TemplateSchema & { id: string };
  sections: Array<TemplateSchema & { id: string }>;
  theme: FixtureTheme;
  shapes: FixtureShape[];
  /** Modules the host must have. A cartridge names them; it cannot ship one. */
  modules: string[];
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
