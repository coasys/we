/**
 * The runner: one declared operation, run over the record contract inside one transaction.
 *
 * Every write goes through the connected backend's own write path, and so through its write check:
 * an operation can do nothing its invoker could not do one write at a time. What it adds is that the
 * writes land together or not at all, that each step can use what an earlier one found or made, and
 * that the records it makes have ids derived from the invocation (see `ids.ts`), so a replay is
 * refused rather than duplicated.
 *
 * ## What a step sees
 *
 * A `find` reads committed state, never the operation's own pending writes — the transaction's rule
 * on every backend. What the operation made is reached by the name its step bound. Writes to a record
 * made or found earlier in the same operation go through the instance that step handed back, so a
 * backend can stage them onto a record it has not committed yet.
 *
 * ## Through the contract only
 *
 * `findAll` for reads; `create` with a chosen `id` and `parent`; an instance's `save(batch)` and
 * `delete(batch)` for edits and deletes (the static `update` and `delete` carry no batch, so they
 * would land on their own, outside the operation); `addRelation`, `removeRelation` and `setRelation`
 * for relations. Nothing here knows which backend it is talking to.
 */
import {
  isPolicyRefusal,
  isRecordExists,
  type OneOfEntry,
  type OperationCategory,
  type OperationDefinition,
  type OperationParam,
  type OperationScope,
  type OperationStep,
} from '@we/backend-shared';
import {
  CORE_FUNCTIONS,
  evaluateExpression,
  type Expr,
  getFunction,
  parseCached,
  referencedRoots,
} from '@we/expressions';

import { datasetSharedId, getEntityForDataset, runEntityTransaction } from '../entityRegistry';
import { declaredError, isOperationError, OperationError, preconditionError, staticError } from './errors';
import { callSegment, deriveIdentityId, deriveRecordId, identityText, keySegment } from './ids';
import { categoryMembers, getOperation, isAbstract, operationsVersion } from './registry';
import { splitName } from './validate';
import {
  isExpressionToken,
  isPlainObject,
  MAX_FOREACH_DEPTH,
  oneOfLabel,
  PROTECTED_ENTITIES,
  stepParts,
} from './values';

export interface RunOperationOptions {
  /** The dataset every step reads and writes. */
  dataset: unknown;
  /** The agent the operation acts as — bound as `invoker`. */
  invoker: string;
  /** When it was invoked, as ISO text — bound as `invokedAt`. Now, unless a replay supplies the original. */
  invokedAt?: string;
  /** What the created records' ids derive from. A fresh UUID, unless a replay supplies the original. */
  invocationId?: string;
  /** The version of the declaring manifest the caller wrote against; refused when it is not the registered one. */
  version?: string;
  /**
   * The host's judgement of an entity a step chooses when it runs (an expression `entity` with a
   * `oneOf`): asked with the entity actually chosen, before the step writes it, and the operation
   * fails with static `notGranted` when it answers false. How a host lets one operation write a
   * post for a caller that may write content and refuse a task state to the same caller, where the
   * static summary can only say "a record of any type". Not asked for a literal entity, which the
   * summary already names. Absent, every chosen entity the `oneOf` admits is written.
   */
  admitChosen?: (entity: string) => boolean;
  /**
   * The dataset's shared id, which an identity-keyed create's id is derived within; `null` for a
   * dataset with none. Absent, the one the host registered says (`registerDatasetSharedId`), so a
   * caller passes it only where no host is (a vector, a test).
   */
  sharedId?: string | null;
  /**
   * What the steps read and write through, in place of the connected backend: the statics an entity
   * is reached by, and the write group the steps run in. A host's speculative run passes a view that
   * reads committed rows with its own pending writes laid over them and records each write instead of
   * making it (`speculateOperation`). Absent, the backend's own classes and transaction runner.
   */
  view?: OperationView;
}

/** A dataset as an operation sees it — see {@link RunOperationOptions.view}. */
export interface OperationView {
  /** The statics `name` is read and written through, or undefined when the dataset has no such entity. */
  entity(name: string, dataset: unknown): unknown;
  /** Run the steps as one write group, as `runEntityTransaction` does. */
  transaction<R>(dataset: unknown, fn: (tx: { batchId?: string }) => Promise<R>): Promise<R>;
}

/** A record as a step binds it: its fields as data, never the backend's instance. */
type Bound = Record<string, unknown>;

interface Instance {
  id: string;
  save(batch?: string): Promise<unknown>;
  delete(batch?: string): Promise<unknown>;
  [field: string]: unknown;
}

interface Statics {
  findAll(dataset: unknown, query?: Record<string, unknown>): Promise<Instance[]>;
  findOne(dataset: unknown, query?: Record<string, unknown>): Promise<Instance | null>;
  create(dataset: unknown, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<Instance>;
  addRelation(dataset: unknown, id: string, relation: string, target: string, batch?: string): Promise<void>;
  removeRelation(dataset: unknown, id: string, relation: string, target: string, batch?: string): Promise<void>;
  setRelation(
    dataset: unknown,
    id: string,
    relation: string,
    targets: readonly string[],
    batch?: string,
  ): Promise<void>;
}

/** A find to read again at the end, for `expect`. */
interface Expectation {
  entity: string;
  query: Record<string, unknown> | null;
  ids: string[];
  step: string;
}

/** What one run shares across its steps and the operations it calls. */
interface Run {
  dataset: unknown;
  view?: OperationView;
  batchId?: string;
  invocationId: string;
  invoker: string;
  invokedAt: string;
  admitChosen?: (entity: string) => boolean;
  /** The dataset's shared id, or null when it has none: what identity ids derive within. */
  sharedId: string | null;
  /** Instances a step made or found, by id, so a later write reaches a record the backend has only staged. */
  instances: Map<string, Instance>;
  /** Relation membership as this operation has left it, by `id`, then relation — for strict links. */
  membership: Map<string, Map<string, string[]>>;
  /** Records this operation created, and the step that did, for a `recordExists` at commit. */
  created: Map<string, string>;
  expectations: Expectation[];
  callDepth: number;
}

/** A where that can match nothing, because it compares with an absent value. */
const NEVER = Symbol('never');

const MAX_CALL_DEPTH = 16;

/**
 * Run a registered operation by qualified name (`core.createPost`), and answer with its `returns`.
 * Fails with an `OperationError` — static or precondition — and then nothing it wrote has landed.
 */
export async function runOperation(
  name: string,
  args: Record<string, unknown> | undefined,
  options: RunOperationOptions,
): Promise<unknown> {
  const op = getOperation(name);
  if (!op) throw staticError('unknownOperation', `No operation "${name}" is registered`);
  const [namespace] = splitName(name);
  const registeredVersion = operationsVersion(namespace);
  if (options.version !== undefined && registeredVersion !== undefined && options.version !== registeredVersion)
    throw staticError(
      'versionMismatch',
      `${name} was called for version ${options.version} of "${namespace}", and version ${registeredVersion} is registered`,
    );
  if (options.invocationId === '') throw staticError('malformed', 'An invocation id is a non-empty string');
  const run: Run = {
    dataset: options.dataset,
    invocationId: options.invocationId ?? crypto.randomUUID(),
    invoker: options.invoker,
    invokedAt: options.invokedAt ?? new Date().toISOString(),
    sharedId: options.sharedId !== undefined ? options.sharedId || null : datasetSharedId(options.dataset),
    ...(options.admitChosen ? { admitChosen: options.admitChosen } : {}),
    ...(options.view ? { view: options.view } : {}),
    instances: new Map(),
    membership: new Map(),
    created: new Map(),
    expectations: [],
    callDepth: 0,
  };

  try {
    const steps = async ({ batchId }: { batchId?: string }) => {
      run.batchId = batchId;
      const result = await invoke(run, name, op, args ?? {}, [], name);
      await checkExpectations(run);
      return result;
    };
    return await (options.view
      ? options.view.transaction(options.dataset, steps)
      : runEntityTransaction(options.dataset, steps));
  } catch (error) {
    throw asOperationError(error, run);
  }
}

/**
 * The queue an invocation joins — its operation's `serial` evaluated over these args — or undefined
 * when it joins none: the operation declares no key, the key comes out absent, or the args are ones
 * the run will refuse anyway. Prefixed with nothing, so two operations writing the same thing can
 * share a queue by giving the same key.
 */
export function serialKey(name: string, args: Record<string, unknown> | undefined): string | undefined {
  const op = getOperation(name);
  if (!op?.serial) return undefined;
  try {
    const scope = new Map<string, unknown>(Object.entries(checkArgs(name, op, args ?? {}, `${name}/serial`)));
    const key = evaluate(op.serial.$, scope, `${name}/serial`);
    if (typeof key === 'string') return key || undefined;
    if (typeof key === 'number' && Number.isFinite(key)) return String(key);
    return undefined;
  } catch {
    return undefined;
  }
}

/** A refusal or a clash the backend raised, in the operation's terms; anything else unchanged. */
function asOperationError(error: unknown, run: Run): unknown {
  if (isOperationError(error)) return error;
  if (isRecordExists(error)) return preconditionError('recordExists', error.message, run.created.get(error.id));
  if (isPolicyRefusal(error)) {
    return new OperationError({
      class: 'precondition',
      code: 'refused',
      message: error.message,
      refusal: error.refusal,
    });
  }
  return error;
}

/** One operation's steps, with its own names: its params, the invocation's, and nothing else. */
async function invoke(
  run: Run,
  name: string,
  op: OperationDefinition,
  args: Record<string, unknown>,
  segments: readonly string[],
  stepPath: string,
): Promise<unknown> {
  const scope = new Map<string, unknown>(Object.entries(checkArgs(name, op, args, stepPath)));
  scope.set('invoker', run.invoker);
  scope.set('invokedAt', run.invokedAt);
  await runSteps(run, op, op.steps, scope, segments, `${stepPath}/steps`, 0);
  return op.returns === undefined ? undefined : resolve(op.returns, scope, `${stepPath}/returns`);
}

/** The args as the operation's names: each declared param checked, an undeclared one refused. */
function checkArgs(
  name: string,
  op: OperationDefinition,
  args: Record<string, unknown>,
  step: string,
): Record<string, unknown> {
  if (!isPlainObject(args)) throw staticError('badArgs', `${name} takes one object of params`, step);
  const params = op.params ?? {};
  const bound: Record<string, unknown> = {};
  for (const key of Object.keys(args))
    if (!Object.prototype.hasOwnProperty.call(params, key))
      throw staticError('badArgs', `${name} has no param "${key}"`, step);
  for (const [param, spec] of Object.entries(params)) {
    const value = args[param];
    if (value === undefined || value === null) {
      if (spec.required) throw staticError('badArgs', `${name} requires "${param}"`, step);
      // An optional param that was not given is absent, and still a name the operation may read.
      bound[param] = undefined;
      continue;
    }
    if (!fitsType(value, spec)) throw staticError('badArgs', `${name}'s "${param}" must be a ${spec.type}`, step);
    bound[param] = value;
  }
  return bound;
}

function fitsType(value: unknown, spec: OperationParam): boolean {
  switch (spec.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'list':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    case 'json':
      return true;
  }
}

async function runSteps(
  run: Run,
  op: OperationDefinition,
  steps: OperationStep[],
  scope: Map<string, unknown>,
  segments: readonly string[],
  path: string,
  depth: number,
): Promise<void> {
  for (const [index, step] of steps.entries()) {
    const at = `${path}.${index}`;
    const { verb, body } = stepParts(step);
    const as = typeof body.as === 'string' && verb !== 'forEach' ? body.as : undefined;
    if (step.when !== undefined && !resolve(step.when, scope, `${at}.when`)) {
      // Skipped, but its name is still bound — to nothing — so a later step reads it as absent.
      if (as) scope.set(as, undefined);
      continue;
    }
    const result = await runStep(run, op, verb, body, scope, [...segments, String(index)], `${at}.${verb}`, depth);
    if (as) scope.set(as, result);
  }
}

async function runStep(
  run: Run,
  op: OperationDefinition,
  verb: ReturnType<typeof stepParts>['verb'],
  body: Record<string, unknown>,
  scope: Map<string, unknown>,
  segments: readonly string[],
  step: string,
  depth: number,
): Promise<unknown> {
  const value = (key: string) => resolve(body[key], scope, `${step}.${key}`);
  switch (verb) {
    case 'find':
      return find(run, body, scope, step);

    case 'create': {
      const entity = chosenEntity(run, body, scope, step);
      const Model = statics(run, entity, step);
      const fields = fieldsOf(value('fields'), step);
      const id = body.identity
        ? await identityId(run, entity, body.identity as string[], fields, step)
        : await deriveRecordId(run.invocationId, segments);
      const parentSpec = body.parent as { id: unknown; relation: string; entity?: string } | undefined;
      // A parent whose id is absent is no parent, as an absent field is not written: one create
      // serves a record that is sometimes under something and sometimes not.
      const parentId = parentSpec ? resolve(parentSpec.id, scope, `${step}.parent.id`) : undefined;
      const parent =
        parentSpec && parentId !== undefined && parentId !== null
          ? {
              id: idOf(parentId, `${step}.parent.id`),
              relation: parentSpec.relation,
              ...(parentSpec.entity ? { entity: parentSpec.entity } : {}),
            }
          : undefined;
      // A backend judges a held id against what is committed; one this operation made already is
      // the runner's to know, and an identity is the one way the same id comes up twice in a run.
      if (run.created.has(id))
        throw preconditionError('recordExists', `${entity} ${id} was made earlier in this operation`, step);
      run.created.set(id, step);
      const instance = await Model.create(run.dataset, fields, {
        id,
        ...(run.batchId ? { batchId: run.batchId } : {}),
        ...(parent ? { parent } : {}),
      });
      run.instances.set(id, instance);
      // What the create gave its relations is where a strict link on the new record starts from.
      const relations = new Map<string, string[]>();
      for (const [key, given] of Object.entries(fields)) {
        const ids = idsOf(given);
        if (ids) relations.set(key, ids);
      }
      run.membership.set(id, relations);
      return { ...fields, id };
    }

    case 'update': {
      const entity = chosenEntity(run, body, scope, step);
      const instance = (await instanceOf(run, entity, idOf(value('id'), `${step}.id`), step))!;
      const fields = body.fields === undefined ? {} : fieldsOf(value('fields'), step);
      // Clearing a field is writing '' on every backend: the contract never stores it.
      for (const field of (body.unset as string[] | undefined) ?? []) fields[field] = '';
      Object.assign(instance, fields);
      await instance.save(run.batchId);
      return undefined;
    }

    case 'delete': {
      const entity = chosenEntity(run, body, scope, step);
      const id = idOf(value('id'), `${step}.id`);
      // Deleting what is not there is the state asked for, as the contract's own delete has it.
      const instance = await instanceOf(run, entity, id, step, { optional: true });
      // A record made earlier in this operation is the invoker's; one read is theirs when it says so.
      if (instance && body.own && !run.created.has(id) && instance.author !== run.invoker)
        throw preconditionError('notOwn', `${entity} ${id} was made by somebody else`, step);
      if (instance) await instance.delete(run.batchId);
      run.instances.delete(id);
      return undefined;
    }

    case 'link':
    case 'unlink': {
      const entity = chosenEntity(run, body, scope, step);
      const Model = statics(run, entity, step);
      const id = idOf(value('id'), `${step}.id`);
      const relation = relationOf(body, scope, step);
      const target = idOf(value('target'), `${step}.target`);
      const members = await membershipOf(run, Model, id, relation, step);
      const present = members.includes(target);
      if (body.strict && verb === 'link' && present)
        throw preconditionError('alreadyLinked', `${target} is already in ${entity}.${relation} of ${id}`, step);
      if (body.strict && verb === 'unlink' && !present)
        throw preconditionError('notLinked', `${target} is not in ${entity}.${relation} of ${id}`, step);
      if (verb === 'link') {
        if (present) return undefined;
        await Model.addRelation(run.dataset, id, relation, target, run.batchId);
        setMembership(run, id, relation, [...members, target]);
      } else {
        if (!present) return undefined;
        await Model.removeRelation(run.dataset, id, relation, target, run.batchId);
        setMembership(
          run,
          id,
          relation,
          members.filter((member) => member !== target),
        );
      }
      return undefined;
    }

    case 'setRelation': {
      const entity = chosenEntity(run, body, scope, step);
      const Model = statics(run, entity, step);
      const id = idOf(value('id'), `${step}.id`);
      const relation = relationOf(body, scope, step);
      const given = idsOf(value('targets') ?? []);
      if (!given) throw staticError('notAList', `${step}.targets is not a list of records or ids`, step);
      // Kept: whatever the relation holds that the list leaves out follows it, in the order it was.
      const targets = body.keep
        ? [
            ...given,
            ...(await membershipOf(run, Model, id, relation, step)).filter((member) => !given.includes(member)),
          ]
        : given;
      await Model.setRelation(run.dataset, id, relation, targets, run.batchId);
      setMembership(run, id, relation, targets);
      return undefined;
    }

    case 'check': {
      if (value('condition')) return undefined;
      const code = body.error as string;
      const message = op.errors?.[code];
      if (message === undefined)
        throw staticError('malformed', `"${code}" is not one of this operation's errors`, step);
      throw declaredError(code, message, step);
    }

    case 'forEach': {
      if (depth + 1 > MAX_FOREACH_DEPTH)
        throw staticError('malformed', `forEach nests at most ${MAX_FOREACH_DEPTH} deep`, step);
      const items = value('in') ?? [];
      if (!Array.isArray(items)) throw staticError('notAList', `${step}.in is not a list`, step);
      const as = body.as as string;
      const seen = new Set<string>();
      for (const item of items) {
        const inner = new Map(scope);
        inner.set(as, item);
        const key = keyOf(item, body.key, inner, step);
        if (seen.has(key))
          throw staticError('forEachKey', `two items share the key "${key}", so their records would share ids`, step);
        seen.add(key);
        await runSteps(
          run,
          op,
          body.steps as OperationStep[],
          inner,
          [...segments, keySegment(key)],
          `${step}[${key}].steps`,
          depth + 1,
        );
      }
      return undefined;
    }

    case 'call': {
      const name = body.operation as string;
      const callee = getOperation(name);
      if (!callee) throw staticError('unknownOperation', `No operation "${name}" is registered`, step);
      if (run.callDepth >= MAX_CALL_DEPTH)
        throw staticError(
          'callDepth',
          `calls nest more than ${MAX_CALL_DEPTH} deep — the call graph must be acyclic`,
          step,
        );
      const args = value('args') ?? {};
      run.callDepth++;
      try {
        return await invoke(run, name, callee, args as Record<string, unknown>, [...segments, callSegment(name)], step);
      } finally {
        run.callDepth--;
      }
    }
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────────

async function find(run: Run, body: Record<string, unknown>, scope: Map<string, unknown>, step: string) {
  const entity = body.entity as string;
  const Model = statics(run, entity, step);
  const query = findQuery(body, scope, step);
  const rows = query === null ? [] : await Model.findAll(run.dataset, query);
  for (const row of rows) if (!run.instances.has(row.id)) run.instances.set(row.id, row);
  const records = rows.map(snapshot);
  if (body.expect) run.expectations.push({ entity, query, ids: records.map((r) => r.id as string), step });
  if (!body.one) return records;
  if (records.length === 0) throw preconditionError('notFound', `No ${entity} matched`, step);
  if (records.length > 1) throw preconditionError('ambiguous', `More than one ${entity} matched`, step);
  return records[0];
}

/** The contract query a find asks, or null when its where compares with an absent value. */
function findQuery(body: Record<string, unknown>, scope: Map<string, unknown>, step: string) {
  const query: Record<string, unknown> = {};
  if (body.where !== undefined) {
    const where = withoutAbsent(resolve(body.where, scope, `${step}.where`));
    if (where === NEVER) return null;
    query.where = where;
  }
  if (body.order !== undefined) query.order = body.order;
  if (body.limit !== undefined) {
    const limit = resolve(body.limit, scope, `${step}.limit`);
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0)
      throw staticError('malformed', `${step}.limit is not a whole number`, step);
    query.limit = limit;
  }
  // `one` reads two at most: enough to tell exactly one from more than one.
  if (body.one) query.limit = Math.min((query.limit as number | undefined) ?? 2, 2);
  const scoped = body.scope as OperationScope | undefined;
  if (scoped) {
    const anchor = resolve(scoped.anchorId, scope, `${step}.scope.anchorId`);
    if (anchor === undefined || anchor === null) return null;
    // A walk below the anchor is passed through as it is written; the backend walks it.
    query.parent = {
      id: idOf(anchor, `${step}.scope.anchorId`),
      relation: scoped.via,
      entity: scoped.anchor,
      ...(scoped.levels ? { levels: scoped.levels } : {}),
      ...(scoped.transitive ? { transitive: true } : {}),
    };
  }
  return query;
}

/**
 * A where with every absent comparison taken out the way the language means it: a comparison with an
 * absent value matches nothing, so its clause matches nothing, `NOT` of it matches nothing too (as
 * SQL's NULL has it), an `OR` drops the branch, and an `AND` fails whole. Sent to the backend as is,
 * an absent value would be dropped from the where and the query would widen instead.
 */
function withoutAbsent(where: unknown): Record<string, unknown> | typeof NEVER {
  if (!isPlainObject(where)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, clause] of Object.entries(where)) {
    if (key === 'OR' || key === 'AND') {
      const branches = (Array.isArray(clause) ? clause : [clause]).map(withoutAbsent);
      if (key === 'AND' && branches.includes(NEVER)) return NEVER;
      const kept = branches.filter((branch) => branch !== NEVER);
      if (key === 'OR' && kept.length === 0) return NEVER;
      out[key] = kept;
      continue;
    }
    if (key === 'NOT') {
      const inner = withoutAbsent(clause);
      if (inner === NEVER) return NEVER;
      out[key] = inner;
      continue;
    }
    const kept = withoutAbsentValue(clause);
    if (kept === NEVER) return NEVER;
    out[key] = kept;
  }
  return out;
}

function withoutAbsentValue(clause: unknown): unknown {
  if (clause === undefined || clause === null) return NEVER;
  if (Array.isArray(clause)) return clause.filter((entry) => entry !== undefined && entry !== null);
  if (!isPlainObject(clause)) return clause;
  const out: Record<string, unknown> = {};
  for (const [op, operand] of Object.entries(clause)) {
    if (op === 'some' || op === 'none') {
      const inner = withoutAbsent(operand);
      if (inner === NEVER) return NEVER;
      out[op] = inner;
      continue;
    }
    if (operand === undefined || operand === null) return NEVER;
    out[op] = Array.isArray(operand) ? operand.filter((entry) => entry !== undefined && entry !== null) : operand;
  }
  return out;
}

/** Read each `expect` find again, still inside the transaction, and refuse if its answer moved. */
async function checkExpectations(run: Run): Promise<void> {
  for (const expectation of run.expectations) {
    const Model = statics(run, expectation.entity, expectation.step);
    const rows = expectation.query === null ? [] : await Model.findAll(run.dataset, expectation.query);
    const now = rows.map((row) => row.id).sort();
    const then = [...expectation.ids].sort();
    if (now.length !== then.length || now.some((id, i) => id !== then[i]))
      throw preconditionError(
        'expectChanged',
        `What ${expectation.step} found changed while the operation ran`,
        expectation.step,
      );
  }
}

// ── Writes ────────────────────────────────────────────────────────────────────

function chosenEntity(run: Run, body: Record<string, unknown>, scope: Map<string, unknown>, step: string): string {
  if (typeof body.entity === 'string') return writable(body.entity, step);
  const chosen = resolve(body.entity, scope, `${step}.entity`);
  const oneOf = (body.oneOf as OneOfEntry[] | undefined) ?? [];
  const allowed =
    typeof chosen === 'string' &&
    oneOf.some((entry) => (typeof entry === 'string' ? entry === chosen : inCategoryNow(entry.category, chosen, run)));
  if (!allowed)
    throw staticError('outsideOneOf', `${String(chosen)} is not one of ${oneOf.map(oneOfLabel).join(', ')}`, step);
  writable(chosen, step);
  if (run.admitChosen && !run.admitChosen(chosen))
    throw staticError('notGranted', `The caller may not write ${chosen} through this operation`, step);
  return chosen;
}

/**
 * Whether an entity is in a category as things stand when the step runs, not when the operation was
 * registered: a module's block type registered since is a block. `any` is every record type this
 * dataset can write — a community's shape and a foreign app's model included, which no registered
 * manifest declares — save an abstract one, which nothing is ever made as.
 */
function inCategoryNow(category: OperationCategory, entity: string, run: Run): boolean {
  if (category === 'any') return !isAbstract(entity) && entityIn(run, entity) !== undefined;
  return categoryMembers(category).has(entity);
}

/**
 * The id of a record a create keys by identity: derived from the entity and the identity fields'
 * values, within the dataset's shared id when it has one, so it is the same whichever invocation
 * makes it, on whichever peer. A field with no value cannot be part of
 * an identity — two records without one would share an id for nothing they have in common.
 */
async function identityId(
  run: Run,
  entity: string,
  identity: readonly string[],
  fields: Record<string, unknown>,
  step: string,
): Promise<string> {
  const pairs = identity.map((field): [string, string] => {
    const text = identityText(fields[field]);
    if (text === undefined)
      throw staticError('malformed', `${step}.identity: "${field}" has no value to be the record's identity`, step);
    return [field, text];
  });
  return deriveIdentityId(entity, pairs, run.sharedId);
}

/** A step's relation: the name written, or what its expression gives. */
function relationOf(body: Record<string, unknown>, scope: Map<string, unknown>, step: string): string {
  const relation =
    typeof body.relation === 'string' ? body.relation : resolve(body.relation, scope, `${step}.relation`);
  if (typeof relation !== 'string' || !relation)
    throw staticError('malformed', `${step}.relation is not a relation's name`, step);
  return relation;
}

function writable(entity: string, step: string): string {
  if (PROTECTED_ENTITIES.has(entity))
    throw staticError('protectedEntity', `An operation may not write ${entity}`, step);
  return entity;
}

function statics(run: Run, entity: string, step: string): Statics {
  const Model = entityIn(run, entity) as Statics | undefined;
  if (!Model) throw staticError('unknownEntity', `No entity "${entity}" is registered for this dataset`, step);
  return Model;
}

/** The class an entity is reached by: the view's, else the backend's. */
function entityIn(run: Run, entity: string): unknown {
  return run.view ? run.view.entity(entity, run.dataset) : getEntityForDataset(entity, run.dataset);
}

/** The instance a write reaches a record through: the one a step held, else the committed record. */
async function instanceOf(
  run: Run,
  entity: string,
  id: string,
  step: string,
  opts: { optional?: boolean } = {},
): Promise<Instance | null> {
  const held = run.instances.get(id);
  if (held) return held;
  const found = await statics(run, entity, step).findOne(run.dataset, { where: { id } });
  if (found) run.instances.set(id, found);
  else if (!opts.optional) throw preconditionError('notFound', `No ${entity} ${id}`, step);
  return found;
}

/** A relation's members as this operation has left them, read from committed state the first time. */
async function membershipOf(run: Run, Model: Statics, id: string, relation: string, step: string) {
  const held = run.membership.get(id)?.get(relation);
  if (held) return held;
  // A record this operation created holds only what the operation gave it.
  if (run.created.has(id)) return [];
  const found = run.instances.get(id) ?? (await Model.findOne(run.dataset, { where: { id } }));
  if (!found) throw preconditionError('notFound', `No record ${id}`, step);
  return idsOf(found[relation] ?? []) ?? [];
}

function setMembership(run: Run, id: string, relation: string, members: string[]): void {
  if (!run.membership.has(id)) run.membership.set(id, new Map());
  run.membership.get(id)!.set(relation, members);
}

// ── Values ────────────────────────────────────────────────────────────────────

/** A value with every expression in it evaluated against the names in scope. */
function resolve(value: unknown, scope: Map<string, unknown>, path: string): unknown {
  if (isExpressionToken(value)) return evaluate(value.$, scope, path);
  if (Array.isArray(value)) return value.map((entry, i) => resolve(entry, scope, `${path}.${i}`));
  if (isPlainObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolve(entry, scope, `${path}.${key}`)]),
    );
  return value;
}

function evaluate(source: string, scope: Map<string, unknown>, path: string): unknown {
  let expr: Expr;
  try {
    expr = parseCached(source);
  } catch (error) {
    throw staticError('malformed', `${path} does not parse: ${(error as Error).message}`, path);
  }
  for (const root of referencedRoots(expr))
    if (!scope.has(root)) throw staticError('unboundName', `"${root}" is not bound at ${path}`, path);
  return evaluateExpression(expr, {
    root: (name) => (scope.has(name) ? { bound: true, value: scope.get(name) } : { bound: false, value: undefined }),
    // The core library only: an operation means the same on every host.
    call: (name, args) =>
      CORE_FUNCTIONS.has(name) ? getFunction(name)!.impl(args, { context: {}, stores: {} }) : undefined,
  });
}

function fieldsOf(value: unknown, step: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw staticError('malformed', `${step}.fields is not an object of fields`, step);
  // A field the value leaves absent is not written: absent is how a field starts.
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

/** An id, from an id or from a record a step bound. */
function idOf(value: unknown, path: string): string {
  if (typeof value === 'string' && value) return value;
  if (isPlainObject(value) && typeof value.id === 'string' && value.id) return value.id;
  throw staticError('malformed', `${path} is not a record or an id`, path);
}

/** Ids from a list of ids or records, or null when the value is not such a list. */
function idsOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') ids.push(entry);
    else if (isPlainObject(entry) && typeof entry.id === 'string') ids.push(entry.id);
    else return null;
  }
  return ids;
}

/** A forEach item's key as text: the `key` expression's value, else the item's `id`, else its `key`. */
function keyOf(item: unknown, keyExpr: unknown, scope: Map<string, unknown>, step: string): string {
  const key =
    keyExpr !== undefined
      ? resolve(keyExpr, scope, `${step}.key`)
      : isPlainObject(item)
        ? (item.id ?? item.key)
        : undefined;
  if (typeof key === 'string' && key) return key;
  if (typeof key === 'number' && Number.isFinite(key)) return String(key);
  throw staticError('forEachKey', 'an item has no key — give it an "id" or a "key", or the forEach a "key"', step);
}

/** A record's fields as data, so an expression reads values and never a backend's methods. */
function snapshot(instance: Instance): Bound {
  const out: Bound = {};
  for (const [key, value] of Object.entries(instance)) if (typeof value !== 'function') out[key] = value;
  return out;
}
