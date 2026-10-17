/**
 * What installing a bundle would mean, worked out before anything is written.
 *
 * Everything an install screen shows comes from here, and all of it is derived from what the bundle's
 * templates actually reach — never from a list the author wrote. A claim and a fact can disagree, and
 * the screen is where somebody decides whether to trust a stranger's app.
 *
 * Each template is judged at the tier it will be drawn with: the app around every space at the chrome
 * tier, because it is drawn as the agent's own chrome, and space templates and sections at the space
 * tier, the tier every space's template has. So "what it will be able to do" is the union of what each
 * piece can reach where it lands.
 *
 * Pure apart from what is passed in, so the decisions are testable without an app.
 */
import { type EntityManifest, validateManifest } from '@we/backend-shared';
import type { Bundle, TemplateSchema } from '@we/schema-shared';

import { type CapabilityGroup, CHROME_TIER, SPACE_TIER } from '../registries/templateSurface';
import { acceptTemplate, describeCapabilities } from '../templateAcceptance';

/** What the judge needs to know about this build and this agent. */
export interface BundleJudgeDeps {
  /** Modules a template mounts components from — `moduleRegistry.requiredBy`. */
  requiredBy(schema: TemplateSchema): string[];
  /** Whether this build has the module at all. */
  hasModule(id: string): boolean;
  /** Whether this agent has it on. */
  moduleInstalled(id: string): boolean;
  /** What a module is called, for the screen. */
  moduleName(id: string): string;
  /**
   * The names a bundle's record types may refer to and must not take: WE's own vocabulary. Not a
   * space's — an install writes to a person's library, and whether a record type fits a space is
   * asked of each space as it is set up (`shapeStore.addRecordTypes`).
   */
  knownEntities: readonly string[];
}

export interface BundleJudgement {
  bundle: Bundle;
  /** Pieces that cannot be installed, each said in a sentence. Non-empty means refuse the bundle. */
  refusals: string[];
  /** What each piece is called, for "it adds…". */
  adds: { app?: string; spaceTemplates: string[]; sections: string[]; theme?: string; recordTypes: string[] };
  /** What it will be able to do, in the words a person reads. */
  capabilities: string[];
  /** The same, as the groups those words describe — what a later version is compared against. */
  groups: CapabilityGroup[];
  /** Every module it needs, by id, whether on, off or absent. */
  modules: string[];
  /** References it makes that its tier does not grant, which will resolve to nothing. */
  blocked: string[];
  /** Modules it needs that this agent has turned off, which installing turns on. */
  modulesToTurnOn: { id: string; name: string }[];
  /** Modules this build does not have. Those parts of the app will be empty; nothing can fix that here. */
  modulesNotInBuild: string[];
}

/** Every module a template reaches by name — a part it places, a store it reads, one it says it needs. */
export function modulesNamedBy(schema: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\bmodules\.([a-z][a-z0-9-]*)/g)) found.add(match[1]);
      return;
    }
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.type === '$part') {
      const id = (record.props as { id?: unknown } | undefined)?.id;
      // A host part (`host.sidebar`) is the host's own, never a module.
      if (typeof id === 'string' && id.includes('.') && !id.startsWith('host.')) found.add(id.split('.')[0]);
    }
    for (const entry of Object.values(record)) visit(entry);
  };
  visit(schema);
  const requires = (schema as TemplateSchema | undefined)?.meta?.requires?.modules ?? [];
  for (const id of requires) found.add(id);
  return [...found];
}

export function judgeBundle(bundle: Bundle, deps: BundleJudgeDeps): BundleJudgement {
  const refusals: string[] = [];
  const groups = new Set<CapabilityGroup>();
  const blocked = new Set<string>();
  const modules = new Set<string>();

  const judge = (template: TemplateSchema, grants: readonly CapabilityGroup[], label: string) => {
    const accepted = acceptTemplate(template, { origin: `the bundle "${bundle.name}"`, grants });
    if (!accepted.schema) {
      refusals.push(
        `${label} is not a template this app can draw — ${accepted.refusals.slice(1, 2).join('') || 'its structure is invalid'}`,
      );
      return;
    }
    accepted.groups.forEach((group) => groups.add(group));
    accepted.blocked.forEach((reference) => blocked.add(reference.path));
    accepted.refusedElements.forEach((tag) => blocked.add(`<${tag}>`));
    for (const id of [...deps.requiredBy(accepted.schema), ...modulesNamedBy(accepted.schema)]) modules.add(id);
  };

  const shells = (bundle.templates ?? []).filter((t) => t.meta?.role !== 'view');
  const sections = (bundle.templates ?? []).filter((t) => t.meta?.role === 'view');
  if (bundle.app) judge(bundle.app, CHROME_TIER, `Its app "${bundle.app.meta?.name ?? bundle.app.id}"`);
  for (const template of [...shells, ...sections])
    judge(template, SPACE_TIER, `"${template.meta?.name ?? template.id}"`);

  // A record type is validated against the core vocabulary and the bundle's other record types — so
  // a sighting may point at a species the same bundle brings.
  const recordNames = (bundle.recordTypes ?? []).map((type) => type.name);
  for (const type of bundle.recordTypes ?? []) {
    const clash = deps.knownEntities.includes(type.name);
    if (clash) {
      refusals.push(`Its record type "${type.name}" has the name of one WE already has`);
      continue;
    }
    const gate = validateManifest(type.manifest as EntityManifest, {
      externalEntities: [...deps.knownEntities, ...recordNames.filter((name) => name !== type.name)],
    });
    if (!gate.valid)
      refusals.push(
        `Its record type "${type.name}" is not a valid definition — ${gate.errors[0]?.path}: ${gate.errors[0]?.message}`,
      );
  }

  const needed = [...modules].sort();
  return {
    bundle,
    refusals,
    adds: {
      ...(bundle.app ? { app: bundle.app.meta?.name ?? bundle.name } : {}),
      spaceTemplates: shells.map((t) => t.meta?.name ?? t.id),
      sections: sections.map((t) => t.meta?.name ?? t.id),
      ...(bundle.theme ? { theme: bundle.theme.name } : {}),
      recordTypes: recordNames,
    },
    capabilities: describeCapabilities([...groups]),
    groups: [...groups].sort(),
    modules: needed,
    blocked: [...blocked],
    modulesToTurnOn: needed
      .filter((id) => deps.hasModule(id) && !deps.moduleInstalled(id))
      .map((id) => ({ id, name: deps.moduleName(id) })),
    modulesNotInBuild: needed.filter((id) => !deps.hasModule(id)),
  };
}

/** Every template a bundle carries, its app first. */
export function bundleTemplates(bundle: Bundle): Array<TemplateSchema & { id: string }> {
  return [...(bundle.app ? [bundle.app] : []), ...(bundle.templates ?? [])];
}
