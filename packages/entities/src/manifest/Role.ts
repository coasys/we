import type { CoreEntityDef } from './defs';

/**
 * A standing a person can hold across a whole space — admin, moderator, steward, muted.
 *
 * The word {@link InvolvementType} keeps clear of on purpose: an involvement is a part in *one*
 * record (reviewing this task, going to that event), a role is a part in the space itself. Who holds
 * one is a {@link RoleGrant}.
 *
 * ## Named by the community, found by the slug
 *
 * The same split `TaskState` and `InvolvementType` make. `name` is the community's word and can be
 * edited; `slug` is what a grant holds and what a rule names, so a renamed role keeps every grant and
 * every rule that refers to it. Renaming a slug would orphan both, so the slug is not editable.
 *
 * `admin` is the one role the host writes itself, when a space is made: somebody has to administer a
 * shared space, and its creator is that somebody until they say otherwise. Every other role is the
 * community's — a starter can ship the usual ones as ordinary records.
 *
 * The space's `muted` role, where a starter writes one, is not {@link MutedAgent}: a mute somebody
 * keeps for themselves stays theirs and private, and the role is the community's.
 *
 * ## Why the plain base rather than `WeNode`
 *
 * Vocabulary, like the other vocabulary entities: nobody comments on the existence of "moderator".
 */
export const Role: CoreEntityDef = {
  base: 'Ad4mModel',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://role' },
    properties: {
      /** What grants and rules name it by — `moderator`. Lower kebab case, derived from the name, fixed once made. */
      slug: { type: 'string', predicate: 'we://slug', default: '' },
      /** The community's word for it, as a person reads it. */
      name: { type: 'string', predicate: 'we://name', required: true, default: '' },
      /** What holding it means here — the line a member reads before granting it. */
      description: { type: 'string', predicate: 'we://description', control: 'textarea', default: '' },
    },
    relations: {},
  },
};
