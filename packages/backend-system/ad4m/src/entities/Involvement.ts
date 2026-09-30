/**
 * GENERATED from src/manifest/Involvement.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Ad4mModel, Flag, HasOne, Model, Property } from '@coasys/ad4m';

/**
 * One person's part in one thing — assigned to a task, reviewing it, going to an event, maybe going.
 *
 * ## Why a record rather than a field or a list of people
 *
 * `docs/architecture/relations.md` decides it, and not narrowly. An assignment can be disputed,
 * dated and attributed — "James put Sarah on this on Tuesday" is most of what it is worth — and a
 * declared relation has nothing to hang any of that on. The kind is the community's rather than the
 * schema's: "shepherd" and "second pair of eyes" are words a space invents as it goes. And it is
 * written by a person, deliberately, occasionally, which is the volume a record is cheap at.
 *
 * The two DID bags on `WeNode` were the tempting alternative and are the wrong one. One predicate per
 * state on the base of every entity in WE, no author or date on any entry, and moving from one state
 * to another a two-bag write with nothing to say who made it.
 *
 * ## Beside `participants`, not instead of it
 *
 * The two answer different questions and must not be merged:
 *
 * - **`WeNode.participants` is membership a machine observed** — who was in the call. Written by
 *   code, per record, at the volume a transcriber writes at, which is what a declared relation is
 *   for.
 * - **An involvement is intent a person stated** — I said I would come; you said this is mine.
 *
 * A roster that means "was in the room" and a roster that means "said they would be" are different
 * facts about the same people, and a surface that read one as the other would tell somebody a
 * meeting they skipped was one they attended.
 *
 * ## Two authorships, one shape
 *
 * Assignment is something one agent says about another; an RSVP is something an agent says about
 * itself. The difference is real — it is the difference `WeNode` already draws between `mentions`
 * and `participants` — but it is a fact about the *kind*, not about the mechanism, so it lives on
 * {@link InvolvementType.reflexive} rather than splitting this entity in two. Two entities would have
 * meant two pickers, two filters and two vocabularies for "who is on this".
 *
 * ## Why the agent is a scalar and the node is a relation
 *
 * The node is a record, so it is a relation: the graph sees an edge, and `include` can follow it.
 *
 * The agent is a DID, which is not a record of anything — there is no agent entity in a perspective
 * to point at, which is why `participants` and `mentions` had to opt out of polymorphic reads. As a
 * string it is also the one thing here a backend can compare natively, so "everything I am on" is
 * `where: { agent: me.did }` rather than a scan.
 *
 * ## Why the plain base rather than `WeNode`
 *
 * The same answer `Signal` and `Placement` reached, and they are the two closest shapes: a claim
 * about a pair, one of many per node. What `WeNode` adds is comments, signals and a roster on every
 * instance. An involvement already has its author and its date from the base, which is the
 * attribution relations.md asks for; a comment thread on "Sarah is reviewing this" belongs on the
 * task.
 */
@Model({ name: 'Involvement' })
export class Involvement extends Ad4mModel {
  @Flag({ through: 'we://flag', value: 'we://involvement' })
  flag: string = '';

  /**
   * Who, as a DID.
   *
   * The profile — name, picture — is resolved separately, exactly as every other DID in WE is,
   * so a renamed member is renamed on every card without anything here changing.
   */
  @Property({ through: 'we://involved_agent', required: true })
  agent: string = '';

  /**
   * The slug of an {@link InvolvementType} — the space's own vocabulary where it has one,
   * otherwise `DEFAULT_INVOLVEMENT_TYPES`.
   *
   * The slug rather than the record id, for `TaskState`'s reason: the defaults are virtual, so a
   * kind nobody has written down has no id to hold, and a slug stays legible in raw links. The
   * cost is the same too — renaming a slug orphans what holds it, so `name` is what gets edited.
   *
   * An unrecognised slug is not an error. It reads as a kind with its own slug for a name and an
   * outstanding semantic, so somebody's part in the work is shown oddly rather than hidden.
   */
  @Property({ through: 'we://involvement_kind', required: true })
  kind: string = '';

  /** Why, when there is something worth saying — "only for the first hour", "the API half". */
  @Property({ through: 'we://description' })
  note: string = '';

  @HasOne({ through: 'we://involved_in', polymorphic: true })
  node?: string;
}
