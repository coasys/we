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

export function lintModule(definition: ModuleDefinition): ModuleLint {
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
    const result = validateManifest(contributes.entities.manifest);
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

  return { problems, warnings };
}
