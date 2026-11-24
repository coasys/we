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
import type { OperationDefinition, OperationStep } from '@we/backend-shared';

import { stepParts } from './values';

export type OperationEffectVerb = 'create' | 'edit' | 'delete' | `add:${string}` | `remove:${string}`;

export interface OperationEffects {
  /** Verbs per entity, each list sorted. `*` stands for a parent whose entity the step does not name. */
  entities: Record<string, OperationEffectVerb[]>;
  bulk: boolean;
  destructive: boolean;
}

export interface EffectOptions {
  /** Resolves a called operation by qualified name. A call it cannot resolve contributes nothing. */
  operations?: (qualifiedName: string) => OperationDefinition | undefined;
}

export function effectSummary(op: OperationDefinition, opts: EffectOptions = {}): OperationEffects {
  const verbs = new Map<string, Set<OperationEffectVerb>>();
  let bulk = false;
  let destructive = false;
  const add = (entity: string, verb: OperationEffectVerb, inLoop: boolean) => {
    if (!verbs.has(entity)) verbs.set(entity, new Set());
    verbs.get(entity)!.add(verb);
    if (inLoop) bulk = true;
    if (verb === 'delete' || verb.startsWith('remove:')) destructive = true;
  };

  const visiting = new Set<OperationDefinition>();
  const visit = (steps: OperationStep[], inLoop: boolean) => {
    for (const step of steps) {
      const { verb, body } = stepParts(step);
      const entity = body.entity as string;
      switch (verb) {
        case 'create': {
          const oneOf = body.oneOf as string[] | undefined;
          for (const name of typeof body.entity === 'string' ? [body.entity] : (oneOf ?? []))
            add(name, 'create', inLoop);
          const parent = body.parent as { relation: string; entity?: string } | undefined;
          if (parent) add(parent.entity ?? '*', `add:${parent.relation}`, inLoop);
          break;
        }
        case 'update':
          add(entity, 'edit', inLoop);
          break;
        case 'delete':
          add(entity, 'delete', inLoop);
          break;
        case 'link':
        case 'unlink': {
          const oneOf = body.oneOf as string[] | undefined;
          const change = verb === 'link' ? 'add' : 'remove';
          for (const name of typeof body.entity === 'string' ? [body.entity] : (oneOf ?? []))
            add(name, `${change}:${body.relation as string}`, inLoop);
          break;
        }
        case 'setRelation':
          add(entity, `add:${body.relation as string}`, inLoop);
          add(entity, `remove:${body.relation as string}`, inLoop);
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
  return { entities, bulk, destructive };
}
