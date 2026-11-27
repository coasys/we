/**
 * What an operation may write, worked out from its definition without running it.
 *
 * Per entity, the verbs it may perform — `create`, `edit`, `delete`, `add:<relation>`,
 * `remove:<relation>` — unioned over every branch (a `when` may skip a step; the summary says what it
 * could do, not what it will) and over every operation it calls. `bulk` when any write sits inside a
 * `forEach`, so one press may make many; `destructive` when it deletes or takes a record out of a
 * relation (an unlink, or a `setRelation`, which may drop members).
 *
 * The capability group an operation needs is the host's to derive from this, through its own table of
 * entities to groups: this package knows entities, not what a host calls a permission.
 */
import type { OneOfEntry, OperationCategory, OperationDefinition, OperationStep } from '@we/backend-shared';

import { stepParts } from './values';

export type OperationEffectVerb = 'create' | 'edit' | 'delete' | `add:${string}` | `remove:${string}`;

export interface OperationEffects {
  /**
   * Verbs per entity, each list sorted. `*` stands for a parent whose entity the step does not name;
   * `add:*` / `remove:*` for a relation an expression chooses when the step runs.
   */
  entities: Record<string, OperationEffectVerb[]>;
  /**
   * Verbs per category a `oneOf` names, each list sorted: `create` on `blockable` is "may create any
   * block type", `delete` on `any` "may delete a record of any type". Kept as the category rather than its members, which are whatever the host has
   * registered when it runs, so the summary stays finite and does not change as modules come and go.
   */
  categories: Partial<Record<OperationCategory, OperationEffectVerb[]>>;
  bulk: boolean;
  destructive: boolean;
}

export interface EffectOptions {
  /** Resolves a called operation by qualified name. A call it cannot resolve contributes nothing. */
  operations?: (qualifiedName: string) => OperationDefinition | undefined;
}

/** A step's relation as the summary lists it: its name, or `*` for one an expression chooses. */
const relationName = (body: Record<string, unknown>): string =>
  typeof body.relation === 'string' ? body.relation : '*';

export function effectSummary(op: OperationDefinition, opts: EffectOptions = {}): OperationEffects {
  const verbs = new Map<string, Set<OperationEffectVerb>>();
  const byCategory = new Map<OperationCategory, Set<OperationEffectVerb>>();
  let bulk = false;
  let destructive = false;
  const note = (verb: OperationEffectVerb, inLoop: boolean) => {
    if (inLoop) bulk = true;
    if (verb === 'delete' || verb.startsWith('remove:')) destructive = true;
  };
  const add = (entity: string, verb: OperationEffectVerb, inLoop: boolean) => {
    if (!verbs.has(entity)) verbs.set(entity, new Set());
    verbs.get(entity)!.add(verb);
    note(verb, inLoop);
  };
  /** A named entity, or each entry of its `oneOf`, a category counted as itself. */
  const addChosen = (body: Record<string, unknown>, verb: OperationEffectVerb, inLoop: boolean) => {
    if (typeof body.entity === 'string') return add(body.entity, verb, inLoop);
    for (const entry of (body.oneOf as OneOfEntry[] | undefined) ?? []) {
      if (typeof entry === 'string') add(entry, verb, inLoop);
      else {
        if (!byCategory.has(entry.category)) byCategory.set(entry.category, new Set());
        byCategory.get(entry.category)!.add(verb);
        note(verb, inLoop);
      }
    }
  };

  const visiting = new Set<OperationDefinition>();
  const visit = (steps: OperationStep[], inLoop: boolean) => {
    for (const step of steps) {
      const { verb, body } = stepParts(step);
      switch (verb) {
        case 'create': {
          addChosen(body, 'create', inLoop);
          const parent = body.parent as { relation: string; entity?: string } | undefined;
          if (parent) add(parent.entity ?? '*', `add:${parent.relation}`, inLoop);
          break;
        }
        case 'update':
          addChosen(body, 'edit', inLoop);
          break;
        case 'delete':
          addChosen(body, 'delete', inLoop);
          break;
        case 'link':
        case 'unlink': {
          addChosen(body, `${verb === 'link' ? 'add' : 'remove'}:${relationName(body)}`, inLoop);
          break;
        }
        case 'setRelation':
          addChosen(body, `add:${relationName(body)}`, inLoop);
          addChosen(body, `remove:${relationName(body)}`, inLoop);
          break;
        case 'forEach':
          visit(body.steps as OperationStep[], true);
          break;
        case 'call': {
          const callee = opts.operations?.(body.operation as string);
          // The call graph is acyclic once validated; the guard keeps an unvalidated one finite.
          if (!callee || visiting.has(callee)) break;
          visiting.add(callee);
          visit(callee.steps, inLoop);
          visiting.delete(callee);
          break;
        }
        default:
          break;
      }
    }
  };
  visiting.add(op);
  visit(op.steps, false);

  const entities: Record<string, OperationEffectVerb[]> = {};
  for (const name of [...verbs.keys()].sort()) entities[name] = [...verbs.get(name)!].sort();
  const categories: OperationEffects['categories'] = {};
  for (const name of [...byCategory.keys()].sort()) categories[name] = [...byCategory.get(name)!].sort();
  return { entities, categories, bulk, destructive };
}
