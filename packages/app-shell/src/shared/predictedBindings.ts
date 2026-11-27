/**
 * The renderer's data bindings with this agent's pending writes in every read they answer.
 *
 * The backend's bindings hand a `$query` the backend's own classes, whose reads know nothing of what
 * is pending. Wrapped here, at the one place the host builds the bindings, every template read — a
 * record's reactions, a board's columns, who is on a card — draws a declared operation's predicted
 * writes from the moment it is invoked, as a store's reads through `@we/entities` already do. See
 * `invokeOperation` for where the predictions come from: the composition's, handed in.
 */
import type { RendererDataBindings } from '@we/backend-shared';
import { type Predictions, withPredictions } from '@we/entities';

type Wrapped = Pick<RendererDataBindings, '$getEntity' | '$getEntityForDataset' | '$getEntitiesForDataset'>;

const wrappers = new WeakMap<Predictions, WeakMap<object, Map<string, unknown>>>();

/** `bindings` with the entity lookups wrapped; everything else as it was. */
export function withPredictedReads<B extends Partial<Wrapped> | undefined>(bindings: B, predictions: Predictions): B {
  if (!bindings) return bindings;
  const byClass = wrappers.get(predictions) ?? new WeakMap<object, Map<string, unknown>>();
  wrappers.set(predictions, byClass);
  const { $getEntity, $getEntityForDataset, $getEntitiesForDataset } = bindings;
  const wrap = <C>(cls: C, names: readonly string[]): C => {
    if (!cls || (typeof cls !== 'object' && typeof cls !== 'function')) return cls;
    // One wrapper per class and names, so a lookup answers with the same object each time.
    const byNames = byClass.get(cls) ?? new Map<string, unknown>();
    byClass.set(cls, byNames);
    const key = names.join('\u0000');
    if (!byNames.has(key)) byNames.set(key, withPredictions(predictions, cls as object, names));
    return byNames.get(key) as C;
  };
  return {
    ...bindings,
    ...($getEntity ? { $getEntity: (name: string) => wrap($getEntity(name), [name]) } : {}),
    ...($getEntityForDataset
      ? { $getEntityForDataset: (name: string, dataset?: unknown) => wrap($getEntityForDataset(name, dataset), [name]) }
      : {}),
    ...($getEntitiesForDataset
      ? {
          $getEntitiesForDataset: (names: string[], dataset?: unknown) =>
            wrap($getEntitiesForDataset(names, dataset), names),
        }
      : {}),
  };
}
