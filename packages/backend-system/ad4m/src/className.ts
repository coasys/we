/**
 * The name the executor gives the class of a target class: its local name. Two apps can each have a
 * class of one name (`we://Topic`, `flux://Topic`), so this is a name for people and for the bare-name
 * fallback; every lookup WE makes is by the target class itself.
 *
 * The executor's `class_name_of` exactly (`extract_local_name` in ad4m's
 * `rust-executor/src/perspectives/shacl_parser.rs`): what follows the rightmost `#`, `:` or `/`, so
 * `urn:isbn:Book` is `Book` and `ns#a/b` is `b`; `unknown` when that is empty; the whole string when
 * it has none of the three.
 *
 * In a module of its own, with no imports, so a reader of shapes can name a class without loading
 * WE's models.
 */
export function classNameOf(targetClass: string): string {
  const at = Math.max(targetClass.lastIndexOf('#'), targetClass.lastIndexOf(':'), targetClass.lastIndexOf('/'));
  const local = at === -1 ? targetClass : targetClass.slice(at + 1);
  return local === '' ? 'unknown' : local;
}
