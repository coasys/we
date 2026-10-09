/** Content-addressed hash for AD4M's centralized file-storage language */
export const FILE_STORAGE_LANGUAGE = 'QmzSYwddqhm49PrRMzSrJf3AvmmreXMKtr1u56nbTjBFVmCzS8N';

/**
 * Core predicates that callers outside the models package have to name.
 *
 * Predicates are **storage keys** — renaming one strands every record already written under it —
 * so the handful that cross a package boundary are worth having in one place rather than as string
 * literals at each call site. These three are the ones an anchor can point through; everything
 * else stays private to its `@Property`/`@HasMany` decorator.
 */
export const PREDICATES = {
  /** `CollectionBlock.children` — composition. What a container is made of. */
  CHILDREN: 'we://child',
  /** `WeNode.comments` — discourse. What was said *about* a node, by anyone. */
  COMMENT: 'we://comment',
  /**
   * `WeNode.mentions` — the DIDs named inside a composition.
   *
   * Written by the serializer from the composed tree, so "posts mentioning me" is a graph query
   * rather than a substring scan of `textContent`.
   */
  MENTION: 'we://mention',
  /**
   * `Space.typeStyles` — the colour a community draws each kind of thing in. A key's fallback,
   * behind whatever a single canvas decides for itself through its own children.
   */
  TYPE_STYLE: 'we://type_style',
  SPACE_ROLE: 'we://space_role',
} as const;
