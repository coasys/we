/**
 * GENERATED from src/manifest/SpaceLandmark.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Ad4mModel, Flag, HasOne, Model, Property } from '@coasys/ad4m';

/**
 * A record this space names as one of its landmarks — "the canvas", found by asking for `canvas`.
 *
 * Templates find things by landmark rather than by query because a space can switch template, and a
 * template must never assume what another one wrote. A landmark is the contract between whoever set
 * the space up (its starter) and whatever renders it: the starter writes "this record is the canvas",
 * and any template that wants a canvas reads that and handles its absence.
 *
 * A landmark says *which* record is the space's, not what kind of record it is. A query by kind cannot
 * stand in for it: once a member makes a second canvas, "the CollectionBlock that is a canvas" has two
 * answers, and only the space can say which one is its own.
 *
 * ## Why one record per landmark rather than a map on `Space`
 *
 * The same reason as `TypeStyle`: a map in a field is a read-modify-write, so two landmarks written at
 * once overwrite each other, and the ids in it are strings rather than links nothing can follow. One
 * record per landmark is one write per fact, and `node` is a real link — queryable, scopeable, and
 * followable by anything walking the graph.
 *
 * A relation per landmark on `Space` was the other option, and it would make every new landmark a
 * manifest change, so a starter could not add one. Here a starter adds a landmark by writing data.
 *
 * ## Reading
 *
 * Through `spaceStore.landmarks`, a ready map of name to id. Two records with one name are not
 * prevented — landmarks are written at creation, by one person — and the newest wins. A landmark
 * whose record has been deleted reads as absent.
 */
@Model({ name: 'SpaceLandmark' })
export class SpaceLandmark extends Ad4mModel {
  @Flag({ through: 'we://flag', value: 'we://space_landmark' })
  flag: string = '';

  /** The landmark's name — `canvas`. Lower camel case, as a starter's `landmarks` keys are. */
  @Property({ through: 'we://landmark_name' })
  name: string = '';

  /** The record that is this landmark. Untyped: any kind of record can be one. */
  @HasOne({ through: 'we://landmark_node' })
  node?: string;
}
