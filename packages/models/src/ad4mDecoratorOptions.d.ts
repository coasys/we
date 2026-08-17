/**
 * The decorator options this package's models pass, declared until the runtime ships them.
 *
 * ## Why this exists
 *
 * `TaskBlock` and `EventBlock` carry `interpretationHint` (what a class or field *is*, in the words
 * a person would use, so the extraction prompt can quote it verbatim) and `identity` (the property a
 * dedup key is built from). Both are read by the model query engine and reach it through the SDNA
 * the decorators emit, but the published `@coasys/ad4m` types do not declare them — so without this
 * the package builds only against a local worktree and fails everywhere else on `TS2353: Object
 * literal may only specify known properties`.
 *
 * Augmenting the module rather than casting at each call site keeps the options *type-checked* where
 * they are written: a misspelt `interpretationHnt` is still an error, and the fields keep their
 * documentation at the point of use. Twenty-odd `as ModelConfig` casts would silence this error and
 * every other one beside it.
 *
 * ## Why it lives in this package rather than somewhere shared
 *
 * It was in a shared `types/` directory at the repo root for one commit, and silently did nothing.
 * A module augmentation applies to the module its specifier *resolves to* — and `@coasys/ad4m`
 * resolves differently from the repo root than from inside a package, so the augmentation landed on
 * a different module than the one the source files import. `tsc --listFiles` showed the file being
 * loaded, which is what made it look wired up.
 *
 * So each package declares what it uses: the decorator options here, where models are written, and
 * the interpretation calls in `@we/backend-ad4m`, where they are made. That is a split along what
 * each package touches rather than duplication.
 *
 * ## What this is not
 *
 * It is not a claim that the running runtime understands these options. Against a build that does
 * not, the decorators pass them through and the SDNA carries no hints — extraction finds nothing
 * while everything else works normally.
 *
 * Delete when the published types carry both fields. Declaration merging tolerates a duplicate
 * optional property only while the types agree exactly, so a leftover augmentation fails the build
 * rather than silently disagreeing — which is the right way round.
 */
import '@coasys/ad4m';

declare module '@coasys/ad4m' {
  interface ModelConfig {
    /** What this class *is*, in a person's words, for the extraction prompt to quote. */
    interpretationHint?: string;
  }

  interface PropertyOptions {
    /** What this field *is*, in a person's words, for the extraction prompt to quote. */
    interpretationHint?: string;
    /**
     * Build the dedup key from this property. At most one per class.
     *
     * `TaskBlock` keys on `title`; `EventBlock` cannot — a weekly standup is the same title every
     * week — so it keys on `occurrence`, a composite title-and-day value, because the mechanism
     * allows exactly one identity property.
     */
    identity?: boolean;
  }
}
