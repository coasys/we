/**
 * Every registered operation, described for whoever offers it: a template's validator, the generated
 * reference, an agent's tools.
 *
 * Each entry is derived from the registry and the definition — name, description, params, whether it
 * returns anything, and its effect summary — so nothing that describes an operation can say what the
 * definition does not. A host adds its own reading on top (the capability group a write needs), from
 * the effects here rather than from anything written beside the operation.
 */
import type { OperationCategory, OperationParam } from '@we/backend-shared';

import { effectSummary, type OperationEffects, type OperationEffectVerb } from './effects';
import { getOperation, listOperations } from './registry';
import { CATEGORY_LABELS } from './values';

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
  return Object.keys(effects.entities).length > 0 || Object.keys(effects.categories).length > 0;
}

/**
 * The effect summary in words — "creates a Vote; edits a Poll; adds to Poll.votes; creates any block
 * type" — for a reader deciding whether to call it, and for the install screen.
 */
export function describeEffects(effects: OperationEffects): string {
  const parts: string[] = [];
  const say = (label: string, relation: (name: string) => string, verbs: readonly OperationEffectVerb[]) => {
    // A relation an expression chooses when the step runs is named as that.
    const relationOf = (name: string) => (name === '*' ? `any relation of ${label}` : relation(name));
    for (const verb of verbs) {
      if (verb === 'create') parts.push(`creates ${label}`);
      else if (verb === 'edit') parts.push(`edits ${label}`);
      else if (verb === 'delete') parts.push(`deletes ${label}`);
      else if (verb.startsWith('add:')) parts.push(`adds to ${relationOf(verb.slice(4))}`);
      else parts.push(`removes from ${relationOf(verb.slice(7))}`);
    }
  };
  for (const [entity, verbs] of Object.entries(effects.entities))
    say(
      entity === '*' ? 'a parent record' : `a ${entity}`,
      (name) => `${entity === '*' ? 'its parent' : entity}.${name}`,
      verbs,
    );
  // A category is named as itself — "creates any block type", "adds to thread on any block type".
  for (const [category, verbs] of Object.entries(effects.categories) as [OperationCategory, OperationEffectVerb[]][])
    say(CATEGORY_LABELS[category], (name) => `${name} on ${CATEGORY_LABELS[category]}`, verbs);
  if (!parts.length) return 'writes nothing';
  const sentence = parts.join('; ');
  const notes = [effects.bulk ? 'may write many records in one call' : '', effects.destructive ? 'destructive' : '']
    .filter(Boolean)
    .join(', ');
  return notes ? `${sentence} (${notes})` : sentence;
}
