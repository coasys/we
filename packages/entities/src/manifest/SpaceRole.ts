import type { CoreEntityDef } from './defs';

/**
 * A record this space names by role — "the canvas", found by asking for `canvas`.
 *
 * Templates find things by role rather than by query because a space can switch template, and a
 * template must never assume what another one wrote. A role is the contract between whoever set the
 * space up (its starter) and whatever renders it: the starter writes "this record is the canvas",
 * and any template that wants a canvas reads that and handles its absence.
 *
 * ## Why one record per role rather than a map on `Space`
 *
 * The same reason as `TypeStyle`: a map in a field is a read-modify-write, so two roles written at
 * once overwrite each other, and the ids in it are strings rather than links nothing can follow. One
 * record per role is one write per fact, and `node` is a real link — queryable, scopeable, and
 * followable by anything walking the graph.
 *
 * A relation per role on `Space` was the other option, and it would make every new role a manifest
 * change, so a starter could not add one. Here a starter adds a role by writing data.
 *
 * ## Reading
 *
 * Through `spaceStore.roles`, a ready map of name to id. Two records with one name are not prevented
 * — roles are written at creation, by one person — and the newest wins. A role whose record has been
 * deleted reads as absent.
 */
export const SpaceRole: CoreEntityDef = {
  base: 'Ad4mModel',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://space_role' },
    properties: {
      /** The role's name — `canvas`. Lower camel case, as a starter's `roles` keys are. */
      name: { type: 'string', predicate: 'we://role_name', default: '' },
    },
    relations: {
      /** The record that plays this role. Untyped: a role can be played by any kind of record. */
      node: { target: '', cardinality: 'one', predicate: 'we://role_node', polymorphic: false },
    },
  },
};
