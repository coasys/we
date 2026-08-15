/**
 * The interpretation surface, declared here until the runtime ships it.
 *
 * ## Why this file exists
 *
 * `TaskBlock` and `EventBlock` carry `interpretationHint` (what a class or field *is*, in the words
 * a person would use, so the extractor prompt can quote it verbatim) and `identity` (the property a
 * dedup key is built from). Both are read by the model query engine and reach it through the SDNA
 * the decorators emit — but the published `@coasys/ad4m` types do not declare them yet, so the
 * package builds against a local worktree and fails everywhere else on `TS2353: Object literal may
 * only specify known properties`.
 *
 * Augmenting the module rather than casting at each call site keeps the options *type-checked*
 * where they are written: a misspelt `interpretationHnt` is still an error, and the fields keep
 * their documentation at the point of use. Twenty-odd `as ModelConfig` casts would silence the
 * error and every other error alongside it.
 *
 * ## What this is not
 *
 * It is not a claim that the running runtime understands these options. Against a build that does
 * not, the decorators pass them through and the SDNA simply carries no hints — so extraction finds
 * nothing while everything else on this branch works normally. That is the honest state of things
 * until the interpretation stack is published, and it is why the failure mode is "no records
 * extracted" rather than a crash.
 *
 * ## Removing it
 *
 * When the published types carry both fields, delete this file. Declaration merging tolerates a
 * duplicate optional property only while the types agree exactly, so if it is left in place and
 * upstream declares either one differently, the build fails here rather than silently disagreeing —
 * which is the right way round.
 */
import '@coasys/ad4m';

declare module '@coasys/ad4m' {
  interface ModelConfig {
    /** What this class *is*, in a person's words, for the extractor prompt to quote. */
    interpretationHint?: string;
  }

  interface PropertyOptions {
    /** What this field *is*, in a person's words, for the extractor prompt to quote. */
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

  /** A pending overlay: values a pass proposed but has not committed. */
  interface InterpretationOverlayInfo {
    /** The base instance the overlay sits on. */
    base: string;
    /** Whether the model authored the whole instance or proposed changes to an existing one. */
    kind: 'create' | 'update';
    /** The run that last wrote it, if present. */
    run: string | null;
    /** `[predicate, stagedValue]` pairs — the model's proposed values. */
    inferred: [string, unknown][];
  }

  /**
   * Merged into the class declaration, which adds these to the instance type.
   *
   * **These are declared, not guaranteed.** A runtime without them is a live possibility — it is
   * the published build at time of writing — so `interpretationAdapter` checks for
   * `runInterpretation` before offering the port at all, and the whole surface goes quiet rather
   * than failing at the press of a button. Declaring without that check would trade a compile error
   * for a `not a function` stack trace, which is the worse of the two.
   */
  interface PerspectiveProxy {
    runInterpretation(
      transcript: { speaker: string; text: string }[],
      basePrefix: string,
      classes?: string[],
    ): Promise<string[]>;
    interpretationOverlays(): Promise<InterpretationOverlayInfo[]>;
    acceptInterpretation(base: string, property?: string): Promise<boolean>;
    rejectInterpretation(base: string, property?: string): Promise<boolean>;
  }
}
