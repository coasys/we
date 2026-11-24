/**
 * The static checks a manifest's operations must pass before anything runs them.
 *
 * Structure is the manifest schema's (`operationsSchema` in `@we/backend-shared`); this is what it
 * cannot see: whether every name an expression reads is bound where it reads it, whether every
 * entity, field and relation exists, whether every call resolves and the calls form no cycle. Each
 * issue carries a path to the step (`operations.vote.steps.2.forEach.steps.0.create.fields.text`), so
 * an author — or a language model writing one — can fix the exact place.
 *
 * Here rather than in `validateManifest` because it needs the expression language, which the backend
 * contract cannot depend on. Whoever validates a manifest that may carry operations calls both: the
 * bundle judge does, and so does this package's own test of its core operations.
 */
import {
  type EntityManifest,
  type EntitySchema,
  inCategory,
  type ManifestError,
  OPERATION_CATEGORIES,
  type OperationCategory,
  type OperationDefinition,
  type OperationStep,
  type PropertySchema,
  type RelationSchema,
} from '@we/backend-shared';
import { checkExpression, EXPRESSION_KEYWORDS, parseExpression, referencedRoots } from '@we/expressions';

import {
  expressionsIn,
  INVOCATION_NAMES,
  isExpressionToken,
  isPlainObject,
  MAX_FOREACH_DEPTH,
  PROTECTED_ENTITIES,
  stepParts,
} from './values';

export type OperationIssue = ManifestError;

export interface ValidateOperationsOptions {
  /** The namespace these operations run under, so a call to `<namespace>.<name>` finds its sibling. */
  namespace?: string;
  /**
   * Entities declared elsewhere that these operations may read and write — WE's core vocabulary
   * for a module's or a bundle's manifest, a bundle's other record types.
   */
  external?: EntityManifest | EntityManifest['entities'];
  /** Operations in other namespaces, by qualified name — what a call outside this manifest reaches. */
  operations?: (qualifiedName: string) => OperationDefinition | undefined;
}

/** Fields every record has, whatever its entity declares. Readable, never written. */
const RECORD_METADATA = new Set(['id', 'author', 'createdAt', 'updatedAt', 'timestamp']);
const WHERE_COMBINATORS = new Set(['OR', 'AND', 'NOT']);

interface EntityView {
  properties: Record<string, PropertySchema>;
  relations: Record<string, RelationSchema>;
  abstract: boolean;
}

export function validateOperations(manifest: EntityManifest, opts: ValidateOperationsOptions = {}): OperationIssue[] {
  const issues: OperationIssue[] = [];
  const operations = manifest.operations ?? {};
  const external =
    opts.external && 'entities' in opts.external && isPlainObject(opts.external.entities)
      ? (opts.external as EntityManifest).entities
      : ((opts.external ?? {}) as Record<string, EntitySchema>);
  const declared = (name: string): EntitySchema | undefined => manifest.entities[name] ?? external[name];

  /** An entity with what it inherits, or undefined when nothing declares it. */
  const views = new Map<string, EntityView | undefined>();
  const view = (name: string): EntityView | undefined => {
    if (views.has(name)) return views.get(name);
    views.set(name, undefined);
    const own = declared(name);
    if (!own) return undefined;
    const base = own.extends ? view(own.extends) : undefined;
    const result: EntityView = {
      properties: { ...base?.properties, ...own.properties },
      relations: { ...base?.relations, ...own.relations },
      abstract: Boolean(own.abstract),
    };
    views.set(name, result);
    return result;
  };
  const entityNames = () => [...new Set([...Object.keys(manifest.entities), ...Object.keys(external)])];

  const lookup = (qualified: string): OperationDefinition | undefined => {
    const [namespace, name] = splitName(qualified);
    if (opts.namespace !== undefined && namespace === opts.namespace) return operations[name];
    return opts.operations?.(qualified);
  };

  for (const [opName, op] of Object.entries(operations)) {
    const base = `operations.${opName}`;
    const issue = (path: string, message: string) => issues.push({ path, message });

    const params = Object.keys(op.params ?? {});
    /** A word the expression language reads as itself can name nothing an expression reads. */
    const keyword = (word: string, path: string, what: string) => {
      if (EXPRESSION_KEYWORDS.has(word))
        issue(
          path,
          `"${word}" is ${word === 'in' ? 'an operator' : 'a literal'} in an expression, so no expression could read ${what} by that name — name it something else`,
        );
    };

    for (const param of params) {
      if (INVOCATION_NAMES.includes(param))
        issue(`${base}.params.${param}`, `"${param}" is bound for every operation, so a param cannot take the name`);
      keyword(param, `${base}.params.${param}`, 'a param');
    }

    /** Check every expression in a value against the names bound where it sits. */
    const checkValue = (value: unknown, scope: ReadonlySet<string>, path: string) => {
      for (const found of expressionsIn(value, path)) {
        let expr;
        try {
          expr = parseExpression(found.source);
        } catch (error) {
          issue(found.path, `does not parse: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        for (const root of referencedRoots(expr)) {
          if (!scope.has(root))
            issue(
              found.path,
              `"${root}" is not bound here — an operation reads its params, invoker, invokedAt and what earlier steps named`,
            );
        }
        const checked = checkExpression(expr, {
          storeNames: new Set(),
          storeMembers: new Map(),
          locals: null,
          contextNames: scope,
          strict: false,
          functions: 'core',
        });
        for (const problem of checked) if (problem.severity === 'error') issue(found.path, problem.message);
      }
    };

    const knownEntity = (name: string, path: string, write: boolean): EntityView | undefined => {
      const found = view(name);
      if (!found) {
        issue(path, `unknown entity "${name}"`);
        return undefined;
      }
      if (write && PROTECTED_ENTITIES.has(name))
        issue(path, `an operation may not write ${name} — who may write what is never changed by one`);
      return found;
    };

    const checkFieldNames = (entity: string, target: EntityView, fields: unknown, path: string) => {
      if (!isPlainObject(fields) || isExpressionToken(fields)) return;
      for (const field of Object.keys(fields)) {
        if (field === 'id')
          issue(`${path}.id`, 'a record’s id is not a field — an operation’s creates are named for it');
        else if (!(field in target.properties) && !(field in target.relations))
          issue(`${path}.${field}`, `${entity} has no field "${field}"`);
      }
    };

    const checkRelation = (entity: string, target: EntityView, relation: string, path: string) => {
      const rel = target.relations[relation];
      if (!rel) issue(path, `${entity} has no relation "${relation}"`);
      else if (rel.cardinality !== 'many')
        issue(path, `"${relation}" holds one record; a to-one relation is written as a field, not linked`);
    };

    const checkWhere = (entity: string, target: EntityView, where: unknown, path: string) => {
      if (!isPlainObject(where)) return;
      for (const [key, clause] of Object.entries(where)) {
        if (WHERE_COMBINATORS.has(key)) {
          const nested = Array.isArray(clause) ? clause : [clause];
          nested.forEach((entry, index) =>
            checkWhere(entity, target, entry, Array.isArray(clause) ? `${path}.${key}.${index}` : `${path}.${key}`),
          );
          continue;
        }
        if (RECORD_METADATA.has(key) || key in target.properties) continue;
        const rel = target.relations[key];
        if (!rel) {
          issue(`${path}.${key}`, `${entity} has no field "${key}"`);
          continue;
        }
        // A quantifier asks about linked records; its clause is judged against the target where typed.
        if (isPlainObject(clause) && !isExpressionToken(clause) && rel.target) {
          const inner = view(rel.target);
          for (const quantifier of ['some', 'none'])
            if (inner && quantifier in clause)
              checkWhere(rel.target, inner, clause[quantifier], `${path}.${key}.${quantifier}`);
        }
      }
    };

    /*
      The entities a create or a link may write, each with the path an issue about it points at. A
      named entity is itself; one chosen by expression is what its `oneOf` lists, a category there
      standing for every entity in view that is in it. A module may bring more members later, which
      the runner admits when it runs; what can be checked here is the ones already known.
    */
    const chosenEntities = (
      body: Record<string, unknown>,
      scope: ReadonlySet<string>,
      bp: string,
    ): { entities: { entity: string; path: string }[]; categories: boolean } => {
      const oneOf = body.oneOf as unknown[] | undefined;
      if (!isExpressionToken(body.entity)) {
        if (oneOf) issue(`${bp}.oneOf`, '"oneOf" constrains an entity chosen by expression; this one is named');
        return { entities: [{ entity: body.entity as string, path: `${bp}.entity` }], categories: false };
      }
      checkValue(body.entity, scope, `${bp}.entity`);
      if (!oneOf?.length) {
        issue(`${bp}.oneOf`, 'an entity chosen by expression must list what it may be in "oneOf"');
        return { entities: [], categories: false };
      }
      const entities: { entity: string; path: string }[] = [];
      let categories = false;
      oneOf.forEach((entry, i) => {
        if (typeof entry === 'string') {
          entities.push({ entity: entry, path: `${bp}.oneOf.${i}` });
          return;
        }
        const category = isPlainObject(entry) ? entry.category : undefined;
        if (!(OPERATION_CATEGORIES as readonly unknown[]).includes(category)) {
          issue(
            `${bp}.oneOf.${i}`,
            `"${String(category)}" is not a category — an entry is an entity's name or one of ${OPERATION_CATEGORIES.map((c) => `{ "category": "${c}" }`).join(', ')}`,
          );
          return;
        }
        categories = true;
        for (const name of entityNames()) {
          const schema = declared(name);
          if (schema && inCategory(schema, category as OperationCategory))
            entities.push({ entity: name, path: `${bp}.oneOf.${i}` });
        }
      });
      return { entities, categories };
    };

    const walk = (steps: OperationStep[], outer: ReadonlySet<string>, path: string, depth: number) => {
      const scope = new Set(outer);
      steps.forEach((step, index) => {
        const at = `${path}.${index}`;
        const { verb, body } = stepParts(step);
        const bp = `${at}.${verb}`;
        if (step.when !== undefined) checkValue(step.when, scope, `${at}.when`);

        switch (verb) {
          case 'find': {
            const entity = body.entity as string;
            const target = knownEntity(entity, `${bp}.entity`, false);
            checkValue(body.where, scope, `${bp}.where`);
            checkValue(body.limit, scope, `${bp}.limit`);
            if (target) {
              checkWhere(entity, target, body.where, `${bp}.where`);
              for (const key of Object.keys((body.order as object | undefined) ?? {}))
                if (!RECORD_METADATA.has(key) && !(key in target.properties))
                  issue(`${bp}.order.${key}`, `${entity} has no field "${key}" to order by`);
            }
            const scopeRef = body.scope as { anchor: string; via: string; anchorId: unknown } | undefined;
            if (scopeRef) {
              checkValue(scopeRef.anchorId, scope, `${bp}.scope.anchorId`);
              const anchor = knownEntity(scopeRef.anchor, `${bp}.scope.anchor`, false);
              if (anchor && !anchor.relations[scopeRef.via])
                issue(`${bp}.scope.via`, `${scopeRef.anchor} has no relation "${scopeRef.via}"`);
            }
            break;
          }
          case 'create': {
            const fields = body.fields;
            checkValue(fields, scope, `${bp}.fields`);
            const { entities, categories } = chosenEntities(body, scope, bp);
            if (categories && isPlainObject(fields) && !isExpressionToken(fields))
              issue(
                `${bp}.fields`,
                'a create whose entity may be any of a category takes its fields as one expression — what is in the category is not all known here',
              );
            entities.forEach(({ entity, path: entityPath }) => {
              const target = knownEntity(entity, entityPath, true);
              if (!target) return;
              if (target.abstract) issue(`${bp}.entity`, `${entity} is abstract — nothing is ever one`);
              checkFieldNames(entity, target, fields, `${bp}.fields`);
              if (isPlainObject(fields) && !isExpressionToken(fields)) {
                for (const [prop, spec] of Object.entries(target.properties))
                  if (spec.required && spec.default === undefined && !(prop in fields))
                    issue(`${bp}.fields`, `${entity} requires "${prop}", which this create does not give`);
              }
            });
            const parent = body.parent as { id: unknown; relation: string; entity?: string } | undefined;
            if (parent) {
              checkValue(parent.id, scope, `${bp}.parent.id`);
              if (parent.entity) {
                const owner = knownEntity(parent.entity, `${bp}.parent.entity`, true);
                if (owner) checkRelation(parent.entity, owner, parent.relation, `${bp}.parent.relation`);
              } else if (!entityNames().some((name) => view(name)?.relations[parent.relation]))
                issue(`${bp}.parent.relation`, `no entity has a relation "${parent.relation}"`);
            }
            break;
          }
          case 'update': {
            const entity = body.entity as string;
            checkValue(body.id, scope, `${bp}.id`);
            checkValue(body.fields, scope, `${bp}.fields`);
            const target = knownEntity(entity, `${bp}.entity`, true);
            if (target) {
              checkFieldNames(entity, target, body.fields, `${bp}.fields`);
              for (const [i, field] of ((body.unset as string[] | undefined) ?? []).entries()) {
                const spec = target.properties[field];
                if (!spec) issue(`${bp}.unset.${i}`, `${entity} has no property "${field}"`);
                else if (spec.required) issue(`${bp}.unset.${i}`, `"${field}" is required, so it cannot be cleared`);
              }
            }
            break;
          }
          case 'delete':
            checkValue(body.id, scope, `${bp}.id`);
            knownEntity(body.entity as string, `${bp}.entity`, true);
            break;
          case 'link':
          case 'unlink':
          case 'setRelation': {
            for (const key of ['id', 'target', 'targets'])
              if (key in body) checkValue(body[key], scope, `${bp}.${key}`);
            chosenEntities(body, scope, bp).entities.forEach(({ entity, path: entityPath }) => {
              const target = knownEntity(entity, entityPath, true);
              if (target) checkRelation(entity, target, body.relation as string, `${bp}.relation`);
            });
            break;
          }
          case 'check': {
            checkValue(body.condition, scope, `${bp}.condition`);
            const error = body.error as string;
            if (!op.errors || !(error in op.errors))
              issue(`${bp}.error`, `"${error}" is not one of this operation's errors — declare it in "errors"`);
            break;
          }
          case 'call': {
            checkValue(body.args, scope, `${bp}.args`);
            const qualified = body.operation as string;
            const callee = lookup(qualified);
            if (!callee) {
              issue(`${bp}.operation`, `no operation "${qualified}" is known`);
              break;
            }
            const args = (body.args as Record<string, unknown> | undefined) ?? {};
            const calleeParams = callee.params ?? {};
            for (const key of Object.keys(args))
              if (!(key in calleeParams)) issue(`${bp}.args.${key}`, `${qualified} has no param "${key}"`);
            for (const [param, spec] of Object.entries(calleeParams))
              if (spec.required && !(param in args)) issue(`${bp}.args`, `${qualified} requires "${param}"`);
            break;
          }
          case 'forEach': {
            checkValue(body.in, scope, `${bp}.in`);
            if (depth + 1 > MAX_FOREACH_DEPTH)
              issue(bp, `forEach nests at most ${MAX_FOREACH_DEPTH} deep — pass a tree flattened instead`);
            const as = body.as as string;
            if (scope.has(as)) issue(`${bp}.as`, `"${as}" is already bound here`);
            keyword(as, `${bp}.as`, 'what a step binds');
            const inner = new Set([...scope, as]);
            if (body.key !== undefined) checkValue(body.key, inner, `${bp}.key`);
            else if (Array.isArray(body.in)) {
              body.in.forEach((item, i) => {
                if (!isPlainObject(item) || (item.id === undefined && item.key === undefined))
                  issue(`${bp}.in.${i}`, 'an item needs an "id" or a "key", or the forEach a "key" expression');
              });
            }
            walk(body.steps as OperationStep[], inner, `${bp}.steps`, depth + 1);
            break;
          }
        }

        const as = body.as as string | undefined;
        if (as !== undefined && verb !== 'forEach') {
          if (scope.has(as)) issue(`${bp}.as`, `"${as}" is already bound here`);
          keyword(as, `${bp}.as`, 'what a step binds');
          scope.add(as);
        }
      });
      return scope;
    };

    const top = walk(op.steps, new Set([...params, ...INVOCATION_NAMES]), `${base}.steps`, 0);
    if (op.returns !== undefined) checkValue(op.returns, top, `${base}.returns`);
  }

  // The call graph, through other namespaces too, must reach no operation twice on one path.
  const qualify = (name: string) => (opts.namespace !== undefined ? `${opts.namespace}.${name}` : undefined);
  for (const opName of Object.keys(operations)) {
    const start = qualify(opName);
    const cycle = findCycle(start ?? opName, operations[opName], lookup);
    if (cycle) issues.push({ path: `operations.${opName}`, message: `calls itself: ${cycle.join(' → ')}` });
  }

  return issues;
}

/** `ns.name` split at its first dot. */
export function splitName(qualified: string): [string, string] {
  const at = qualified.indexOf('.');
  return at < 0 ? ['', qualified] : [qualified.slice(0, at), qualified.slice(at + 1)];
}

/** Every operation a definition calls, at any depth of its steps. */
export function callsOf(op: OperationDefinition): string[] {
  const found: string[] = [];
  const visit = (steps: OperationStep[]) => {
    for (const step of steps) {
      const { verb, body } = stepParts(step);
      if (verb === 'call') found.push(body.operation as string);
      if (verb === 'forEach') visit(body.steps as OperationStep[]);
    }
  };
  visit(op.steps);
  return found;
}

function findCycle(
  start: string,
  op: OperationDefinition,
  lookup: (qualified: string) => OperationDefinition | undefined,
): string[] | null {
  const path: string[] = [start];
  const done = new Set<string>();
  const visit = (current: OperationDefinition): string[] | null => {
    for (const callee of callsOf(current)) {
      if (callee === start) return [...path, callee];
      if (path.includes(callee) || done.has(callee)) continue;
      const next = lookup(callee);
      if (!next) continue;
      path.push(callee);
      const found = visit(next);
      if (found) return found;
      path.pop();
      done.add(callee);
    }
    return null;
  };
  return visit(op);
}
