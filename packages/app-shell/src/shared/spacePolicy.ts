/**
 * A space's rules as the host applies them: the presets a space starts from, which version of its
 * rules is in force, and the check every record write passes.
 *
 * The rules' format and how one write is judged are `@we/backend-shared`'s (`policy.ts`). What is
 * here is what only the host knows: who is signed in, which roles they hold, which datasets are
 * spaces. Pure over what it is given, so every rule here is testable without a backend; the space
 * store supplies the reads.
 */
import {
  actionOf,
  type ActionRequest,
  type ActorFacts,
  evaluate,
  needsRecord,
  type Permission,
  type Policy,
  POLICY_EDIT,
  POLICY_FORMAT,
  PolicyRefusal,
  readPolicy,
} from '@we/backend-shared';
import type { EntityWrite, EntityWriteCheck } from '@we/entities';

import {
  ADMIN_ROLE,
  administers,
  type GrantRow,
  momentOf,
  type RoleRow,
  rolesOf,
  rolesView,
  type RoleView,
} from './spaceRoles';

const admin = { role: ADMIN_ROLE } as const;
const moderator = { role: 'moderator' } as const;
const muted = { role: 'muted' } as const;

/** Who may change the rules and the roles, in every preset: admins. */
const GOVERNANCE: Permission[] = [
  { action: POLICY_EDIT, by: [admin] },
  ...['Role', 'RoleGrant'].flatMap((entity) =>
    ['create', 'edit', 'delete'].map((verb) => ({ action: `${entity}.${verb}`, by: [admin] })),
  ),
];

/**
 * Everybody who has joined may do anything; only admins change the rules and hand out roles.
 *
 * What a space with no rules of its own reads as, so a space made before rules existed behaves
 * exactly as it did.
 */
export const OPEN_POLICY: Policy = {
  format: POLICY_FORMAT,
  permissions: [{ action: '*', by: ['member'] }, ...GOVERNANCE],
};

const adminOnly = (entity: string, verbs = ['create', 'edit', 'delete']): Permission[] =>
  verbs.map((verb) => ({ action: `${entity}.${verb}`, by: [admin] }));

/**
 * The rules a community chooses in People, or a starter names for a new space.
 *
 * - Members make things — posts, channels, calls, replies, notes, tasks, reactions — and their
 *   authors edit and delete their own. Moderators and admins delete anything.
 * - Anybody may place and move anything on the canvas, and move any task card between columns;
 *   deleting somebody else's card is for moderators and admins.
 * - The space itself and its vocabulary (reaction types, task states, kinds of involvement, topics)
 *   are its admins' to change, and so are its landmarks once made.
 * - Admins change the rules and hand out roles.
 * - Holding the `muted` role takes away making, editing and adding; deleting your own stays.
 */
export const COMMUNITY_POLICY: Policy = {
  format: POLICY_FORMAT,
  permissions: [
    { action: '*.create', by: ['member'], except: [muted] },
    { action: '*.edit', by: ['author', admin], except: [muted] },
    { action: '*.delete', by: ['author', moderator, admin] },
    { action: '*.*.add', by: ['member'], except: [muted] },
    { action: '*.*.remove', by: ['member'], except: [muted] },
    // The shared work: any card moved between columns, anything placed or moved on the canvas.
    { action: 'TaskBlock.edit', by: ['author', admin], except: [muted] },
    { action: 'TaskBlock.edit', by: ['member'], except: [muted], when: { change: { only: ['status'] } } },
    { action: 'Placement.edit', by: ['member'], except: [muted] },
    { action: 'EdgeRoute.edit', by: ['member'], except: [muted] },
    // The space and its vocabulary.
    ...adminOnly('Space', ['edit', 'delete']),
    ...adminOnly('SignalType'),
    ...adminOnly('TaskState'),
    ...adminOnly('InvolvementType'),
    ...adminOnly('Topic'),
    ...adminOnly('SpaceLandmark', ['edit', 'delete']),
    ...GOVERNANCE,
  ],
};

/** The presets a space can start from or switch to, by the name a starter uses. */
export const POLICY_PRESETS = {
  open: { name: 'Open', description: 'Everybody who has joined may do anything.', policy: OPEN_POLICY },
  community: {
    name: 'Community',
    description:
      'Members make things and look after their own; moderators delete anything; admins look after the space.',
    policy: COMMUNITY_POLICY,
  },
} as const;

export type PolicyPreset = keyof typeof POLICY_PRESETS;

/** The preset a policy is, when it is exactly one — or `null` for rules a community wrote itself. */
export function presetOf(policy: Policy): PolicyPreset | null {
  const key = JSON.stringify(policy.permissions);
  for (const [name, preset] of Object.entries(POLICY_PRESETS)) {
    if (JSON.stringify(preset.policy.permissions) === key && !policy.frozen) return name as PolicyPreset;
  }
  return null;
}

// ─── The version in force ──────────────────────────────────────────────────────

/** A `Policy` record as read. */
export interface PolicyVersion {
  id: string;
  document?: string;
  /** The person who wrote it. */
  author?: string | null;
  createdAt?: string | number;
}

/** What judging somebody needs to know about the space, besides its rules. */
export interface SpaceStanding {
  /** The roles as they stand now. */
  roles: readonly RoleView[];
  /** The person who made the space: its admin while nobody holds the role. */
  creator: string | null;
  /** The records the roles were read from, revoked grants included — for who held what when. */
  history?: { roles: readonly RoleRow[]; grants: readonly GrantRow[] };
}

/** The standing as it was at `at`: the grants held then. Without a history, as it stands now. */
export function standingAt(standing: SpaceStanding, at: number | null): SpaceStanding {
  if (!standing.history || at === null) return standing;
  return { ...standing, roles: rolesView(standing.history.roles, standing.history.grants, at) };
}

/** Who `person` is to the policy: a member, holding their roles — and `admin` while they administer it. */
export function actorFacts(standing: SpaceStanding, person: string | null): ActorFacts {
  const roles = rolesOf(standing.roles, person);
  if (administers(standing.roles, person, standing.creator) && !roles.includes(ADMIN_ROLE)) roles.push(ADMIN_ROLE);
  // Everybody who has joined is a member. A closed membership is a permission to join, which is not
  // part of the rules yet.
  return { person, member: Boolean(person), roles };
}

const timeOf = (version: PolicyVersion) => momentOf(version.createdAt) ?? 0;

/**
 * The rules in force: the newest version whose author the version before it allowed to change them.
 *
 * Walked oldest first from {@link OPEN_POLICY}, which is what a space with no versions reads as. Each
 * version is judged by the one in force when it arrives, never by itself, so a version granting its
 * own author the right to write it does not count. A version that does not parse is skipped.
 *
 * Each is judged by the roles held when it was written, not now: a version an admin wrote stays in
 * force after they step down, and granting somebody a role today does not bring back a version they
 * wrote before they held it. That is why a revoked grant is kept rather than deleted.
 */
export function policyInForce(versions: readonly PolicyVersion[], standing: SpaceStanding): Policy {
  let current = OPEN_POLICY;
  const ordered = [...versions].sort((a, b) => timeOf(a) - timeOf(b) || a.id.localeCompare(b.id));
  for (const version of ordered) {
    const next = readPolicy(version.document ?? '');
    if (!next) continue;
    const author = version.author ?? null;
    const then = standingAt(standing, momentOf(version.createdAt));
    if (evaluate(current, { action: POLICY_EDIT, author }, actorFacts(then, author))) continue;
    current = next;
  }
  return current;
}

// ─── The check ─────────────────────────────────────────────────────────────────

/** What the check needs to know about a dataset to judge a write in it. */
export interface GovernedSpace extends SpaceStanding {
  policy: Policy;
}

export interface PolicyCheckDeps {
  /** The person signed in, or `null`. */
  me(): Promise<string | null>;
  /** The person a signing key speaks for. */
  personOf(did: string): Promise<string>;
  /** The space a dataset is, with its rules — or `null` for a dataset that is not a space. */
  space(dataset: unknown): Promise<GovernedSpace | null>;
}

/**
 * The write check the host registers: a write a space's rules do not allow rejects with a
 * {@link PolicyRefusal}, and a write to anything that is not a space is not judged.
 *
 * The record is read only when the rule judging the write needs it — an author to compare, a field to
 * hold — so a member making a post costs no read.
 */
export function createPolicyCheck(deps: PolicyCheckDeps): EntityWriteCheck {
  return async (write: EntityWrite) => {
    const space = await deps.space(write.dataset);
    if (!space) return;
    const action = actionOf(write.entity, write.kind, write.relation);
    const person = await deps.me();
    const request: ActionRequest = { action };
    if (write.kind === 'create') {
      request.author = person;
      request.after = write.data ?? {};
    } else if (needsRecord(space.policy, action)) {
      const record = (await write.record?.()) ?? null;
      request.author = record?.author ? await deps.personOf(record.author) : null;
      request.before = record;
      if (write.kind === 'edit') request.after = record ? { ...record, ...write.data } : null;
    }
    if (write.kind === 'edit') request.changed = Object.keys(write.data ?? {});
    const refusal = evaluate(space.policy, request, actorFacts(space, person));
    if (refusal) throw new PolicyRefusal(refusal);
  };
}

// ─── For templates ─────────────────────────────────────────────────────────────

/** The policy of the space on screen, as `spaceStore.policy` hands it to a template. */
export interface SpacePolicyView {
  /** The space has been asked for its policy. */
  loaded: boolean;
  /** The preset it is exactly, or `null` for a policy the community wrote itself. */
  preset: PolicyPreset | null;
  format: number;
  permissions: Permission[];
  frozen: boolean;
  /** The viewer, as a person. */
  me: string | null;
  /** The roles the viewer holds here, `admin` included while they administer the space. */
  roles: readonly string[];
  /** Each permission as a sentence, in order. */
  sentences: string[];
}

/** The policy in force as a template reads it. */
export function policyView(
  policy: Policy,
  standing: SpaceStanding,
  me: string | null,
  loaded: boolean,
): SpacePolicyView {
  return {
    loaded,
    preset: presetOf(policy),
    format: policy.format,
    permissions: policy.permissions,
    frozen: Boolean(policy.frozen),
    me,
    roles: actorFacts(standing, me).roles,
    sentences: describePolicy(policy, standing.roles),
  };
}

/**
 * Whether the viewer may take `action` — what `can()` answers for a template, from the policy
 * `spaceStore.policy` holds. `record` is what a query returned; its `author` is compared with the
 * viewer directly, which is exact wherever a person is one key. The write is checked again when it
 * is made, so this decides only what to offer.
 */
export function canFrom(view: SpacePolicyView | null | undefined, action: string, record?: unknown): boolean {
  if (!view || !view.loaded) return false;
  const row = record && typeof record === 'object' ? (record as Record<string, unknown>) : null;
  const request: ActionRequest = { action };
  if (row) {
    request.before = row;
    request.author = typeof row.author === 'string' ? row.author : null;
  } else if (action.endsWith('.create')) {
    request.author = view.me;
  }
  const policy: Policy = { format: view.format, permissions: view.permissions, frozen: view.frozen };
  return evaluate(policy, request, { person: view.me, member: Boolean(view.me), roles: view.roles }) === null;
}

const NOUNS: Record<string, string> = {
  CollectionBlock: 'posts, channels, replies and notes',
  TaskBlock: 'tasks',
  Signal: 'reactions',
  Placement: 'what is placed on the canvas',
  EdgeRoute: 'lines on the canvas',
  Space: 'the space’s settings',
  SignalType: 'reaction types',
  TaskState: 'task states',
  InvolvementType: 'kinds of involvement',
  Topic: 'topics',
  SpaceLandmark: 'landmarks',
  Role: 'roles',
  RoleGrant: 'who holds which role',
};

const VERBS: Record<string, string> = { create: 'make', edit: 'edit', delete: 'delete' };

const nounOf = (entity: string) =>
  NOUNS[entity] ?? `${entity.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} records`;

/** One actor in words, naming a role by the community's name for it. */
function actorWords(actor: Permission['by'][number], roles: readonly RoleView[], plural = true): string {
  if (actor === 'anyone') return 'anyone';
  if (actor === 'member') return plural ? 'members' : 'a member';
  if (actor === 'author') return 'the author';
  const name = (roles.find((r) => r.slug === actor.role)?.name ?? actor.role).toLowerCase();
  // A role named for a state — Muted, Banned — reads as who is in it rather than as a plural.
  if (/ed$/.test(name)) return `anyone ${name}`;
  return plural ? `${name}s` : name;
}

const list = (words: string[]) =>
  words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** What one action is, in words: "make anything", "edit tasks", "add to the children of posts". */
function actionWords(action: string): string {
  if (action === '*') return 'do anything';
  if (action === POLICY_EDIT) return 'change these rules';
  // The space is its settings to edit, and the space itself to delete.
  if (action === 'Space.delete') return 'delete the space';
  const parts = action.split('.');
  if (parts.length === 3) {
    const what = parts[0] === '*' ? 'anything' : nounOf(parts[0]);
    return `${parts[2] === 'add' ? 'add to' : 'remove from'} ${parts[1] === '*' ? '' : `the ${parts[1]} of `}${what}`;
  }
  return `${VERBS[parts[1]] ?? parts[1]} ${parts[0] === '*' ? 'anything' : nounOf(parts[0])}`;
}

/**
 * Each permission as a sentence a person reads: "Members, except anyone muted, may make anything."
 * Wildcards come out as "anything" — which, in the editor, sits beside the lines that name a thing
 * exactly, and those alone govern it.
 */
export function describePolicy(policy: Policy, roles: readonly RoleView[] = []): string[] {
  const sentences = policy.permissions.map((permission) => {
    const who = list(permission.by.map((actor) => actorWords(actor, roles)));
    const except = permission.except?.length
      ? `, except ${list(permission.except.map((actor) => actorWords(actor, roles)))},`
      : '';
    const record = permission.when?.record
      ? ` when ${Object.entries(permission.when.record)
          .map(([field, value]) => `the ${field} is ${String(value)}`)
          .join(' and ')}`
      : '';
    const only = permission.when?.change?.only ? `, changing only the ${list(permission.when.change.only)}` : '';
    const not = permission.when?.change?.not ? `, without changing the ${list(permission.when.change.not)}` : '';
    const sentence = `${who}${except} may ${actionWords(permission.action)}${record}${only}${not}.`;
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  });
  if (policy.frozen) sentences.push('Nobody may change these rules.');
  return sentences;
}
