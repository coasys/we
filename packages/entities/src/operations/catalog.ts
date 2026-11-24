/**
 * Every registered operation, described for whoever offers it: a template's validator, the generated
 * reference, an agent's tools.
 *
 * Each entry is derived from the registry and the definition — name, description, params, whether it
 * returns anything, and its effect summary — so nothing that describes an operation can say what the
 * definition does not. A host adds its own reading on top (the capability group a write needs), from
 * the effects here rather than from anything written beside the operation.
 */
import type { OperationParam } from '@we/backend-shared';

import { effectSummary, type OperationEffects } from './effects';
import { getOperation, listOperations } from './registry';

export interface OperationCatalogEntry {
  /** Qualified: `core.createPost`, `polls.vote`. */
  name: string;
  description: string;
  params: Record<string, OperationParam>;
  /** Whether it answers with a value (`returns`) rather than nothing. */
  returns: boolean;
  effects: OperationEffects;
}

/** One registered operation, described; undefined when nothing is registered under the name. */
export function describeOperation(name: string): OperationCatalogEntry | undefined {
  const op = getOperation(name);
  if (!op) return undefined;
  return {
    name,
    description: op.description,
    params: op.params ?? {},
    returns: op.returns !== undefined,
    effects: effectSummary(op, { operations: getOperation }),
  };
}

/** Every registered operation, described, sorted by name. */
export function operationCatalog(): OperationCatalogEntry[] {
  return listOperations().flatMap((name) => {
    const entry = describeOperation(name);
    return entry ? [entry] : [];
  });
}

/** Whether an operation writes anything at all — a read that only answers is not a write. */
export function operationWrites(effects: OperationEffects): boolean {
  return Object.keys(effects.entities).length > 0;
}

/**
 * The effect summary in words — "creates a Vote; edits a Poll; adds to Poll.votes" — for a reader
 * deciding whether to call it, and for the install screen.
 */
export function describeEffects(effects: OperationEffects): string {
  const parts: string[] = [];
  for (const [entity, verbs] of Object.entries(effects.entities)) {
    const label = entity === '*' ? 'a parent record' : `a ${entity}`;
    for (const verb of verbs) {
      if (verb === 'create') parts.push(`creates ${label}`);
      else if (verb === 'edit') parts.push(`edits ${label}`);
      else if (verb === 'delete') parts.push(`deletes ${label}`);
      else if (verb.startsWith('add:'))
        parts.push(`adds to ${entity === '*' ? 'its parent' : entity}.${verb.slice(4)}`);
      else parts.push(`removes from ${entity === '*' ? 'its parent' : entity}.${verb.slice(7)}`);
    }
  }
  if (!parts.length) return 'writes nothing';
  const sentence = parts.join('; ');
  const notes = [effects.bulk ? 'may write many records in one call' : '', effects.destructive ? 'destructive' : '']
    .filter(Boolean)
    .join(', ');
  return notes ? `${sentence} (${notes})` : sentence;
}
