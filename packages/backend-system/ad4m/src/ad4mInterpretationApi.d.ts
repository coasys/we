/**
 * The interpretation calls this adapter makes, declared until the runtime ships them.
 *
 * The published `@coasys/ad4m` has no `runInterpretation` / `interpretationOverlays` /
 * `acceptInterpretation` / `rejectInterpretation` on `PerspectiveProxy`, so without this the package
 * builds only against a local worktree that does.
 *
 * ## Why it lives here rather than somewhere shared
 *
 * A module augmentation applies to the module its specifier *resolves to*, and `@coasys/ad4m`
 * resolves differently from the repo root than from inside a package — so the same declarations in a
 * shared `types/` directory were loaded and had no effect, which is the worst of both. Each package
 * declares what it uses: the decorator options in `@we/models`, where models are written, and these
 * calls here, where they are made.
 *
 * ## Declared is not available
 *
 * This removes the type system's ability to answer "does this runtime have it", so
 * `runtimeSupportsInterpretation` in `interpretationAdapter.ts` asks at run time and every entry
 * point checks it. Declaring without that check would trade a compile error for a
 * `runInterpretation is not a function` stack trace at the moment somebody presses Extract, several
 * layers from anything that explains it.
 *
 * Delete this file and the guard when the interpretation stack is published.
 */
import '@coasys/ad4m';

declare module '@coasys/ad4m' {
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

  /** Merged into the class declaration, which adds these to the instance type. */
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
