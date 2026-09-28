/**
 * The module catalogue — what a schema may name of each module the seed ships.
 *
 * ## Read from the definitions, not from a list
 *
 * Every other catalogue here is derived from the thing it documents, and this one is no exception:
 * the seed names the modules, each package's `createModule` is called with an empty host, and the
 * definition it returns is the truth about its parts, panels, settings, activities, components,
 * functions, views, blocks and entities. The store is built once with inert deps so its **marked**
 * members can be read — the ones a template may reach — with the description each was marked with.
 *
 * ## Why this runs the store
 *
 * A member's kind and description live on the member itself (`deps.state` / `deps.action`), which
 * means the only way to list them is to have the store. Built against closures for signals, a no-op
 * effect and no kernels, which is the degraded host every store must already survive — a module that
 * cannot be constructed like that is a module that throws on a host without a transport, and is
 * reported rather than skipped.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EntityEntry, ModuleCatalogEntry, SourceEntry } from '@we/schema-shared';

interface SeedModule {
  id: string;
  package?: string;
}

interface DefinitionLike {
  manifest: {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    scope?: 'space' | 'agent';
    requires?: { backends?: string[]; frameworks?: string[]; kernels?: string[]; permissions?: string[] };
  };
  contributes?: {
    entities?: { manifest: ManifestLike; predicates?: Record<string, string> };
    parts?: Record<string, { node?: unknown; subject?: string } | { type?: string }>;
    panels?: { name: string; title: string; icon?: string; open?: string }[];
    launchers?: { key?: string; label: string }[];
    settings?: { key: string; label: string; description?: string; type: string; levels: readonly string[] }[];
    activities?: Record<string, Record<string, string>>;
    components?: Record<string, unknown>;
    functions?: { name: string; params: readonly string[]; doc: string; example: string }[];
    views?: { id?: string; meta?: { name?: string; segment?: string } }[];
    blocks?: { entity: string; nodeType?: string; card: string }[];
  };
  createStore?: (deps: unknown) => Record<string, unknown>;
}

interface ManifestLike {
  entities: Record<
    string,
    {
      extends?: string;
      properties?: Record<string, { type: string; required?: boolean; default?: unknown; predicate?: string }>;
      relations?: Record<string, { target?: string; cardinality: 'one' | 'many'; predicate?: string }>;
    }
  >;
}

/** The seed's module entries, as `{ id, package }`. */
export function seedModules(repoRoot: string): SeedModule[] {
  const seed = JSON.parse(readFileSync(resolve(repoRoot, 'we-seed.json'), 'utf-8')) as {
    modules?: (string | SeedModule)[];
  };
  return (seed.modules ?? []).map((entry) => (typeof entry === 'string' ? { id: entry } : entry));
}

/**
 * Build one module's catalogue entry from the definition its package exports.
 *
 * Takes the module-shared helpers as an argument rather than importing them, so this file has no
 * dependency on the contract package's build: the generator loads `@we/module-shared` once, beside
 * the module packages, and hands the helpers over.
 */
export function catalogueModule(
  definition: DefinitionLike,
  helpers: {
    moduleCapabilities: (definition: unknown) => string[];
    storeSurface: (store: unknown) => Record<string, { kind: 'state' | 'action'; doc: string }>;
    markState: unknown;
    markAction: unknown;
  },
): ModuleCatalogEntry {
  const { manifest, contributes } = definition;
  const id = manifest.id;

  let members: ModuleCatalogEntry['members'] = [];
  if (definition.createStore) {
    const store = definition.createStore({
      signal: <T>(initial: T): [() => T, (next: T) => void] => {
        let value = initial;
        return [() => value, (next: T) => void (value = next)];
      },
      effect: (fn: () => void) => {
        try {
          fn();
        } catch {
          // An effect that reaches a kernel this host does not lend is the ordinary degraded case.
        }
      },
      onDispose: () => {},
      state: helpers.markState,
      action: helpers.markAction,
      settings: () => ({}),
      kernels: {},
    });
    members = Object.entries(helpers.storeSurface(store))
      .map(([name, member]) => ({ name, kind: member.kind, doc: member.doc }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    id,
    name: manifest.name,
    ...(manifest.description ? { description: manifest.description } : {}),
    ...(manifest.icon ? { icon: manifest.icon } : {}),
    scope: manifest.scope ?? 'space',
    requires: manifest.requires ?? {},
    capabilities: helpers.moduleCapabilities(definition),
    members,
    parts: Object.entries(contributes?.parts ?? {}).map(([name, part]) => {
      const subject = 'node' in part ? (part as { subject?: string }).subject : undefined;
      return subject ? { name, subject } : { name };
    }),
    panels: (contributes?.panels ?? []).map((panel) => ({
      name: panel.name,
      title: panel.title,
      ...(panel.icon ? { icon: panel.icon } : {}),
      hostOwned: !panel.open,
    })),
    launchers: (contributes?.launchers ?? []).map((launcher) => ({
      key: launcher.key ? `${id}:${launcher.key}` : id,
      label: launcher.label,
    })),
    settings: (contributes?.settings ?? []).map((setting) => ({
      key: setting.key,
      label: setting.label,
      ...(setting.description ? { description: setting.description } : {}),
      type: setting.type,
      levels: [...setting.levels],
    })),
    activities: contributes?.activities ?? {},
    components: Object.keys(contributes?.components ?? {}).sort(),
    functions: (contributes?.functions ?? []).map<SourceEntry>((fn) => ({
      name: fn.name,
      params: [...fn.params],
      doc: fn.doc,
      example: fn.example,
    })),
    views: (contributes?.views ?? [])
      .filter((view) => view.id)
      .map((view) => ({
        id: view.id!,
        name: view.meta?.name ?? view.id!,
        ...(view.meta?.segment ? { segment: view.meta.segment } : {}),
      })),
    blocks: (contributes?.blocks ?? []).map((block) => ({
      entity: block.entity,
      nodeType: block.nodeType ?? block.entity.toLowerCase(),
      card: block.card,
    })),
    entities: contributes?.entities
      ? entityEntries(id, contributes.entities.manifest, contributes.entities.predicates)
      : [],
  };
}

/**
 * A module's manifest in the shape the Models section and the validator read core entities in.
 *
 * Predicates are shown as the compiler mints them — `we://module/<id>/<property>` unless the manifest
 * binds one explicitly — so the documented predicate is the stored one.
 */
function entityEntries(moduleId: string, manifest: ManifestLike, predicates?: Record<string, string>): EntityEntry[] {
  const minted = (entity: string, member: string, declared?: string) =>
    predicates?.[`${entity}.${member}`] ?? declared ?? `we://module/${moduleId}/${member}`;
  return Object.entries(manifest.entities).map(([name, entity]) => ({
    name,
    className: name,
    ...(entity.extends ? { extends: entity.extends } : {}),
    fields: Object.entries(entity.properties ?? {}).map(([field, spec]) => ({
      name: field,
      type: spec.type,
      predicate: minted(name, field, spec.predicate),
      required: spec.required ?? false,
      ...(spec.default !== undefined && spec.default !== '' && spec.default !== 0 && spec.default !== false
        ? { default: typeof spec.default === 'string' ? `'${spec.default}'` : String(spec.default) }
        : {}),
    })),
    relations: Object.entries(entity.relations ?? {}).map(([relation, spec]) => ({
      name: relation,
      kind: spec.cardinality === 'one' ? ('HasOne' as const) : ('HasMany' as const),
      predicate: minted(name, relation, spec.predicate),
      ...(spec.target ? { target: spec.target } : {}),
    })),
  }));
}

/**
 * Catalogue every module the seed ships.
 *
 * Each package is imported by name — `@we/module-<id>`, or the `package` the seed entry names — which
 * resolves to its built output, so the module packages build before the context is generated, as the
 * primitives do for their manifest. A package that cannot be loaded or constructed is reported and
 * skipped rather than failing the whole generation: the reference is still worth writing without it,
 * and the message names what to fix.
 */
export async function extractModules(repoRoot: string): Promise<ModuleCatalogEntry[]> {
  const shared = (await import('@we/module-shared')) as unknown as Parameters<typeof catalogueModule>[1];
  const out: ModuleCatalogEntry[] = [];
  for (const entry of seedModules(repoRoot)) {
    const pkg = entry.package ?? `@we/module-${entry.id}`;
    try {
      const loaded = (await import(pkg)) as {
        createModule?: (host: { components: Record<string, unknown> }) => DefinitionLike;
      };
      if (typeof loaded.createModule !== 'function') {
        console.warn(`  ⚠ ${pkg} exports no createModule; module "${entry.id}" is not catalogued`);
        continue;
      }
      // Components are the host's to lend; the catalogue only needs their names, which the module
      // records whatever it is handed.
      const definition = loaded.createModule({
        components: new Proxy({}, { get: (_target, name) => (typeof name === 'string' ? `<${name}>` : undefined) }),
      });
      out.push(catalogueModule(definition, shared));
      console.log(`  Module: ${entry.id} (${pkg})`);
    } catch (error) {
      console.warn(`  ⚠ could not catalogue module "${entry.id}" from ${pkg}: ${(error as Error).message}`);
    }
  }
  return out;
}
