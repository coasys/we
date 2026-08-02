import { Ad4mModel, Model, Property } from '@coasys/ad4m';

/**
 * A note, scoped to whichever space it was written in.
 *
 * ## The predicate namespace — a one-way door
 *
 * `we://module/<moduleId>/<property>`, and this is the first module to own entities, so **whatever
 * is chosen here becomes the convention**. It is worth stating the reasoning rather than letting it
 * be inferred:
 *
 * - **One root for the ecosystem.** Everything WE writes lives under `we://`, so anything asking
 *   "is this WE data?" — tooling, a migration, an agent filtering a perspective — greps one prefix.
 *   A separate `module://` scheme (which this convention briefly used) fragments that for no gain.
 * - **`module/<id>` is a delegated subtree.** `we://<word>` is core vocabulary, adjudicated by WE;
 *   `we://module/<id>/…` is adjudicated by module-id uniqueness, which the registry already
 *   enforces. The namespace *shape* documents who governs what.
 * - **Mint here, but reuse the core freely.** A module may use `we://name` when its entity really
 *   has a name — that is shared vocabulary working as intended, and generic UI that displays names
 *   gets this entity for free. What a module may not do is *mint* a new name outside its own
 *   subtree, because there is no adjudicator for that.
 * - **Ownership, not status.** These stay `we://module/notes/*` even if notes were later bundled by
 *   default or promoted to core — predicates are identifiers, not documentation. The asymmetry
 *   matters: promoting later is harmless, but something that shipped with core-namespace predicates
 *   and then needed to become optional would have squatted the core namespace permanently. When in
 *   doubt, module namespace.
 * - **Stable forever.** Predicates are how existing data is found. Changing the scheme — even
 *   "improving" it — orphans every note anyone has written, silently, because the links are still
 *   there and simply no longer match. Version the scheme if it ever must change; never edit it in
 *   place.
 *
 * ## Why this file imports AD4M
 *
 * There is no manifest→SDNA compiler yet: `buildModelClasses` goes SHACL → classes, and
 * `installSpaceSdna` takes decorated classes, so declaring a *new* entity means writing one. That is
 * why the module declares `backends: ['ad4m']` — the escape hatch working as designed, keeping
 * entity-owning modules unblocked while making the coupling visible at install rather than implicit.
 *
 * When the compiler lands, this becomes a neutral declaration and the predicates above become the
 * AD4M adapter's binding table — generated deterministically from exactly this scheme.
 */

/**
 * The predicates this module owns, named rather than inlined so the scheme is greppable and testable.
 * Generated deterministically as `we://module/<moduleId>/<property>` — the same rule an AD4M adapter
 * would apply once a manifest→SDNA compiler exists.
 */
export const NOTE_PREDICATES = {
  text: 'we://module/notes/text',
} as const;

@Model({ name: 'Note' })
export class Note extends Ad4mModel {
  @Property({ through: NOTE_PREDICATES.text })
  text: string = '';
}
