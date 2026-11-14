/**
 * `options` → `sh:in`, and the one declaration it must never become.
 *
 * A property's `options` is a closed value set: SHACL spells it `sh:in`, and AD4M's `@Property`
 * writes exactly that when handed `{ value, label? }` entries — the SDK's own option form. Both
 * compilers share this helper — the codegen in `scripts/generateClasses.mjs` (which imports it
 * through tsx, the way it imports `containment.ts`) and `manifestCompiler.ts` — so neither can
 * grow a rule the other lacks.
 *
 * A `vocabulary` property emits nothing. Its declared `options` are only the floor: the real value
 * set is per space — see `PropertySchema.vocabulary`, whose one case today is `TaskBlock.status`.
 * Once the executor enforces `sh:in` (AD4M task A1), a fixed `todo`/`doing`/`done` list would
 * reject the states a community named for itself, so the guard lives here rather than in each
 * compiler.
 */
export type Ad4mOption = { value: string; label?: string };

export function toAd4mOptions(spec: { options?: (string | number)[]; vocabulary?: string }): Ad4mOption[] | undefined {
  if (spec.vocabulary !== undefined || spec.options === undefined || spec.options.length === 0) {
    return undefined;
  }
  // The SDK's option type is `value: string`. A number value is stored `literal:number:N`, so the
  // string kept is the decoded scalar's own form — what A1 compares `String(term)` against.
  return spec.options.map((value) => ({ value: String(value) }));
}
