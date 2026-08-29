/**
 * GENERATED from src/manifest/RelationshipType.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from './WeNode';

/**
 * A kind of connection this community makes — "contradicts", "came out of", "supersedes".
 *
 * The middle tier of the three a relation can live in, and the one that carries most of the weight.
 * `SignalType` is the same idea for reactions and the pattern is deliberately identical: a community
 * names its own vocabulary, as data, in its own space, and instances reference it by id.
 *
 * ## Why there are three tiers and not two
 *
 * A free-text label is where a vocabulary is *discovered*. It costs nothing, needs no permission,
 * and is right while nobody yet knows what kinds of connection this community makes — which is
 * exactly the state a new space is in. What it cannot do is be queried or drawn: "contradicts",
 * "Contradicts" and "contradicts?" are three different relations to a `where` clause, so a template
 * cannot filter on one, count them, or give a kind its own colour.
 *
 * A **declared relation** — `@HasOne` on the model class — is the other end. It gets the full query
 * surface: `include` hydration, ordering by a related property, count projections, target typing.
 * What it cannot do is carry anything about the connection itself. A declared relation has no
 * identity, so there is nothing to comment on, nothing to rate, no author and no date. And it is a
 * statement about the *type* — "every Task may have an assignee" — decided before any instance
 * existed, which is the wrong shape for a claim somebody makes about two specific records.
 *
 * This sits between them. A record, so adding one is not a schema change and any member of the
 * community can propose the vocabulary; identified, so `where: { relationshipTypeId }` pushes down
 * and an edge style can key on it. It is what lets a knowledge map show a community's own vocabulary
 * as colour and shape rather than as labels somebody has to read.
 *
 * ## When to promote out of it
 *
 * When you want to query *by* the relation rather than filter a list of them — sort by it, count it,
 * hydrate through it, or hang a projection off it. That trigger subsumes frequency: nobody wants to
 * query by something used twice, and a kind used four hundred times is one somebody will.
 *
 * Promotion is a real migration, which is the cost worth naming: the declared relation is a
 * different set of links, so existing `Relationship` records have to be converted and then removed.
 * A script, per space. Cheap enough to be worth doing when the query surface is what you need, and
 * expensive enough not to do speculatively.
 *
 * See `docs/architecture/relations.md` for the full decision rules.
 */
@Model({ name: 'RelationshipType' })
export class RelationshipType extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://relationship_type' })
  flag: string = '';

  /** What this kind of connection is called, as a verb phrase — "contradicts", "came out of". */
  @Property({ through: 'we://name', required: true })
  name: string = '';

  /**
   * Stable identifier, derived from the name.
   *
   * The same job it does on `SignalType`: a template refers to a kind it cares about by slug,
   * because the display name is the community's to change and an id is nobody's to read. A
   * fragment wanting "show contradictions in red" looks up the slug rather than matching prose.
   */
  @Property({ through: 'we://slug' })
  slug: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  /** Phosphor icon name, drawn on the edge and in the picker. */
  @Property({ through: 'we://icon' })
  icon: string = '';

  /**
   * Design token or CSS colour for edges of this kind.
   *
   * The point of the tier, really. A free-text label can only be read; a kind can be *seen*, and
   * a map whose vocabulary is visible at a glance is a different instrument from one where every
   * line has to be read to be understood.
   */
  @Property({ through: 'we://color' })
  color: string = '';

  /**
   * What the connection reads as from the other end — "contradicted by", "led to".
   *
   * Optional, and absent means the name is used from both ends. Worth having because half the
   * value of a directed relation is that the reverse reading is a different sentence, and a map
   * that showed "contradicts" pointing at you would be stating the opposite of the truth.
   */
  @Property({ through: 'we://inverse_name' })
  inverseName: string = '';

  /**
   * Whether direction means anything for this kind.
   *
   * "Contradicts" is directed; "related to" and "same as" are not, and drawing an arrowhead on
   * them asserts an asymmetry the author did not intend. The renderer reads this to choose
   * between `arrow: 'target'` and `arrow: 'none'`.
   */
  @Property({ through: 'we://directed' })
  directed: boolean = true;

  @Property({ through: 'we://schema_version' })
  schemaVersion: number = 1;
}
