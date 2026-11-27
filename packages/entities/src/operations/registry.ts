/**
 * The declared operations this host can run, by namespace.
 *
 * The host fills it from whoever declared each manifest: `core` from this package's own manifest
 * (registered here, on load), a feature module's under its id, a bundle's under its id. The namespace
 * is the host's to assign, never the manifest's, so a bundle cannot claim `core` or another app's
 * names — it can only register what it brings under the name it was installed as.
 *
 * On `globalThis`, as the entity registry is, so two copies of this package in one bundle share it.
 */
import {
  type EntityManifest,
  inCategory,
  type OperationCategory,
  type OperationDefinition,
  operationsSchema,
  type OperationStep,
} from '@we/backend-shared';

import { CORE_MANIFEST } from '../manifest';
import { staticError } from './errors';
import { splitName } from './validate';
import { stepParts } from './values';

interface Registered {
  operations: Record<string, OperationDefinition>;
  version?: string;
  entities?: EntityManifest['entities'];
}

const REGISTRY_KEY = Symbol.for('we.operations.registry');
type GlobalOperations = { [REGISTRY_KEY]?: Map<string, Registered> };
const registry: Map<string, Registered> = ((globalThis as unknown as GlobalOperations)[REGISTRY_KEY] ??= new Map<
  string,
  Registered
>());

const NAMESPACE = /^[a-z][a-z0-9-]*$/;

/**
 * Register a manifest's operations under `namespace`, replacing what it held. Structure is checked
 * here and a malformed definition refused; the static checks that need the entities in view
 * (`validateOperations`) are the caller's, at the point it validates the manifest itself.
 *
 * `entities` are the declaring manifest's own, and are what a category in any operation's `oneOf`
 * is resolved against (see `categoryMembers`): a module's block entity is a block for `core`'s
 * operations from the moment the module is registered, and stops being one when it is withdrawn.
 * So a manifest that declares entities and no operations is registered too.
 */
export function registerOperations(
  namespace: string,
  operations: Record<string, OperationDefinition> | undefined,
  opts: { version?: string; entities?: EntityManifest['entities'] } = {},
): void {
  if (!NAMESPACE.test(namespace))
    throw staticError('malformed', `"${namespace}" is not a namespace: lowercase letters, digits and dashes`);
  const parsed = operationsSchema.safeParse(operations ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw staticError(
      'malformed',
      `The operations for "${namespace}" are not the format: ${first?.path.join('.')} ${first?.message}`,
    );
  }
  registry.set(namespace, { operations: parsed.data, version: opts.version, entities: opts.entities });
}

export function unregisterOperations(namespace: string): void {
  if (namespace === 'core') return;
  registry.delete(namespace);
}

/** A registered operation by qualified name (`core.createPost`), or undefined. */
export function getOperation(qualifiedName: string): OperationDefinition | undefined {
  const [namespace, name] = splitName(qualifiedName);
  const entry = registry.get(namespace);
  return entry && Object.prototype.hasOwnProperty.call(entry.operations, name) ? entry.operations[name] : undefined;
}

/** The version a namespace's operations were registered with, if any. */
export function operationsVersion(namespace: string): string | undefined {
  return registry.get(namespace)?.version;
}

/** Every namespace something is registered under, operations or only entities, sorted. */
export function listNamespaces(): string[] {
  return [...registry.keys()].sort();
}

/** The entities in a category, by the schema of whichever registered manifest declares each. */
export function categoryMembers(category: OperationCategory): Set<string> {
  const members = new Set<string>();
  for (const { entities } of registry.values())
    for (const [name, schema] of Object.entries(entities ?? {})) if (inCategory(schema, category)) members.add(name);
  return members;
}

/** Whether a registered manifest declares the entity abstract — a base nothing is ever made as. */
export function isAbstract(entity: string): boolean {
  for (const { entities } of registry.values()) if (entities?.[entity]?.abstract) return true;
  return false;
}

/** Every registered operation's qualified name, sorted. */
export function listOperations(): string[] {
  return [...registry.entries()]
    .flatMap(([ns, entry]) => Object.keys(entry.operations).map((n) => `${ns}.${n}`))
    .sort();
}

registerOperations('core', CORE_MANIFEST.operations, {
  version: CORE_MANIFEST.version,
  entities: CORE_MANIFEST.entities,
});

/**
 * The identity a registered operation keys `entity`'s records by (`identity` on a create naming it),
 * or undefined when none does. What lets a write made outside an operation (a space's starter
 * records) give a task state the id its `createTaskState` would, so the two name one record.
 */
export function identityOf(entity: string): readonly string[] | undefined {
  const walk = (steps: readonly OperationStep[]): readonly string[] | undefined => {
    for (const step of steps) {
      const { verb, body } = stepParts(step);
      if (verb === 'create' && body.entity === entity && Array.isArray(body.identity)) return body.identity as string[];
      if (verb === 'forEach') {
        const inner = walk(body.steps as OperationStep[]);
        if (inner) return inner;
      }
    }
    return undefined;
  };
  for (const { operations } of registry.values())
    for (const op of Object.values(operations)) {
      const found = walk(op.steps);
      if (found) return found;
    }
  return undefined;
}
