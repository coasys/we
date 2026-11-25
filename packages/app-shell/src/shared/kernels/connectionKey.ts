/**
 * A connection's dedup key — the format `Relationship.connection`'s hint asks an interpretation pass for.
 * Data in, data out — no stores, no reactivity, no imports — so a second host writes the same key against
 * the recorded vectors beside this file (`vectors/connectionKey.json`) or runs it as is. It has to: a pass
 * dedups a connection it extracts against the keys already stored, so a host spelling the key any other
 * way makes every connection it draws a duplicate of the one a pass finds.
 *
 * Written on every connection a person makes, not only on what a pass writes, because the backend shows a
 * model only the instances whose identity property is set: a connection drawn by hand without a key was
 * invisible to the pass meant to extend the structure it belonged to.
 *
 * Each end by its **title** — the value the prompt lists an existing record under — rather than its id.
 * Ids were tried first, and the first real pass showed both costs: the model had to resolve every key
 * against the task list to read the tree at all, and it wrote titles in its own keys anyway, so a key drawn
 * by hand and the same claim extracted could never dedup into each other. The label is left off when there
 * is none, rather than leaving a dangling colon.
 */
export function connectionKey(source: string, target: string, label?: unknown): string {
  const pair = `${source.trim()} → ${target.trim()}`;
  return typeof label === 'string' && label.trim() ? `${pair}: ${label.trim()}` : pair;
}
