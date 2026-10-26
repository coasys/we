/**
 * A space's policy: who may do what to its records.
 *
 * A policy is a list of **permissions**, and nothing is allowed that no permission allows. There are
 * no deny rules. Allow and deny together need an order between them (does a deny win? does the more
 * specific one?), and that order is where a rulebook stops being readable. What people need to take
 * away — a mute, a ban — is an `except` on the permission that would otherwise allow it.
 *
 * ## Actions
 *
 * Every entity has its actions without anybody writing them down:
 *
 * - `<Entity>.create`, `<Entity>.edit` and `<Entity>.delete`;
 * - for each relation, `<Entity>.<relation>.add` and `<Entity>.<relation>.remove`.
 *
 * A permission names one, or a wildcard over one kind: `*.create`, `*.edit`, `*.delete`,
 * `*.*.add`, `*.*.remove`, or `*` for all of them. **A permission naming an action exactly is the
 * only kind that governs it**: once `TaskBlock.edit` is named, `*.edit` no longer says anything
 * about task cards. That is scope, not precedence — a wildcard is "everything this policy does not
 * mention by name" — and it is what lets a policy open ordinary content with one line and keep the
 * space's settings to its admins with another.
 *
 * ## The policy governs itself
 *
 * Changing the policy is the action `Policy.edit`, and handing out roles is `RoleGrant.create`:
 * ordinary permissions, with nothing special about how a policy is amended. They are the
 * **governance actions**, and no wildcard ever matches them — a line opening "everything" to
 * members must not quietly hand members the rules. A policy that names nobody who may edit it is
 * refused ({@link validatePolicy}) unless it says it is `frozen`.
 *
 * Pure, synchronous and backend-free: the host evaluates it on every write and for every `can()` a
 * template asks, so it has to be cheap, and a backend that evaluates rules itself evaluates these.
 */

/** The policy format this code reads. A policy written in a newer one is not guessed at. */
export const POLICY_FORMAT = 1;

/**
 * Who may act.
 *
 * - `anyone`: whoever is writing, member or not.
 * - `member`: a member of the space.
 * - `author`: the person who made the record acted on.
 * - `{ role }`: whoever holds that role, by its slug.
 */
export type Actor = 'anyone' | 'member' | 'author' | { role: string };

/** What has to be true of the record for a permission to apply. Equality only. */
export interface Condition {
  /**
   * Fields of the record and the values they must hold — before an edit or delete, and after a
   * create or an edit, so an edit cannot take a record out of what the permission covers.
   */
  record?: Record<string, string | number | boolean>;
  /** For an edit: the fields it may touch (`only`), or may not (`not`). */
  change?: { only?: string[]; not?: string[] };
}

export interface Permission {
  /** `Post.delete`, `CollectionBlock.children.add`, `*.create`. */
  action: string;
  by: Actor[];
  /** Actors the permission does not reach, even when `by` does. A mute is `except: [{ role: 'muted' }]`. */
  except?: Actor[];
  when?: Condition;
}

export interface Policy {
  /** {@link POLICY_FORMAT} when it was written. */
  format: number;
  permissions: Permission[];
  /**
   * Nobody may change this policy again. Refused unless said: a policy that can never be edited is
   * one a community chose, never one it fell into.
   */
  frozen?: boolean;
}

/** The governance actions — the ones no wildcard reaches. */
export const POLICY_EDIT = 'Policy.edit';
const GOVERNANCE_ENTITIES = new Set(['Policy', 'Role', 'RoleGrant']);

/** What kind of write an action is. */
export type WriteKind = 'create' | 'edit' | 'delete' | 'add' | 'remove';

/**
 * The action a write is.
 *
 * Every write to a `Policy` record is `Policy.edit`: a new version is how a policy changes, and
 * removing one changes which version is in force, so there is one thing to permit, not three.
 */
export function actionOf(entity: string, kind: WriteKind, relation?: string): string {
  if (entity === 'Policy') return POLICY_EDIT;
  if (kind === 'add' || kind === 'remove') return `${entity}.${relation ?? ''}.${kind}`;
  return `${entity}.${kind}`;
}

const WILDCARDS = new Set(['*', '*.create', '*.edit', '*.delete', '*.*.add', '*.*.remove']);
const ACTION = /^[A-Za-z][A-Za-z0-9_]*\.(?:create|edit|delete|[A-Za-z][A-Za-z0-9_]*\.(?:add|remove))$/;

/** Whether `action` is one this format can name. */
export function isAction(action: string): boolean {
  return WILDCARDS.has(action) || ACTION.test(action);
}

function wildcardCovers(pattern: string, action: string): boolean {
  if (GOVERNANCE_ENTITIES.has(action.slice(0, action.indexOf('.')))) return false;
  if (pattern === '*') return true;
  const parts = action.split('.');
  if (pattern === '*.*.add' || pattern === '*.*.remove') return parts.length === 3 && pattern.endsWith(parts[2]);
  return parts.length === 2 && pattern === `*.${parts[1]}`;
}

/** The permissions that govern `action`: those naming it exactly, or, when none does, the wildcards covering it. */
export function permissionsFor(policy: Policy, action: string): { permission: Permission; index: number }[] {
  const all = policy.permissions.map((permission, index) => ({ permission, index }));
  const exact = all.filter(({ permission }) => permission.action === action);
  if (exact.length) return exact;
  return all.filter(({ permission }) => WILDCARDS.has(permission.action) && wildcardCovers(permission.action, action));
}

/** Who is acting, as the host knows them. */
export interface ActorFacts {
  /** The person writing; `null` when nobody is signed in. */
  person: string | null;
  member: boolean;
  /** The role slugs the person holds. */
  roles: readonly string[];
}

/** One write, as the policy judges it. */
export interface ActionRequest {
  action: string;
  /** The person who made the record. For a create, the person creating it. */
  author?: string | null;
  /** The record as it stands, for an edit or delete. */
  before?: Record<string, unknown> | null;
  /** The record as it will be, for a create or an edit. */
  after?: Record<string, unknown> | null;
  /** The fields an edit changes. */
  changed?: readonly string[];
}

/** Why an action is not allowed. */
export type Refusal =
  /** No permission allows it for this actor. */
  | { reason: 'not-permitted'; action: string }
  /** A permission would allow it, but its `when` does not hold. */
  | { reason: 'condition'; action: string; permission: number }
  /** The policy is frozen, and this is an edit to it. */
  | { reason: 'frozen'; action: string }
  /** The policy was written in a newer format than this code reads, so nothing here may write. */
  | { reason: 'newer-format'; action: string; format: number };

/** A refusal as an error, so a write that is not allowed rejects with one. */
export class PolicyRefusal extends Error {
  readonly refusal: Refusal;

  constructor(refusal: Refusal) {
    super(describeRefusal(refusal));
    this.name = 'PolicyRefusal';
    this.refusal = refusal;
  }
}

/** A refusal as a sentence a person reads. */
export function describeRefusal(refusal: Refusal): string {
  switch (refusal.reason) {
    case 'not-permitted':
      return `This space's rules do not let you do that (${refusal.action}).`;
    case 'condition':
      return `This space's rules allow ${refusal.action} only in some cases, and this is not one of them.`;
    case 'frozen':
      return "This space's rules are frozen: nobody can change them.";
    case 'newer-format':
      return "This space's rules were written by a newer version of the app. Update it to make changes here.";
  }
}

/** Whether `error` is a {@link PolicyRefusal}, including one that crossed a realm or a structured clone. */
export function isPolicyRefusal(error: unknown): error is PolicyRefusal {
  return error instanceof PolicyRefusal || (error as { name?: unknown } | null)?.name === 'PolicyRefusal';
}

function actorMatches(actor: Actor, who: ActorFacts, author: string | null | undefined): boolean {
  if (actor === 'anyone') return true;
  if (actor === 'member') return who.member;
  if (actor === 'author') return Boolean(who.person) && who.person === author;
  return typeof actor === 'object' && who.roles.includes(actor.role);
}

const same = (a: unknown, b: unknown) => a === b || (a != null && b != null && String(a) === String(b));

function conditionHolds(when: Condition | undefined, request: ActionRequest): boolean {
  if (!when) return true;
  if (when.record) {
    for (const record of [request.before, request.after]) {
      if (record === undefined) continue;
      if (!record) return false;
      for (const [field, value] of Object.entries(when.record)) if (!same(record[field], value)) return false;
    }
  }
  if (when.change && request.changed) {
    const { only, not } = when.change;
    if (only && request.changed.some((field) => !only.includes(field))) return false;
    if (not && request.changed.some((field) => not.includes(field))) return false;
  }
  return true;
}

/**
 * Whether judging `action` reads the record — its author, or its fields — so a caller that has not
 * loaded it knows to before calling {@link evaluate}.
 */
export function needsRecord(policy: Policy, action: string): boolean {
  return permissionsFor(policy, action).some(
    ({ permission }) =>
      Boolean(permission.when?.record) || [...permission.by, ...(permission.except ?? [])].includes('author'),
  );
}

/**
 * Whether `who` may take the action `request` describes: `null` when they may, otherwise why not.
 *
 * Any one permission allowing it is enough. A permission allows it when one of its `by` reaches the
 * actor, none of its `except` does, and its `when` holds. When some permission reaches the actor but
 * its `when` fails, the refusal says so — the person is allowed this sometimes, which is worth
 * telling them apart from never.
 */
export function evaluate(policy: Policy, request: ActionRequest, who: ActorFacts): Refusal | null {
  const { action } = request;
  if (policy.format > POLICY_FORMAT) return { reason: 'newer-format', action, format: policy.format };
  if (action === POLICY_EDIT && policy.frozen) return { reason: 'frozen', action };
  let conditional: number | null = null;
  for (const { permission, index } of permissionsFor(policy, action)) {
    if (!permission.by.some((actor) => actorMatches(actor, who, request.author))) continue;
    if ((permission.except ?? []).some((actor) => actorMatches(actor, who, request.author))) continue;
    if (conditionHolds(permission.when, request)) return null;
    conditional ??= index;
  }
  return conditional === null
    ? { reason: 'not-permitted', action }
    : { reason: 'condition', action, permission: conditional };
}

// ─── Checking a policy ─────────────────────────────────────────────────────────

/** What a policy can be checked against: the entities a space has, and each one's relations. */
export type PolicyCatalogue = Record<string, readonly string[]>;

function actorProblem(actor: unknown): string | null {
  if (actor === 'anyone' || actor === 'member' || actor === 'author') return null;
  if (actor && typeof actor === 'object' && typeof (actor as { role?: unknown }).role === 'string') {
    return (actor as { role: string }).role.trim() ? null : 'a role with no slug';
  }
  return `${JSON.stringify(actor)}, which is not an actor`;
}

/** Whether some actor could ever take `action` under `policy` — the test for a policy that locks itself. */
function reachable(policy: Policy, action: string): boolean {
  return permissionsFor(policy, action).some(({ permission }) => permission.by.length > 0);
}

/**
 * What is wrong with a policy, as sentences — empty when nothing is.
 *
 * Refused: a malformed permission, a format newer than this code, and a policy under which nobody
 * could ever edit it again unless it says it is `frozen`. With a `catalogue`, an action naming an
 * entity or relation the space does not have is refused too, since it can only be a typo.
 */
export function validatePolicy(policy: Policy, catalogue?: PolicyCatalogue): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(policy.format) || policy.format < 1) problems.push('The policy has no format number.');
  else if (policy.format > POLICY_FORMAT) {
    problems.push(`The policy is format ${policy.format}; this version reads up to ${POLICY_FORMAT}.`);
  }
  policy.permissions.forEach((permission, i) => {
    const at = `Permission ${i + 1} (${permission.action || 'no action'})`;
    if (!isAction(permission.action)) {
      problems.push(`${at} does not name an action: "Entity.create", "Entity.relation.add", or a wildcard.`);
    } else if (catalogue && !WILDCARDS.has(permission.action) && permission.action !== POLICY_EDIT) {
      const [entity, relation] = permission.action.split('.');
      if (!(entity in catalogue)) problems.push(`${at} names ${entity}, which this space has no entity called.`);
      else if (permission.action.split('.').length === 3 && !catalogue[entity].includes(relation)) {
        problems.push(`${at} names ${entity}.${relation}, which is not one of its relations.`);
      }
    }
    if (!permission.by.length) problems.push(`${at} allows nobody.`);
    for (const actor of [...permission.by, ...(permission.except ?? [])]) {
      const problem = actorProblem(actor);
      if (problem) problems.push(`${at} names ${problem}.`);
    }
    const change = permission.when?.change;
    if (change && !permission.action.endsWith('.edit') && permission.action !== '*') {
      problems.push(`${at} limits which fields a change touches, which only an edit has.`);
    }
  });
  if (policy.frozen && policy.permissions.some((p) => p.action === POLICY_EDIT)) {
    problems.push(`The policy is frozen and also says who may edit it; say one or the other.`);
  }
  if (!policy.frozen && !reachable(policy, POLICY_EDIT)) {
    problems.push(
      'Nobody could ever change this policy again. Say who may (Policy.edit), or mark it frozen if that is what is meant.',
    );
  }
  return problems;
}

/**
 * What is allowed but probably not meant, as sentences.
 *
 * One today: the policy keeps its own editing to a role that a wider set of people may hand out. "Only
 * moderators change the rules" says nothing if any member can make themselves a moderator.
 */
export function policyWarnings(policy: Policy): string[] {
  const warnings: string[] = [];
  const editors = permissionsFor(policy, POLICY_EDIT).flatMap(({ permission }) => permission.by);
  const granters = permissionsFor(policy, 'RoleGrant.create').flatMap(({ permission }) => permission.by);
  const roleOnly = editors.length > 0 && editors.every((actor) => typeof actor === 'object');
  if (roleOnly && granters.some((actor) => typeof actor === 'string')) {
    warnings.push(
      'Only some roles may change the rules, but more people than that may hand out roles — so anybody who can grant a role can make themselves a rule-maker.',
    );
  }
  return warnings;
}

/**
 * A stored policy, read leniently: what parses is kept, what does not is dropped, and anything that is
 * not a policy at all reads as `null`. A policy that half-parsed must not quietly allow more than it
 * said, and dropping a permission only ever allows less.
 */
export function readPolicy(document: unknown): Policy | null {
  let value = document;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const raw = value as { format?: unknown; permissions?: unknown; frozen?: unknown };
  if (typeof raw.format !== 'number' || !Array.isArray(raw.permissions)) return null;
  const permissions = raw.permissions.filter(
    (p): p is Permission =>
      Boolean(p) &&
      typeof (p as Permission).action === 'string' &&
      Array.isArray((p as Permission).by) &&
      (p as Permission).by.every((actor) => actorProblem(actor) === null) &&
      ((p as Permission).except ?? []).every((actor) => actorProblem(actor) === null),
  );
  return { format: raw.format, permissions, ...(raw.frozen === true ? { frozen: true } : {}) };
}
