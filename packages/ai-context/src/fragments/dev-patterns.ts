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

**Read one** (first match)
\`\`\`ts
const space = await Space.findOne(perspective, { name: 'My Space' });
\`\`\`

**Read by id**
\`\`\`ts
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
