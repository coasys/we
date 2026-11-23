/**
 * The `$modelsPending` answer: whether a query that cannot resolve a model
 * should wait rather than report it missing. Only the current dataset's models
 * are still landing — a query aimed at another dataset's handle reports
 * immediately, and a dataset whose models have all arrived reports too.
 *
 * Two reads settle the answer, not one: the space's own shapes
 * (`shapesLoaded`), and the foreign-entity sweep that compiles a mounted
 * language's models into classes (`entitiesLoaded`). The second is the
 * AcornOutcome race — the mount's SDNA lands before its entities are
 * registered, so "shapes done" never meant "models done". A dataset with no
 * mounted language still reports promptly: the sweep answers [] and the flag
 * settles with nothing to load.
 */
export function datasetModelsPending(
  dataset: unknown,
  currentDataset: { handle?: unknown } | null | undefined,
  shapesLoaded: boolean,
  entitiesLoaded: boolean,
): boolean {
  return !!dataset && dataset === currentDataset?.handle && (!shapesLoaded || !entitiesLoaded);
}
