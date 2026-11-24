/**
 * The declared operations of the bundles this agent has — built in by the seed, or installed — held
 * in the registry under each bundle's id, and only while the bundle is there.
 *
 * The namespace is the install's to give, never the file's: a bundle's operations run as
 * `<bundle id>.<name>`, so one app cannot reach another's by naming it, nor replace WE's own. They
 * were judged when the bundle was installed (`judgeBundle` runs the static checks and refuses a bundle
 * whose operations fail them); what is registered here is what that judgement accepted, kept on the
 * install record because the file is gone by the time the app is next opened.
 */
import type { OperationDefinition } from '@we/backend-shared';
import { listOperations, registerOperations, unregisterOperations } from '@we/entities';

export interface BundleOperationsSource {
  id: string;
  version: string;
  operations?: Record<string, OperationDefinition>;
}

/** The namespaces this file put in the registry, so taking a bundle away takes only what it brought. */
const held = new Set<string>();

/**
 * Make the registry hold exactly these bundles' operations: register each, and withdraw any a bundle
 * no longer here brought. A namespace somebody else holds — `core`, a module's id — is refused with a
 * warning rather than replaced: a bundle named like a module must not take its operations over.
 */
export function syncBundleOperations(sources: readonly BundleOperationsSource[]): void {
  const others = new Set(
    listOperations()
      .map((name) => name.slice(0, name.indexOf('.')))
      .filter((namespace) => !held.has(namespace)),
  );
  others.add('core');
  const now = new Set<string>();
  for (const source of sources) {
    if (!source.operations || !Object.keys(source.operations).length) continue;
    if (others.has(source.id)) {
      console.warn(`bundle "${source.id}": its operations are not registered — "${source.id}" is already taken`);
      continue;
    }
    try {
      registerOperations(source.id, source.operations, { version: source.version });
      now.add(source.id);
    } catch (error) {
      console.warn(`bundle "${source.id}": its operations could not be registered`, error);
    }
  }
  for (const namespace of held) if (!now.has(namespace)) unregisterOperations(namespace);
  held.clear();
  for (const namespace of now) held.add(namespace);
}
