/**
 * The tag that tells a reactive accessor (a signal, a memo) from any other function.
 *
 * It lives with the evaluator because the evaluator's inert rule is stated in terms of it: a tagged
 * function is a value still to be read, and every other function reads as nothing. The renderers and
 * the prop resolvers tag and test with the same symbol, so there is exactly one of it.
 */
export const REACTIVE_ACCESSOR = Symbol('schema-reactive-accessor');

/** Tag a function as a reactive accessor. Anything that is not a function is returned untouched. */
export function markReactive<T>(value: T): T {
  if (typeof value === 'function') {
    Reflect.set(value, REACTIVE_ACCESSOR, true);
  }
  return value;
}
