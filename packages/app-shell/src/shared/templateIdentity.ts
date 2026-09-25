/**
 * What a stored template may call itself.
 *
 * A built-in ships with the app and changes with it. A stored record claiming a built-in's id used
 * to *replace* it — which froze a template at whatever the copy was, said so nowhere (the row went
 * on reading "Built-in"), and left no control anywhere to undo it. Describing that state took two
 * predicates, an id-level one for grouping and a record-level one for editability, and they then
 * disagreed about space templates. That disagreement is the tell: nobody designed the state, it
 * accumulated.
 *
 * No producer ever meant it either. Not one write path chose a built-in id on purpose. Saving
 * collided on a name; "Fork as a new template" carried the id it was forking from, so on a built-in
 * it forked nothing and replaced it instead; and a marketplace template could simply declare
 * `"id": "workshop"`, since acceptance governs what a template may *name* and not what it may claim
 * to be. The one path that genuinely forks is the one that made collision impossible, by appending
 * exactly this suffix.
 *
 * So: the built-in or a fork, and nothing between.
 */

/**
 * An id a stored template may keep, or a fresh one derived from it.
 *
 * Derived rather than random, so a fork stays recognisably a fork of what it came from — in a URL,
 * in a log, and in the record itself. Idempotent in the way that matters: a derived id is itself
 * free, so forking a fork does not grow a tail of suffixes.
 */
export function reserveId(requested: string, reserved: readonly string[]): string {
  if (!reserved.includes(requested)) return requested;
  return `${requested}-${crypto.randomUUID().slice(0, 8)}`;
}
