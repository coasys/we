/**
 * Entity proxies — how WE's vocabulary stays one name with many implementations.
 *
 * A consumer writes `Space.findAll(dataset, …)` and `space.save()` exactly as it always has. What
 * it imports is not a class but a stand-in that forwards every access to whichever implementation
 * the connected backend registered for that name. AD4M registers decorated model classes;
 * another backend registers its own equivalents, generated from the same manifests.
 *
 * Why a proxy rather than resolving at each call site (`entities.for('Space').findAll(…)`): the
 * ergonomics of the model layer — typed instances, `include` projections, relation helpers — are
 * worth keeping, and they survive untouched here. Instances come back from the real
 * implementation, so their methods are the implementation's own.
 *
 * The trade is that resolution happens at call time, so a missing implementation is a runtime
 * error rather than a compile error. That error is therefore made as loud and specific as
 * possible: silence would reproduce exactly the failure mode this contract exists to prevent — a
 * seam that resolves to nothing and breaks somewhere unrelated.
 *
 * ## The one thing a stand-in cannot do
 *
 * A proxy forwards *operations*, but it cannot forward *identity*. Anything that keys off the
 * class object itself — AD4M's decorator metadata (`getPropertiesMetadata`), its memoised SHACL,
 * a `WeakMap` of any kind — will look up the stand-in, find nothing, and quietly behave as though
 * the class had no properties. Calls succeed; metadata vanishes.
 *
 * So the rule: **code that hands a model class to the backend's own APIs must import from
 * `@we/models/classes`, not from the package root.** In practice that is exactly the code which
 * already imports `@coasys/ad4m` directly — backend adapters and the block layer. Application
 * code, which only ever calls statics and instance methods, uses the root and stays neutral.
 */
import { getModel, type ModelClass } from './modelRegistry';

/**
 * A stand-in for the entity named `name`. Typed as the implementation's own class so statics,
 * instance types and relation helpers all carry through:
 *
 * ```ts
 * export type Space = SpaceClass;                        // instance type
 * export const Space = defineEntity('Space') as typeof SpaceClass;
 * ```
 */
export function defineEntity(name: string): ModelClass {
  const resolve = (): ModelClass => {
    try {
      return getModel(name);
    } catch {
      throw new Error(
        `Entity "${name}" has no implementation registered. A backend supplies these when it ` +
          `connects (see BackendConnector.initialize → ports). This usually means the entity was ` +
          `used before boot completed, or the connector never registered its models.`,
      );
    }
  };

  // `function(){}` as the target: `apply`/`construct` stay available, so `new Space(...)` and any
  // callable use forward too rather than throwing an unrelated proxy error.
  return new Proxy(function entityStandIn() {} as unknown as ModelClass, {
    get: (_target, prop, receiver) => Reflect.get(resolve() as object, prop, receiver),
    set: (_target, prop, value) => Reflect.set(resolve() as object, prop, value),
    has: (_target, prop) => Reflect.has(resolve() as object, prop),
    ownKeys: () => Reflect.ownKeys(resolve() as object),
    getOwnPropertyDescriptor: (_target, prop) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve() as object, prop);
      // Proxy invariants require reported own properties to be configurable when the target
      // (an empty function) has no matching own property.
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(resolve() as object),
    construct: (_target, args) => Reflect.construct(resolve() as unknown as new () => object, args),
    apply: (_target, thisArg, args) =>
      Reflect.apply(resolve() as unknown as (...a: unknown[]) => unknown, thisArg, args),
  });
}
