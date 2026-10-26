/**
 * GENERATED from src/manifest/RoleGrant.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Ad4mModel, Flag, Model, Property } from '@coasys/ad4m';

/**
 * One person holding one {@link Role} in this space.
 *
 * A record rather than a list on the role, for {@link Involvement}'s reason: a grant is attributed and
 * dated — "Ana made Ben a moderator on Tuesday" is most of what it is worth — and two admins granting
 * two people at once are two independent writes rather than a read-modify-write of one list. Who
 * granted it and when come from the base: its author and its creation time.
 *
 * ## A person, not a key
 *
 * `agent` names the person the role is granted to, and it is compared as a person: a grant covers
 * every device somebody speaks from, including ones they add later, and a device somebody has revoked
 * stops speaking for them. Where a backend cannot tell a person from the key that signs for them, the
 * two are the same — see `PersonPort` in `@we/backend-shared`.
 *
 * ## Taking a role away
 *
 * Deleting the grant. Nothing is kept on the record about having held it, because the role's history
 * is the grants' own: who made each one and when, and who removed it, is what the backend already
 * records about writes.
 *
 * ## Why the plain base rather than `WeNode`
 *
 * `Involvement`'s answer: a claim about a pair, one of many per role, with its attribution on the
 * base. A conversation about why somebody is a moderator belongs somewhere people can find it, not
 * on the grant.
 */
@Model({ name: 'RoleGrant' })
export class RoleGrant extends Ad4mModel {
  @Flag({ through: 'we://flag', value: 'we://role_grant' })
  flag: string = '';

  /** The {@link Role.slug} granted. An unknown slug is a grant of a role the space does not describe, shown by its slug. */
  @Property({ through: 'we://granted_role', required: true })
  role: string = '';

  /** The person it is granted to, as their identifier. Profiles resolve separately, as every DID in WE does. */
  @Property({ through: 'we://granted_to', required: true })
  agent: string = '';
}
