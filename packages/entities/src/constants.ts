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
  CHILDREN: 'we://children',
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
} as const;

/**
 * The task states a space has before it decides on its own.
 *
 * **Unset means these, not none** — the same rule `Space.enabledModules` follows, and for the same
 * reason: a space that has never thought about its vocabulary must still work, and every space that
 * existed before this vocabulary did has tasks whose `status` holds one of these slugs. Reading an
 * empty list as "no states" would empty every board in every existing space, which is a migration
 * dressed up as a default.
 *
 * Creating a single `TaskState` is the act of opting in: from then on the space's own list is the
 * list, and these stop applying. A community that wants to keep "To do" alongside its own additions
 * re-creates it with the same slug, which costs nothing because a task holds the slug rather than a
 * record id.
 *
 * Shaped like the records they stand in for, so a consumer never branches on which it is holding.
 */
export const DEFAULT_TASK_STATES = [
  { slug: 'todo', name: 'To do', semantic: 'open', color: '' },
  { slug: 'doing', name: 'Doing', semantic: 'active', color: '' },
  { slug: 'done', name: 'Done', semantic: 'done', color: '' },
] as const;

/**
 * The kinds of part a person can have in something, before a space names its own.
 *
 * `DEFAULT_TASK_STATES`' rule, for the same reason: unset means these, not none. A space that has
 * never thought about its vocabulary still needs to be able to assign a task and answer an
 * invitation, and naming a kind with one of these slugs adopts that default rather than sitting
 * beside it.
 *
 * Two authorships, and `reflexive` says which — see `InvolvementType`. The first two are things one
 * member says about another and offered on tasks; the last three are an agent's own answer and
 * offered on events. `appliesTo` is what keeps "Going" out of a task's assign menu.
 *
 * Shaped like the records they stand in for, so a consumer never branches on which it is holding.
 */
export const DEFAULT_INVOLVEMENT_TYPES = [
  {
    slug: 'assignee',
    name: 'Assigned',
    semantic: 'responsible',
    reflexive: false,
    appliesTo: 'TaskBlock',
    icon: 'user-circle-check',
    color: '',
  },
  {
    slug: 'reviewer',
    name: 'Reviewing',
    semantic: 'reviewing',
    reflexive: false,
    appliesTo: 'TaskBlock',
    icon: 'eye',
    color: '',
  },
  {
    slug: 'going',
    name: 'Going',
    semantic: 'committed',
    reflexive: true,
    appliesTo: 'EventBlock',
    icon: 'check-circle',
    color: '',
  },
  {
    slug: 'maybe',
    name: 'Maybe',
    semantic: 'interested',
    reflexive: true,
    appliesTo: 'EventBlock',
    icon: 'question',
    color: '',
  },
  {
    slug: 'not-going',
    name: 'Not going',
    semantic: 'declined',
    reflexive: true,
    appliesTo: 'EventBlock',
    icon: 'x-circle',
    color: '',
  },
] as const;
