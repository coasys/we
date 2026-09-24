/**
 * What is wrong with a definition before anything registers it.
 *
 * The registry refuses a module for some of these and warns about the rest; a module author wants
 * the same answers before there is a registry — in a test, in a scaffold's check, in CI. So the pure
 * half of the registry's judgement lives here, in the contract package, and the registry calls it.
 * Nothing here touches a registry, a store or a host: it is a definition in, sentences out.
 *
 * `problems` are refusals — the module does not register. `warnings` are declarations that are inert
 * or misleading but not worth taking the module out of the app over.
 */
import { validateManifest } from '@we/backend-shared';

import type { ModuleDefinition } from './module';
import { modulePredicatePrefix, modulePredicateViolations } from './module';

export interface ModuleLint {
  problems: string[];
  warnings: string[];
}

/**
 * The host entity every module entity may extend without saying so: the node that carries
 * comments, signals, participants and mentions. Named here, rather than looked up, so a module
 * author's own test judges `extends: 'WeNode'` the way the registry does without importing WE's
 * whole vocabulary. Anything else outside the module — a relation to `LocationBlock` — is named by
 * the caller through `externalEntities`, as the registry does with the core manifest.
 */
const HOST_BASE_ENTITIES = ['WeNode'];

/**
 * Every expression and handler string in a lump of contributed data, with the kind of slot it sat in.
 *
 * A generic walk rather than the structural one in `@we/schema-shared`'s `treeUtils`, and the
 * difference matters for a lint: a structural walk follows the edges a *renderer* follows, so it
 * steps over an expression buried in a `DropdownMenu`'s `items` array, a `$queries` where-clause or a
 * `styles` value — all of which are places a reference to another module would work perfectly and go
 * unreported. A lint wants every string that could possibly be resolved, so it reads the data as
 * data.
 *
 * Deliberately never walks `contributes.components`, which holds framework values rather than data.
 */
function collectReferences(value: unknown, out: { expressions: string[]; parts: string[] }): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectReferences(entry, out);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  const record = value as Record<string, unknown>;

  // A `$part` places another fragment by name — `<moduleId>.<part>`.
  if (record.type === '$part') {
    const id = (record.props as Record<string, unknown> | undefined)?.id;
    if (typeof id === 'string') out.parts.push(id);
  }

  for (const [key, entry] of Object.entries(record)) {
    // `{ $: '…' }` is a value expression and `{ $action: '…' }` a handler. Both resolve a store path,
    // and both are how a reference to another module's store would be written.
    if ((key === '$' || key === '$action') && typeof entry === 'string') out.expressions.push(entry);
    else collectReferences(entry, out);
  }
}

/** Which module a `modules.x.y` reference names, or null for anything that is not one. */
function moduleReference(expression: string): { id: string; member: string }[] {
  // Every occurrence, not the first: one expression can name two modules, and reporting one of them
  // would have an author fix it and hit the lint again.
  const found: { id: string; member: string }[] = [];
  // A bare `modules.<id>` — the sanctioned "is this installed at all" check — is deliberately not
  // matched: the member group requires the dot.
  const pattern = /\bmodules\.([a-z][a-z0-9-]*)\.([A-Za-z_$][\w$]*)/g;
  for (const match of expression.matchAll(pattern)) found.push({ id: match[1], member: match[2] });
  return found;
}

export function lintModule(
  definition: ModuleDefinition,
  opts: { externalEntities?: Iterable<string> } = {},
): ModuleLint {
  const problems: string[] = [];
  const warnings: string[] = [];
  const { manifest, contributes } = definition;

  if (!manifest?.id) problems.push('manifest.id is required');
  else if (!/^[a-z][a-z0-9-]*$/.test(manifest.id)) {
    problems.push(
      `manifest.id "${manifest.id}" must be lower-case letters, digits and dashes — it names a store, a predicate subtree and a package`,
    );
  }
  if (!manifest?.name) problems.push('manifest.name is required');

  const seen = new Set<string>();
  for (const panel of contributes?.panels ?? []) {
    if (!panel.name) problems.push('every panel needs a name — the dock id and a remembered placement are keyed by it');
    else if (seen.has(panel.name)) problems.push(`two panels are named "${panel.name}"`);
    seen.add(panel.name);
    if (panel.open && !panel.close) {
      warnings.push(
        `panel "${panel.name}" owns its open flag but names no close action, so the titlebar cannot dismiss it`,
      );
    }
    if (!panel.open && (panel.show || panel.close)) {
      warnings.push(
        `panel "${panel.name}" names show/close without open; the host holds the flag, so they are never called`,
      );
    }
  }

  if (
    contributes?.components &&
    Object.keys(contributes.components).length &&
    !manifest?.requires?.frameworks?.length
  ) {
    problems.push('contributes framework components without declaring requires.frameworks');
  }

  if (manifest?.id && contributes?.entities) {
    // Predicates are how existing data is found, so minting one outside the module's own subtree is
    // not a bug to fix later — by the time it is noticed, data has been written under a name nobody
    // can adjudicate. Declared entities mint under the subtree by construction; the only way a bad
    // predicate enters is an explicit override.
    const bad = modulePredicateViolations(manifest.id, Object.values(contributes.entities.predicates ?? {}));
    if (bad.length)
      problems.push(`declares predicates outside ${modulePredicatePrefix(manifest.id)}: ${bad.join(', ')}`);

    // Validated here, not when eventually compiled: compilation runs on the first dataset switch, so
    // a malformed manifest would otherwise register fine and fail far from the module that shipped it.
    const result = validateManifest(contributes.entities.manifest, {
      externalEntities: [...HOST_BASE_ENTITIES, ...(opts.externalEntities ?? [])],
    });
    if (!result.valid) {
      for (const error of result.errors) problems.push(`invalid entities manifest at ${error.path}: ${error.message}`);
    }
  }

  for (const setting of contributes?.settings ?? []) {
    if (setting.resolution === 'restrict' && setting.default === false) {
      warnings.push(`setting "${setting.key}" is restrict and defaults to false, so no level can ever turn it on`);
    }
    if (setting.type === 'enum' && !setting.options?.length) {
      warnings.push(`setting "${setting.key}" is an enum with no options`);
    }
    if (setting.type === 'secret') {
      if (setting.levels.some((level) => level !== 'agent')) {
        warnings.push(
          `setting "${setting.key}" is a secret offered above the agent level; only the agent level is honoured`,
        );
      }
      if (!manifest?.requires?.kernels?.includes('secrets')) {
        warnings.push(
          `setting "${setting.key}" is a secret but the manifest does not require the secrets kernel, so nothing can read it`,
        );
      }
    }
  }

  const parts = contributes?.parts ?? {};
  for (const block of contributes?.blocks ?? []) {
    if (!contributes?.entities?.manifest.entities[block.entity]) {
      problems.push(`block "${block.entity}" names an entity the manifest does not declare`);
    } else if (!contributes.entities.manifest.entities[block.entity].blockable) {
      warnings.push(
        `block "${block.entity}" is not marked blockable in the manifest, so the composer will not offer it`,
      );
    }
    if (!parts[block.card])
      problems.push(`block "${block.entity}" names card part "${block.card}", which the module does not publish`);
    if (block.input && !contributes?.components?.[block.input]) {
      problems.push(
        `block "${block.entity}" names input component "${block.input}", which the module does not contribute`,
      );
    }
  }

  for (const view of contributes?.views ?? []) {
    if (!view.id) problems.push('a contributed view has no id; a space cannot enable it');
    else if (view.meta?.role !== 'view') problems.push(`view "${view.id}" is not marked meta.role: 'view'`);
  }

  for (const launcher of contributes?.launchers ?? []) {
    if (!launcher.action) problems.push(`launcher "${launcher.label}" names no action`);
  }

  if (manifest?.id) crossModuleReferences(manifest.id, definition, problems, warnings);

  return { problems, warnings };
}

/**
 * A module reaching into another module's store, which is the one shape the contract refuses.
 *
 * ## Why this is worth a lint rather than a paragraph
 *
 * `docs/architecture/capabilities-and-surfaces.md` states the rule and the reason: modules here are
 * per-space switches rather than build-time packages, so a dependency turns one toggle into a graph a
 * person has to reason about — a community switching calls off and three unrelated things going dark,
 * in a settings screen that said nothing about them. It also pins one module to another's store API,
 * which is its most volatile surface.
 *
 * The rule held for the first seven modules by review alone, and the near misses are still visible in
 * the source as comments: the call module explains why its transcription toggle is an anchor rather
 * than a reference to `modules.transcribe.*`, and transcribe's panel explains why it stopped reading
 * `modules.call.liveCalls`. Both are one edit from coming back, and neither would fail anything.
 *
 * ## What is allowed, which is most of it
 *
 * - **A bare `modules.<id>`**, the sanctioned way to ask whether an optional module is installed at
 *   all. It resolves to nothing where the module is absent, so a surface gated on it degrades to
 *   "nothing matched" — see the same pattern in templates.
 * - **Sharing code at build time.** Two modules importing one package is packaging, not a runtime
 *   dependency, and is how the globe family already works. Nothing here sees an import.
 * - **Everything the media carry.** Records, presence activities, anchors and the graph are how
 *   capabilities are supposed to meet, and none of them names a module.
 *
 * ## Chrome refuses, a view warns
 *
 * A module's own chrome — its parts, panels and slots — is refused, because it renders whenever the
 * module does and a dead reference in it is a broken surface with no explanation.
 *
 * A contributed **view** is warned about instead, because a view is a template: it is separately
 * enabled per space, and naming a module is what templates legitimately do. The hazard is real but
 * different — a space that enables the view without the other module gets a section that silently
 * renders nothing — and templates already have the answer, which is `meta.requires.modules` plus a
 * bare-read gate. So this says which, rather than refusing a shape that is correct in a template.
 */
function crossModuleReferences(id: string, definition: ModuleDefinition, problems: string[], warnings: string[]): void {
  const { contributes } = definition;

  const report = (where: string, source: unknown, add: (message: string) => void, advice: string) => {
    const found = { expressions: [] as string[], parts: [] as string[] };
    collectReferences(source, found);

    const named = new Set<string>();
    for (const expression of found.expressions) {
      for (const reference of moduleReference(expression)) {
        if (reference.id === id || named.has(`${reference.id}.${reference.member}`)) continue;
        named.add(`${reference.id}.${reference.member}`);
        add(
          `${where} reads modules.${reference.id}.${reference.member} — a module may not reach another module's store. ${advice}`,
        );
      }
    }
    for (const part of found.parts) {
      const owner = part.split('.')[0];
      if (!owner || owner === id || named.has(`part:${part}`)) continue;
      named.add(`part:${part}`);
      add(`${where} places "${part}", which belongs to the ${owner} module. ${advice}`);
    }
  };

  const chromeAdvice =
    'Capabilities meet in a medium the host provides — a record, a presence activity, or an anchor both modules contribute to. See docs/architecture/capabilities-and-surfaces.md.';
  const viewAdvice =
    'A view is a template, so this is allowed — but declare it in the view\'s meta.requires.modules and gate the surface on a bare { $: "modules.<id>" } so a space without that module renders nothing rather than something broken.';

  // Named one at a time so the message can say which surface, which is the part an author needs.
  for (const [name, part] of Object.entries(contributes?.parts ?? {})) {
    report(`part "${name}"`, part, (m) => problems.push(m), chromeAdvice);
  }
  for (const panel of contributes?.panels ?? []) {
    report(`panel "${panel.name}"`, panel.node, (m) => problems.push(m), chromeAdvice);
  }
  for (const [index, slot] of (contributes?.slots ?? []).entries()) {
    report(`slot ${index} (anchor "${slot.anchor}")`, slot.node, (m) => problems.push(m), chromeAdvice);
  }
  for (const view of contributes?.views ?? []) {
    report(`view "${view.id}"`, view, (m) => warnings.push(m), viewAdvice);
  }
}
