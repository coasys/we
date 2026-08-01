import { Ad4mModel, Model, Property } from '@coasys/ad4m';

/**
 * A note, scoped to whichever space it was written in.
 *
 * ## The predicate namespace — a one-way door
 *
 * `module://<moduleId>/<property>`, and this is the first module to own entities, so **whatever is
 * chosen here becomes the convention**. It is worth stating why rather than letting it be inferred:
 *
 * - **Not `we://`.** That namespace belongs to WE's own models. A module claiming `we://text` would
 *   collide with `TextBlock.text` the moment both are installed in one perspective.
 * - **Module id in the path**, so two modules can each own a `text` property without a shared
 *   registry adjudicating between them.
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
 * Generated deterministically as `module://<moduleId>/<property>` — the same rule an AD4M adapter would
 * apply once a manifest→SDNA compiler exists.
 */
export const NOTE_PREDICATES = {
  text: 'module://notes/text',
} as const;

@Model({ name: 'Note' })
export class Note extends Ad4mModel {
  @Property({ through: NOTE_PREDICATES.text })
  text: string = '';
}
