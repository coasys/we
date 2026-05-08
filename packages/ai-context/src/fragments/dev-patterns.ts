/**
 * Developer patterns fragment.
 *
 * This content is included in IDE instruction files (copilot-instructions.md,
 * CLAUDE.md, cursor rules) but intentionally EXCLUDED from the in-app AI context
 * (schemaContext.ts) because it is irrelevant when an AI is editing JSON templates.
 *
 * Add patterns here that help IDEs / terminal agents working directly in the
 * TypeScript codebase (stores, services, tests, scripts).
 */

export const devPatterns = `
## Developer Patterns (codebase work — not for JSON schema authoring)

These patterns apply to TypeScript code in stores, services, tests, and scripts
that work directly with AD4M model classes. They do NOT apply to JSON template schemas.

---

### Package Conventions

Each package may have a \`CONVENTIONS.md\` at its root with package-specific rules.
Always read \`CONVENTIONS.md\` before creating or modifying files in that package.

Key packages with conventions files:
- \`packages/models/CONVENTIONS.md\` — model authoring: entities vs blocks, predicates, @Flag, WeNode, Model.create() pattern

---

### Model CRUD Patterns

Use the static factory method for creation. **Never** use \`new Model() + manual property assignment + save()\`.

**Create**
\`\`\`ts
const space = await Space.create(perspective, {
  uuid: crypto.randomUUID(),
  name: 'My Space',
  description: 'A description',
  visibility: 'public',
});
\`\`\`

**Read all**
\`\`\`ts
const spaces = await Space.findAll(perspective);
\`\`\`

**Read one** (first match by property)
\`\`\`ts
const space = await Space.findOne(perspective, { where: { name: 'My Space' } });
\`\`\`

**Read by id** — there is no \`findById\`; use \`findOne\` with a \`where\` clause:
\`\`\`ts
// ✅ Correct
const space = await Space.findOne(perspective, { where: { id } });

// ❌ Wrong — findById does not exist
const space = await Space.findById(perspective, id);
\`\`\`

**Update**
\`\`\`ts
space.name = 'New Name';
await space.save();
\`\`\`

**Delete**
\`\`\`ts
await space.delete();
\`\`\`

**HasMany relations**
\`\`\`ts
await space.addLocations(locationBlock);     // add<RelationName>(instance)
const locs = await space.getLocations();     // get<RelationName>()
await space.removeLocations(locationBlock);  // remove<RelationName>(instance)
\`\`\`

Accessor names derive from the \`@HasMany\` property name: e.g. \`locations\` → \`addLocations\` / \`getLocations\` / \`removeLocations\`.

---

### Include / Projection Patterns

Relations declared with \`@HasMany\` or \`@HasOne\` can be eagerly loaded or counted
in the same query using the \`include\` option on \`findAll\` / \`findOne\`.

**Eager-load a relation (full instances)**
\`\`\`ts
// Attaches hydrated Signal[] as node.signals
const nodes = await Space.findAll(perspective, { include: { signals: true } });
const sigs: Signal[] = (nodes[0] as any).signals ?? [];
\`\`\`

**Count a relation (number, no instances fetched)**

Use a \`$\`-prefixed key with \`{ from, count: true as const }\`:
\`\`\`ts
const spaces = await Space.findAll(perspective, {
  include: { $signalCount: { from: 'signals', count: true as const } },
});
const n: number = (spaces[0] as any).$signalCount ?? 0;
\`\`\`

**Filtered subset — named \`$\`-projection returning instances**

Use a \`$\`-prefixed key with \`{ from, where, limit }\`. The matched instances are
attached to each result under that key:
\`\`\`ts
// TS code — literal values
const spaces = await Space.findAll(perspective, {
  include: {
    $mySignal: {
      from: 'signals',
      where: { signalTypeId: 'some-id', author: myDid },
      limit: 1,
    },
  },
});
const mySignal = (spaces[0] as any).$mySignal ?? null; // Signal | null
\`\`\`

In JSON schema nodes, store references are used for the \`where\` values:
\`\`\`ts
// Schema node — $store references resolved at render time
include: {
  $myLikeSignal: {
    from: 'signals',
    where: {
      signalTypeId: { $store: 'spaceStore.signalTypesBySlug.like.id' },
      author: { $store: 'adamStore.me.did' },
    },
    limit: 1,
  },
}
// Access the result: '$post.$myLikeSignal.value'
\`\`\`

Important: \`count: true\` must be typed as \`true as const\` (not just \`true\`) to
satisfy the \`IncludeProjection\` type — TypeScript infers \`boolean\` otherwise.

---

### Signal Predicate

Signals on any \`WeNode\` subclass (Space, AgentProfile, TextBlock, …) use the
predicate **\`we://signal\`** — the relation is declared as:
\`\`\`ts
@HasMany(() => Signal, { through: 'we://signal' })
signals: string[] = [];
\`\`\`

When creating a signal manually (not via the ORM relation helpers), pass the
correct predicate to the \`parent\` option:
\`\`\`ts
await Signal.create(perspective, { signalTypeId, value }, {
  parent: { id: nodeId, predicate: 'we://signal' },
});
\`\`\`

**\`we://has_signals\` is wrong** — it is a different predicate that the ORM does not
know about. Using it creates orphaned links invisible to \`include: { signals: true }\`.

---

**Anti-pattern — do not use:**
\`\`\`ts
// ❌ Wrong
const space = new Space(perspective);
space.uuid = crypto.randomUUID();
space.name = 'My Space';
await space.save();

// ✅ Correct
const space = await Space.create(perspective, { uuid: crypto.randomUUID(), name: 'My Space' });
\`\`\`
`;
