/**
 * `$modelsPending` — the guard behind "Model AcornOutcome is not available in
 * this perspective". A query that cannot resolve a model asks the host whether
 * the dataset's models are still landing; answering yes makes the renderer wait
 * instead of reporting the model missing.
 *
 * The race the guard exists for is a template's first query landing between the
 * space's own shapes arriving and the foreign-entity sweep finishing — an Acorn
 * space's `AcornOutcome` is exactly such a foreign model. `shapesLoaded` alone
 * never covered it: the mount's SDNA lands before the entities compiled from it
 * are registered, so "shapes done" still meant "models pending".
 */
import { describe, expect, it } from 'vitest';

import { datasetModelsPending } from '../src/frameworks/solid/providers/modelsPending';

const handle = { uuid: 'ds-1' };
const current = { handle } as { handle: unknown };
const otherHandle = { uuid: 'ds-2' };

describe('datasetModelsPending', () => {
  it('waits while the current dataset’s own shapes are still landing', () => {
    expect(datasetModelsPending(handle, current, false, true)).toBe(true);
    expect(datasetModelsPending(handle, current, false, false)).toBe(true);
  });

  it('waits while the current dataset’s foreign entities are still landing — shapes done or not', () => {
    // The AcornOutcome race: shapes reported loaded, the entity sweep not — the
    // model a query asks for is precisely what the sweep is still registering.
    expect(datasetModelsPending(handle, current, true, false)).toBe(true);
  });

  it('reports promptly once both reads settled — a template with no mounted language included', () => {
    // Nothing mounted means the foreign-schema sweep answered [] — both flags
    // settle, and an unknown model is reported rather than waited on forever.
    expect(datasetModelsPending(handle, current, true, true)).toBe(false);
  });

  it('does not wait on a dataset that is not the current one — only the space on screen is loading', () => {
    expect(datasetModelsPending(otherHandle, current, false, false)).toBe(false);
    expect(datasetModelsPending(undefined, current, false, false)).toBe(false);
  });
});
