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

---

### Building the AD4M Executor Binary (CRITICAL)

The ad4m repo has two artefacts with confusingly similar names:

| Artefact | Cargo flag | Crate location | What it builds |
|---|---|---|---|
| \`ad4m-executor\` **library** | \`-p ad4m-executor\` | \`rust-executor/\` | Library only — **does NOT update the binary** |
| \`ad4m-executor\` **binary** | \`--bin ad4m-executor\` | \`cli/\` (package \`ad4m\`) | The actual executable used by WE |

**Always use \`--bin\` to rebuild the running binary:**
\`\`\`sh
cargo build --release --bin ad4m-executor
\`\`\`

Using \`-p ad4m-executor\` will appear to succeed (Cargo reports "Finished") but the
binary at \`target/release/ad4m-executor\` will NOT be updated — any Rust changes
(log lines, bug fixes) will be silently absent from the running app.

After rebuilding, verify with:
\`\`\`sh
ls -la target/release/ad4m-executor   # timestamp must be fresh
strings target/release/ad4m-executor | grep "your log string"
\`\`\`

**After modifying \`@coasys/ad4m\` TypeScript (e.g. \`core/src/model/Ad4mModel.ts\`):**
\`\`\`sh
cd ad4m/core && pnpm run build        # rebuild the lib/ bundle
cd ../we && pnpm install && pnpm build  # pick up the new local override
\`\`\`
The WE monorepo uses \`"@coasys/ad4m": "file:../ad4m/core"\` as a pnpm override, so
it reads from \`ad4m/core/lib/\` — the source \`.ts\` files are never used directly.

---

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
// signals is declared on WeNode as \`signals: string[]\`. Include hydrates
// the URIs into Signal instances at runtime, but the static field type stays
// string[] (it reflects the unhydrated state). Cast to read the instances:
const nodes = await Space.findAll(perspective, { include: { signals: true } });
const sigs = nodes[0].signals as unknown as Signal[];
\`\`\`

**Count a relation (number, no instances fetched)**

Use a \`$\`-prefixed key with \`{ from, count: true }\`. The projection key flows
into the result row's type via \`IncludeExtras\`, so the value is typed directly:
\`\`\`ts
const spaces = await Space.findAll(perspective, {
  include: { $signalCount: { from: 'signals', count: true } },
});
const n: number = spaces[0].$signalCount ?? 0;
\`\`\`

**Filtered subset — named \`$\`-projection returning instances**

Use a \`$\`-prefixed key with \`{ from, where, limit }\`. The matched instances are
attached to each result under that key. With \`limit: 1\` the value is the scalar
or \`null\`; without a limit (or with limit > 1) it's an array:
\`\`\`ts
const spaces = await Space.findAll(perspective, {
  include: {
    $mySignal: {
      from: 'signals',
      where: { signalTypeId: 'some-id', author: myDid },
      limit: 1,
    },
  },
});
const mySignal = spaces[0].$mySignal; // Signal | null — typed via IncludeExtras
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

Note: \`count: true\` works as a plain literal — the typed projection (\`TypedIncludeProjection\`)
contextually narrows it to the \`true\` literal, so the \`as const\` workaround is no longer needed.

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
