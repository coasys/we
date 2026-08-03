import type { ModelManifest } from '@we/backend-shared';

/**
 * A note, scoped to whichever space it was written in — *declared*, not written against a backend.
 *
 * ## The predicate namespace — a one-way door
 *
 * `we://module/<moduleId>/<property>`, and this is the first module to own entities, so whatever
 * is chosen here becomes the convention. The reasoning, stated rather than inferred:
 *
 * - **One root for the ecosystem.** Everything WE writes lives under `we://`, so anything asking
 *   "is this WE data?" — tooling, a migration, an agent filtering a dataset — greps one prefix.
 * - **`module/<id>` is a delegated subtree.** `we://<word>` is core vocabulary, adjudicated by WE;
 *   `we://module/<id>/…` is adjudicated by module-id uniqueness, which the registry already
 *   enforces. The namespace *shape* documents who governs what.
 * - **Mint here, but reuse the core freely.** A module may use `we://name` when its entity really
 *   has a name — shared vocabulary working as intended, and generic UI that displays names gets
 *   this entity for free. What it may not do is *mint* a name outside its own subtree.
 * - **Ownership, not status.** These stay `we://module/notes/*` even if notes were later bundled
 *   by default: predicates are identifiers, not documentation.
 * - **Stable forever.** Predicates are how existing data is found. Changing the scheme orphans
 *   every note anyone has written, silently, because the links are still there and no longer
 *   match. Version the scheme if it must change; never edit it in place.
 *
 * The compiler mints exactly this scheme from the manifest below — `text` becomes
 * `we://module/notes/text` — so the declaration and the convention cannot drift apart. Nothing
 * here names a backend: the host compiles this through whichever schema port is connected, which
 * is why this module declares no `backends`.
 */
export const NOTE_MANIFEST: ModelManifest = {
  version: '1',
  entities: {
    Note: {
      properties: { text: { type: 'string', default: '' } },
      relations: {},
    },
  },
};

/** The predicates this module owns — named so the scheme stays greppable and testable. */
export const NOTE_PREDICATES = {
  text: 'we://module/notes/text',
} as const;
