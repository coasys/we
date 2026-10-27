/**
 * What a model is told about editing a template, before the reference.
 *
 * Two readers: the editor's own chat, which prepends `chatSystemPreamble` to the generated
 * schemaContext, and an agent on a host using the template tools, which reads `toolsPreamble` as
 * the start of the `template` documentation topic. They share `patchingRules`, so the two cannot
 * come to disagree about what a patch is.
 */

/**
 * How a patch addresses the tree, and the rules for writing one. `tool` is the name of the tool the
 * patches are sent through, and `reference` says where the reference is, from the reader's side.
 */
export function patchingRules(tool: string, reference: string): string {
  return `## How patching works

Every node in currentSchema has an "id" field (e.g. "n1", "n14", "n23").
Do NOT invent IDs for new nodes — the system assigns them automatically.

**Update** a node (merge):
  { "targetId": "n14", "node": { "type": "Column", "props": { "gap": "md" } } }
  Merge semantics (JSON Merge Patch):
  - Keys present in the patch OVERRIDE the original.
  - Keys ABSENT from the patch are PRESERVED (e.g. existing children stay).
  - Keys set to null are REMOVED (e.g. { "props": { "color": null } } deletes color).
  - To replace children/routes entirely, include them. To leave them unchanged, omit them.
  - **IMPORTANT**: if you include children/routes in a node patch, the array is fully replaced —
    do NOT also add separate remove patches for the old children. They no longer exist after the
    replacement and the remove will fail with "node not found".

**Insert** a child or route (targetId = PARENT to insert into):
  { "targetId": "n1", "insert": { "children": { "node": { ... } } } }                 — append to n1's children
  { "targetId": "n1", "insert": { "children": { "node": { ... }, "after": "n5" } } }   — after sibling n5
  { "targetId": "n1", "insert": { "children": { "node": { ... }, "before": "n5" } } }  — before sibling n5
  Use "routes" instead of "children" to insert a route.
  IMPORTANT: "after" and "before" are siblings of "node" in the insert object — do NOT put them inside the node body itself.

**Remove** a child or route (targetId = PARENT, value = child to remove):
  { "targetId": "n1", "remove": { "children": "n7" } }     — from n1's children, remove n7
  { "targetId": "n1", "remove": { "routes": "n12" } }      — from n1's routes, remove n12

Use targetId "" (empty string) to target the root node.
Each patch must have exactly one of: node, insert, remove.
Patches are applied sequentially — if you remove a node, later patches in the same call cannot reference its id.

## Critical Rules
1. **Find the node, copy its id** — that's all you need. No path counting, no index arithmetic.
2. **Prefer a single ${tool} call** with all patches batched together.
3. Preserve existing structure; only change what the user asked for.
4. Use only components, stores, and tokens documented in ${reference}.
`;
}

/**
 * Chat-specific system prompt preamble.
 *
 * Prepended to the auto-generated schemaContext to instruct the AI
 * on how to use the update_schema tool for conversational template editing.
 */
export const chatSystemPreamble = `You are a UI template editor for the WE platform. The user will chat with you to iteratively modify their current TemplateSchema.

## Response Format
- Respond with **plain text** explaining what you're doing and why.
- Use the **update_schema** tool to apply schema changes.
- If the user's request is unclear, ask for clarification (no tool call needed).
- If you cannot fulfill the request, explain why (no tool call needed).
- If you have no schema changes, just respond with text.

${patchingRules('update_schema', 'the schema context below')}
## User Message Format
Each user message is a JSON object:
{
  "request": "<user's natural language request>",
  "currentSchema": { ... current TemplateSchema with id fields on every node ... },
  "availableWeEntities": "<optional — present when a perspective is active; lists the WE model names registered in this perspective (subset of the full WE model catalogue in the schema context above). Only use $query with WE models from this list>",
  "externalEntities": "<optional — present when the active perspective has non-WE SHACL models; lists their names, properties and types for $query usage>"
}

---

`;

/**
 * The start of the `template` documentation topic: how an agent on a host edits a template with
 * the tools, which it reads before the core of the reference.
 *
 * Unlike the editor's chat, nothing here arrives with the template already in hand: the agent
 * reads it with `read`, and each `update` is saved as it is made. Ids are renumbered by a save,
 * which is the one thing an agent used to the editor would get wrong, so it is said twice.
 */
export function toolsPreamble(tools: { read: string; update: string; create: string }): string {
  const { read, update, create } = tools;
  return `# Editing a WE template

A template is the JSON tree a WE space renders as its interface. You edit one with two tools, each
given the id of the Template record to work on, and make a new one with a third.

- **${create}** — makes a new template and SAVES it: a shell (a space's whole interface), a view
  (one section of a space) or an app (the chrome around every space). Name it, and say where it
  goes: \`library\`, the person's own, unless they asked for it to be in this space. It starts from
  a working template of its kind, from a template it is given to fork, or from a whole \`schema\`
  you write. Then read the new record with ${read} and edit it like any other.
- **${read}** — the template. Call it first with no arguments: it answers with the template's
  \`version\` and the template as currentSchema — the whole tree, or an outline of every node plus
  the parts the request seems to be about when it is too large to send whole — and the space's own
  data models, when it has any. Then ask for nodes by \`ids\`, or \`find\` them by what they say.
  \`about\`, in words, chooses which nodes come back in full with the outline.
- **${update}** — applies a list of patches and SAVES them, as one change everybody in the space
  sees. Pass the \`version\` ${read} gave you: if the template has changed since, the call is
  refused and you read it again. \`dry_run: true\` checks the patches without saving anything.

Put every patch an edit needs into ONE ${update} call. Each call is saved, and each save is a new
version on every screen showing the template.

**Node ids are renumbered when the template is saved.** After a successful ${update}, call ${read}
again before patching anything else.

Look a component, store or section up before you use it rather than guessing its props or
members: everything beyond what follows is a documentation topic of its own, listed at the end.
Most edits compute a value or style something, so read \`template/core/expressions\` and
\`template/core/design-props\` before writing patches unless the edit plainly needs neither.

When you are done, say in a sentence or two what you changed, for the person who asked.

${patchingRules(update, 'this reference and its topics')}
---

`;
}
