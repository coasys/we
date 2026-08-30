/**
 * Schema operators fragment — documents schema structure, the expression layer, the handler and
 * query tokens, local state, and block-level dynamic structures ($each, $if, $query).
 *
 * Hand-maintained, except the function library, which is generated from the registry so the
 * documented set and the callable set are one list.
 */
import type { SourceEntry } from '../types.js';

/** What the reference needs of a library function — `FunctionSpec` less its implementation. */
export interface FunctionDoc {
  name: string;
  category: string;
  params: readonly string[];
  doc: string;
  example: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  list: 'Lists',
  text: 'Text',
  number: 'Numbers',
  object: 'Objects',
  form: 'Form state',
};

/**
 * The function library as the reference lists it, then the host's own functions.
 *
 * Grouped by category, one line each with the signature, the sentence and an example. The host's
 * functions come last under their own heading so a reader knows which names are the language's and
 * which are this deployment's — a template written against a host function is portable only to a
 * host that provides it.
 */
export function formatFunctionLibrary(library: FunctionDoc[], sources: SourceEntry[]): string {
  const lines: string[] = [];
  for (const category of Object.keys(CATEGORY_LABELS)) {
    const entries = library.filter((fn) => fn.category === category);
    if (!entries.length) continue;
    lines.push(`  ${CATEGORY_LABELS[category]}:`);
    for (const fn of entries) {
      lines.push(`    ${fn.name}(${fn.params.join(', ')}) — ${fn.doc}  e.g. ${fn.example}`);
    }
  }
  lines.push('  Host functions (this deployment registers them):');
  if (!sources.length) lines.push('    (none)');
  for (const source of sources) {
    lines.push(`    ${source.name}(${source.params.join(', ')}) — ${source.doc}  e.g. ${source.example}`);
  }
  return lines.join('\n');
}

export function schemaOperators(library: FunctionDoc[], sources: SourceEntry[]): string {
  const FUNCTIONS = formatFunctionLibrary(library, sources);
  return `
## Schema Structure

A schema is a tree of nodes. Each node can have:
- type: The component to render (string, e.g. "we-button", "Column")
- props: An object of props for the component
- children: An array of child nodes, strings for text, or expressions like { "$": "post.title" } (rendered as text).
- slots: Named slots for advanced composition (optional)
- slot: The name of the slot this node should be rendered into (optional)
- routes: For routing components, an array of nestable route objects (optional)
- $localState / $queries: ephemeral state and hoisted subscriptions declared on the node (optional; see Dynamic Logic)
- styles: Raw CSS escape hatch — Record<string, string | number> applied as inline styles on a **wrapper div** that surrounds the component. Use only for CSS that must live on a wrapper: filter, clip-path, backdrop-filter, mix-blend-mode. When present the wrapper participates in layout (no display:contents), so CSS effects apply correctly. **Important:** this is NOT the same as props.styles. If you want to apply custom CSS to a Column, Row, or Grid's own element (e.g. a background image), put it in props.styles instead — node-level styles go on a wrapper div around the component and will be hidden behind the component's own background.

The ROOT node carries one more, and it is required:

- meta: { name, description, icon } — what the template is called and how it is listed. Optional
  keys: role: 'view' for a section rather than a shell (absent means shell), themeId for a theme the
  template was designed with, panels for the surfaces the interface has (see Panels), and
  chromeReserve for a band the shell pins over the content. A root node without meta is refused.

Example node:
{
  "type": "we-button",
  "props": {
    "onClick": { "$action": "routeStore.navigate", "args": ["/home"] }
  },
  "children": [
    { "type": "we-icon", "props": { "name": "house" } },
    { "type": "we-text", "props": { "size": "600" }, "children": ["Home"] }
  ]
}

## Prop-level Dynamic Logic & Expressions

Two kinds of token go in props: an EXPRESSION, { "$": "…" }, for anything computed (a store read, a
condition, a label, a list), and a HANDLER ($action, $setLocal, …) for anything that happens on an
event. A plain string is always text. There are no other value tokens.

Store reference:
{ "$": "storeName.property.path" }
Reads a value from a named store, supporting nested paths — reactive, so the prop follows the store.

Action/event:
{ "$action": "storeName.method", "args": [...] }
Calls a method on a store, optionally with arguments (which can themselves be tokens).
IMPORTANT — omitting "args" does NOT call the method with no arguments: the handler's own arguments are
forwarded, so a click handler passes the DOM event as the first parameter. That is deliberate (it is how
{ "onChange": { "$action": "store.method" } } passes a value straight through), but it means a method whose
first parameter is OPTIONAL receives a PointerEvent from a button written the obvious way. Pass the argument
you mean explicitly when the method has an optional leading parameter — note "args": [] does not help, since
an empty list is treated as "no args given" and forwards the event too.
Supports async lifecycle callbacks — fired after the store method's Promise resolves/rejects:
  onSuccess: [...actions]  — fired on resolve; { "$": "result" } (and result.<path>) in args refers to the resolved value
  onError: [...actions]    — fired on reject; { "$": "result.message" } etc. refers to the error object
  onFinally: [...actions]  — fired regardless of outcome
Non-promise (synchronous) methods are unaffected — lifecycle keys are ignored.
Example — close modal after async submission:
{ "$action": "spaceStore.createSpace", "args": [...], "onSuccess": [{ "$setLocal": "modalOpen", "value": false }] }
Example — navigate to newly created item:
{ "$action": "spaceStore.createSpace", "args": [...], "onSuccess": [{ "$setLocal": "modalOpen", "value": false }, { "$action": "routeStore.navigate", "args": [{ "$": "\`/space/\${result.uuid}\`" }] }] }

Record mutations via $action (use these for creating/updating/deleting records):
A RECORD is one stored thing; an ENTITY is its type. Every one of these takes the entity name first
and acts on a record of it.

record.create — creates a record in the current perspective (default) or a specified one:
{ "$action": "record.create", "args": ["EntityName", { "field": "value" }, { "perspective": "datasetStore.rootDataset" }] }
The third argument is an options object. Omit it to use the current space perspective.

record.update — updates one record:
{ "$action": "record.update", "args": ["EntityName", { "$": "item.id" }, { "field": "newValue" }] }
To target a non-current perspective: { "$action": "record.update", "args": ["EntityName", { "$": "item.id" }, { "field": "value" }, { "perspective": "datasetStore.rootDataset" }] }

record.delete — deletes one record:
{ "$action": "record.delete", "args": ["EntityName", { "$": "item.id" }] }

Use perspective: 'datasetStore.rootDataset' for we-root entities (AgentSettings, ChatSession, etc.).
Use the default (no perspective) for space-scoped entities (Space, Signal, etc.).

record.* writes directly; recordStore is the form surface over the same job — it derives a form from
the entity's own declaration, so a community's newest entity is creatable with no schema written for
it. Reach for record.create when the template knows the fields, recordStore when a person is filling
them in.

Expressions:
{ "$": "<expression>" }
Every computed value — a condition, a label, a number, a filtered list — is one expression string in a
{ "$": … } token. This is the value layer's whole vocabulary. The node layer ($each, node-level $if,
$routes, $animate…), queries ($query, $queries) and handlers ($action, $setLocal, $toggleLocal…) stay
as tokens; an expression goes anywhere a VALUE goes — a prop, a condition, $each's items, a children
array (rendered as text), a where value, an $action argument.

References — what a name starts from:
  spaceStore.members             a store member (any store in the Stores section; modules.<id>.<key> for a module)
  local.searchText               a $localState or $queries field; dot paths read into object fields
  post.title                     a name bound by $each / $single / $agent through "as" — the default is item
  index, prev                    $each's row position, and the previous row
  me.did, currentDataset         the current agent, and the active dataset
  surface.tier, surface.width    the responsive boundary
  event, arg, result             the callback argument inside a handler, and a settled $action's value
A plain string in an expression is ALWAYS a literal: 'item.name' is five words, item.name is a read.
A plain string in a PROP or in children is text too: "$item.name" renders those ten characters. A
reference is always written { "$": "item.name" }; the validator rejects the old string spelling.
A store's actions are unreachable — spaceStore.createPost reads as nothing; only $action calls.

Operators, in JavaScript's spelling and precedence:
  == !=                          strict equality
  < > <= >=                      numeric comparison
  in                             list membership:  item.role in ['admin', 'moderator']
  ! && ||                        boolean logic. && and || ANSWER WITH A BOOLEAN, never with an operand
  ??                             the fallback-value idiom:  local.name ?? 'Untitled'
  test ? a : b                   conditional value
  + - * / %                      arithmetic; + joins strings when either side is one; / by 0 is 0
  \`…\${expr}…\`                    interpolation
  a.name   a[i]                  property and index reads; a missing path is undefined, never an error
  [a, b]   { key: value }        list and object literals — the where-object below is one

Comprehensions — the one place a name is bound, over a list:
  items.filter(x, x.done)          items.map(x, x.name)          items.find(x, x.id == local.selected)
  items.exists(x, x.role == 'admin')                            items.all(x, x.read)
Over something that is not a list: filter and map give [], find gives undefined, exists false, all true.

Functions — the library. f(a, b) and a.f(b) are the same call; a value's own methods are never callable.
Nothing is ever added to the grammar above: a new capability is a function here, or one the host
registers (listed last). Wrong-typed input answers with the empty value of its kind, never an error.
${FUNCTIONS}

The where-object — one grammar shared by filter(), find(), and $query's where. Keys are field names;
values may be expressions (in an expression) or tokens (in a $query):

  { field: 'value' }                       — strict equality
  { field: ['a', 'b'] }                    — set membership (IN); matches any of them
  { field: { not: 'value' } }              — inequality; a list excludes several values
  { field: { contains: 'text' } }          — case-insensitive substring match (strings only)
  { field: { startsWith: 'text' } }        — anchored prefix match, case-SENSITIVE
  { field: { endsWith: 'text' } }          — anchored suffix match, case-SENSITIVE
  { field: { exists: true } }              — non-null / non-undefined presence check
  { field: { exists: false } }             — null or undefined check
  { OR: [ {…}, {…} ] }  { AND: [ … ] }  { NOT: {…} }   — combinators; sibling keys are implicitly ANDed

A bare list is the positive counterpart of "not" with a list, and the way to fetch a known set:
{ id: ['id1', 'id2', 'id3'] }. Native on the AD4M backend, where it pushes down to a SPARQL VALUES
clause. An empty list matches nothing, which is what "none of these" should mean.

startsWith/endsWith are case-sensitive where contains is not: they match structured strings against
a known prefix (an ISO date, an id out of a URI). They are NOT native to the AD4M backend, so a $query
using one is refused — use contains there; inside filter() they are evaluated client-side.

Note: OR/AND/NOT in a $query's where disables the SPARQL-level sort/pagination pushdown (see
count-projection and relation-property ordering below) — those orderings silently stop working in the
same query's where clause, because the fallback sort runs before the projection data is attached.

Examples:
{ "$": "filter(spaceStore.members, { role: 'admin' })" }
{ "$": "filter(spaceStore.members, { location: { exists: true }, handle: { contains: local.searchText } })" }
{ "$": "filter(local.dayEvents, { startDate: { startsWith: cell.date } }, 2)" }        — the first two only
{ "$": "find(local.signalTypes, { slug: 'like' }).id" }                                — undefined when nothing matches
{ "$": "count(local.rows) > 0 && local.searchText != ''" }
{ "$": "item.author == me.did ? 'mine' : 'theirs'" }
{ "$": "\`\${count(spaceStore.members)} \${plural(count(spaceStore.members), 'Member', 'Members')}\`" }
{ "$": "spaceStore.members.filter(m, m.did != me.did).map(m, m.handle).join(', ')" }
{ "$": "post.author in spaceStore.mutedDids" }

Rules:
- An expression naming event/arg/result at the TOP LEVEL of an $action's args, or as a $setLocal
  "value", is evaluated when the handler fires. Nested inside another token it is evaluated at render
  time against no event and becomes a constant — the validator rejects that.
- The validator reports every mistake with a column: an unknown name (with "did you mean"), an unknown
  store member, an undeclared local, an unknown function, a wrong argument count, prototype access.
- No new value operators will be added and no new syntax. Computation the library lacks is a function
  the host registers, catalogued under "Host functions" above.

Query (data retrieval):
{ "$query": { "entity": "EntityName", "where": { "field": "value" }, "limit": 10, "order": { "field": "asc" } } }
Queries the current dataset for entity instances. Always returns an array.
Options: entity (required), where, order, limit, offset, include, scope, dataset, subscribe.
subscribe defaults to true — reactive live updates. Set subscribe: false to do a one-time fetch.
By default $query targets the current dataset. Use dataset to query a different dataset — required
when reading entities from an external app (e.g. Flux) that is open as a WE space:
{ "$query": { "entity": "Channel", "dataset": { "$": "currentDataset" } } }

entity may be an expression rather than a literal name — what lets a list render records of a type
the template was not written for. Put the query inside an $each over a list of model names and read
the row:
{
  "type": "$each",
  "props": { "items": { "$": "shapeStore.extractionTargets" }, "as": "target" },
  "children": [{
    "type": "Column",
    "$queries": { "found": { "entity": { "$": "target" }, "order": { "createdAt": "asc" } } },
    "children": ["…one group per model, each with its own subscription…"]
  }]
}
Pair it with recordStore.displays[target] to draw the rows, and the group renders a model a
community defined this morning with no template change (see "A record of any type").
USE A LITERAL WHEREVER THE TYPE IS KNOWN. The validator cannot check a name it only sees at
runtime, so a typo fails as a silently empty list rather than as an error — and a name that has not
resolved yet reads as "not ready", so the query simply waits. Note the counts of such a set cannot
be totalled: each group is its own subscription and a schema cannot sum a list of queries whose
length it does not know, so put a count inside each group rather than above them.

Backend-neutral identity & dataset refs — prefer these over backend-store paths inside $query and conditions:
- currentDataset — the currently active dataset (an AD4M perspective, in the AD4M backend). Use as a dataset value.
  A host store's dataset accessor (e.g. \`dataset: 'datasetStore.marketplaceDataset'\`) works as a dataset value too.
  When passing a dataset to a *component prop* rather than a query, append \`.handle\` — component props take the
  backend's own dataset handle: { "perspective": { "$": "datasetStore.currentDataset.handle" } }.
- me — the current agent's identity object. Use me.did for their DID (ownership checks, author filters, e.g. { "$": "post.author == me.did" }); me.handle / me.avatar for profile fields once loaded.

Eager-loading relations with include (most common relational pattern):
include hydrates related model instances in the same query — no extra fetches needed.
Relation names come from the HasMany relations listed for each model in externalEntities.

Simple include — hydrate all related instances:
{ "$query": { "entity": "Channel", "include": { "conversations": true } } }
Each item in the result will have a conversations array of hydrated Conversation objects.

Sub-query include — filter, sort, or limit the related records:
{ "$query": { "entity": "Channel", "include": { "conversations": { "order": { "createdAt": "desc" }, "limit": 10 } } } }

Nested include — hydrate relations of relations:
{ "$query": { "entity": "Channel", "include": { "conversations": { "include": { "messages": true } } } } }
Nesting can go as deep as needed. Each level adds one batched fetch (not N+1).

Count projection — add a derived numeric field:
{ "$query": { "entity": "Post", "include": { "$likeCount": { "from": "likes", "count": true } } } }
The $-prefixed key becomes a new field on each result item (e.g. item.$likeCount = 42).

Sorting by a count projection — order can reference a $-prefixed count key directly, sorting by the aggregate:
{
  "$query": {
    "entity": "Post",
    "limit": 20,
    "order": { "$likeCount": "desc" },
    "include": { "$likeCount": { "from": "likes", "count": true } }
  }
}
Requirements: only a single order key is supported when it targets a projection (mixing it with a second sort key falls back
to a plain property sort), and the query must also specify limit or offset — without one the count isn't computed yet at
sort time and the order silently has no effect. Always pair count-projection ordering with a limit.
Combine with a ternary for a user-togglable sort field (e.g. "newest" vs "most liked"):
{
  "order": { "$": "local.sortField == 'likes' ? { $likeCount: local.sortDirection } : { createdAt: local.sortDirection }" }
}

Sorting by a related model property — order can reference a dotted "relation.property" path for a HasOne/HasMany
relation declared on the model, sorting by a scalar property on the related instance:
{
  "$query": {
    "entity": "Space",
    "limit": 20,
    "order": { "location.country": "asc" },
    "include": { "location": true }
  }
}
Same requirements as count-projection ordering above: only a single order key, and pair with limit/offset — without
one the relation data isn't attached yet at sort time and the order silently has no effect. include isn't required
for the sort itself (the relation is resolved from the model's declared shape), but you'll usually want it anyway to
read the field in the UI (e.g. { "$": "space.location.country" }).
Combine with a ternary the same way as count-projection ordering to let the user toggle between sort fields.

Single-item projection — add a derived field that resolves to one instance or null:
{ "$query": { "entity": "Post", "include": { "$myLike": { "from": "likes", "where": { "author": { "$": "me.did" } }, "limit": 1 } } } }
With limit: 1 the field unwraps to T | null instead of an array.

include only works with typed relations — ones where the target model class is known.
For WE models this is always the case. For external models, check the externalEntities listing:
relations marked "→ EntityName" are typed (safe for include); relations marked "parent query only"
are untyped and will crash at runtime if used with include — use a scope drill-down instead.

Relational queries — fetch a parent record's children (drill-down navigation):
{ "$query": { "entity": "Conversation", "scope": { "anchor": "Channel", "via": "conversations", "anchorId": { "$": "channel.id" } } } }
scope.anchor is the parent entity type; scope.via is its relation whose targets are this query's entity (the
HasMany relation listed for that entity in externalEntities); scope.anchorId is the parent record's id (typically
from a $each context variable or a route segment). The adapter resolves the relation to a backend handle —
no protocol details live in the template.
Use this pattern when navigating to a detail route and loading only that record's children.
For external-app datasets, always add dataset: { "$": "currentDataset" }.

Local state (scoped ephemeral state):
Declare on any node: "$localState": { "name": { "type": "string", "initial": "" } }
Supported types: "string", "boolean", "number", "function", "object", "array".
"array" is a set of values — the type $toggleLocalIn writes and \`in\` reads. Use it for per-row state
(which rows are open, which are selected) where the rows come from data.
Two opt-in persistence tiers (see docs/architecture/routing-and-view-state.md for the full rules):
- "syncParam": "<param>" mirrors the field into a URL query parameter — for VIEW STATE (selected
  content type, sort, filters, search): what a shared link's recipient should see exactly as the
  sender does. Object form { "name": "type", "push": true } adds a Back entry on change (use for
  content-type switches; sort/filter changes keep the default replace). A field back at its
  declared initial removes its param, keeping URLs clean.
  Example: { "type": "string", "initial": "posts", "syncParam": { "name": "type", "push": true } }
- "persist": "<key>" keeps the field on the device (localStorage) — for PREFERENCES (display
  density, collapsed rails): things a shared link must NOT impose on its recipient. The key is
  explicit and deployment-global (namespace it, e.g. "cards.displayMode").
Precedence on mount: URL param > persisted value > declared "initial"; $resetLocal clears both.
Neither applies to "file"/"function" fields. Open-modal and in-flight flags stay plain (ephemeral).
The deciding question: "if I sent this URL to someone, should they see the effect?" — yes: syncParam;
no but future-me should: persist; no one: plain.
Links may also carry ?template=<id> and ?theme=<id> — the shell applies them when the recipient has
them and warns (toast) when not. Templates never handle these params themselves.
Read:  { "$": "local.name" } — the signal value (reactive).
       { "$": "local.name.nested.path" } — dot paths read into object-typed fields (reactive).
Write: { "$setLocal": "name", "value": { "$": "event.target.value" } } — event handler that sets what the expression computes when it fires, with event in scope.
       { "$setLocal": "name", "value": "literal" } — sets to a literal value (string, number, boolean, null, object).
       { "$setLocal": "name", "merge": { "field": { "$": "event.detail" } } } — shallow-merges fields into an object-typed signal; each field is a literal or an expression. Use for partial updates to object state.
       { "$setLocal": "name", "value": { "$": "local.name + 20" } } — arithmetic on the current value, for paging and counters.
Note "value" is a LITERAL unless it is an expression: any other token object inside it is stored as the object, not as what it would resolve to.
Toggle: { "$toggleLocal": "fieldName" } — toggles a boolean field (equivalent to setting it to !current). Use for show/hide, open/close, expand/collapse patterns.
Toggle one of many: { "$toggleLocalIn": "fieldName", "value": { "$": "group.id" } } — adds the value to an
  array-typed field, or removes it if already there. Read it back with \`in\`:
  { "$": "group.id in local.collapsedGroups" }.
  This is how PER-ROW state works when the rows come from data. $localState field names are fixed
  when the template is written, so "expanded?" cannot be a boolean per row for rows that come from a
  $query or a store — there is no name to give them. Hold the ids instead:
    "$localState": { "collapsedGroups": { "type": "array", "initial": [] } }
  A fixed, known-in-advance set of sections is still better served by one boolean each.
Call function: { "$callLocal": "fieldName" } — event handler that calls the function stored in a function-typed local field.
  Used when a child component needs to trigger a callback passed in via $localState.
  The field must be declared as type: 'function' and set via $setLocal.
  Example: { "onClick": { "$callLocal": "onConfirm" } }
State is created on mount and destroyed on unmount. Nested $localState declarations merge, inner fields shadow outer.
Local values can be used in $action args: { "$action": "store.method", "args": [{ "$": "local.name" }] }

Object-typed local state (consolidating related scalar fields):
When several related fields share a common condition on their initial values (e.g. all null/empty when a store value is absent), prefer a single "object" field seeded from the store, then read sub-fields with dot-notation and write with merge.
Example — location object (replaces 5 separate scalar fields with conditional initials):
  "$localState": { "location": { "type": "object", "initial": { "$": "spaceStore.currentSpace.location" } } }
  Read:  { "$": "local.location.latitude" }, { "$": "local.location.city" }
  Write (picker confirm): { "$setLocal": "location", "value": { "$": "event.detail" } }
  Write (partial edit):   { "$setLocal": "location", "merge": { "city": { "$": "event.detail" } } }
  Write (clear):          { "$setLocal": "location", "value": null }
  Condition (has location): { "$": "local.location" }
Use "object" whenever you would otherwise write 3+ related scalar fields each needing a conditional initial value.

Hoisted query state ($queries):
Declare on any node to run reactive subscriptions at the node root and expose results under local.
Solves two problems: avoids N duplicate subscriptions inside $each loops, and makes query results available to conditions.
"$queries": { "signalTypes": { "entity": "SignalType", "subscribe": true } }
Results are injected into local as read-only reactive arrays, read as { "$": "local.signalTypes" }.
Query options are identical to $each's $query prop (entity, where, order, limit, include, dataset, subscribe).
Each entry also exposes a read-only boolean local.<name>Loaded — false until the first result set (or
error) arrives, then true for good. Gate a loading skeleton on it so the empty state only ever
asserts "loaded and empty", never "not answered yet":
{ "type": "$if", "props": { "condition": { "$": "local.signalTypesLoaded" }, "then": <list-or-empty>, "else": <skeleton> } }
$queries and $localState share the same local namespace — avoid duplicate names across both.
$setLocal will warn and no-op on $queries entries (they are read-only).
A $query cannot be read inside an expression — a question for the backend is hoisted here and read
back through local. Use count() for conditional visibility:
{ "condition": { "$": "count(local.signalTypes)" } }
Example:
{
  "$queries": { "signalTypes": { "entity": "SignalType", "subscribe": true } },
  "type": "Column",
  "children": [
    {
      "type": "$each",
      "props": { "items": { "$": "local.signalTypes" }, "as": "sig" },
      "children": [...]
    }
  ]
}

Boolean toggle pattern (show/hide comments, expand/collapse sections, etc.):
{
  "$localState": { "showComments": { "type": "boolean", "initial": false } },
  "children": [
    {
      "type": "we-button",
      "props": {
        "variant": "ghost",
        "onClick": { "$toggleLocal": "showComments" }
      },
      "children": [{ "type": "we-icon", "props": { "name": "chat-circle" } }]
    },
    {
      "type": "$if",
      "props": {
        "condition": { "$": "local.showComments" },
        "then": { "type": "Column", "children": [{ "type": "we-text", "children": ["Comments visible"] }] }
      }
    }
  ]
}

Form validation (extends $localState):
Declare validation rules on fields:
"$localState": {
  "email": {
    "type": "string",
    "initial": "",
    "validate": [
      { "rule": "required", "message": "Email is required" },
      { "rule": "pattern", "value": "^[^@]+@[^@]+$", "message": "Invalid email" }
    ]
  }
}

Built-in rules: required, minLength (value: N), maxLength (value: N), min (value: N), max (value: N), pattern (value: regex string), match (field: otherFieldName). All accept optional "message" override.

Read functions (in an expression):
{ "$": "error('fieldName')" } — first validation error message (only shown after field is touched), or "".
{ "$": "valid('fieldName')" } — true if all rules pass (regardless of touched state).
{ "$": "touched('fieldName')" } — true after the field has been blurred/touched.
{ "$": "formValid()" } — true if ALL validated fields in the current $localState scope pass.

Action tokens:
{ "$touch": "fieldName" } — marks a single field as touched (in onBlur; opt-in, see below).
{ "$touch": "$all" } — marks all fields in scope as touched (use before submit guard).
{ "$resetLocal": "$scope" } — resets all fields to initial values and clears touched state.

Handler arrays (compose multiple actions on one event):
{ "onClick": [{ "$touch": "$all" }, { "$if": { "condition": { "$": "formValid()" }, "then": { "$action": "store.submit", "onSuccess": [{ "$setLocal": "modalOpen", "value": false }] } } }] }
Array entries execute sequentially. { "$if": { "condition", "then", "else" } } in a handler position runs one side or the
other when the event fires — its condition may read event. It is the one place $if is a token rather than a node.
Prefer onSuccess over a bare $setLocal before the $action — the bare form closes the modal immediately (losing the loading spinner); onSuccess waits for the Promise to resolve.

Typical form pattern — validate on submit:
{
  "$localState": {
    "name": { "type": "string", "initial": "", "validate": [{ "rule": "required" }] },
    "submitting": { "type": "boolean", "initial": false }
  },
  "children": [
    {
      "type": "we-form-field",
      "props": { "label": "Name", "error": { "$": "error('name')" } },
      "children": [{
        "type": "we-input",
        "props": {
          "value": { "$": "local.name" },
          "onInput": { "$setLocal": "name", "value": { "$": "event.detail" } }
        }
      }]
    },
    {
      "type": "we-button",
      "props": {
        "loading": { "$": "local.submitting" },
        "disabled": { "$": "local.submitting" },
        "onClick": [
          { "$touch": "$all" },
          { "$if": { "condition": { "$": "formValid()" }, "then": { "$action": "store.save", "args": [{ "$": "local.name" }], "onSuccess": [{ "$setLocal": "submitDone", "value": true }] } } }
        ]
      },
      "children": ["Submit"]
    }
  ]
}

The submit button is disabled only while the request is in flight — NOT on { "$": "!formValid()" }.
Those two are mutually exclusive. A button disabled while the form is invalid can never be clicked in the one
state where { "$touch": "$all" } would reveal something, so the guard chain becomes dead code and blur is left
as the user's only feedback path. Choose one shape:
  - Validate on submit (above). The button is always clickable and the errors appear on the click that was
    refused, which is where the user asked the question.
  - Hard gate: "disabled": { "$": "!formValid()" }, and then drop { "$touch": "$all" } as dead
    and wire "onBlur": { "$touch": "fieldName" } per field — otherwise no error is ever reachable.

"onBlur": { "$touch": "fieldName" } is an opt-in, not boilerplate. It earns its place on long multi-field forms
where a field is worth judging the moment it is left — a "match" rule on a confirm-password field, say. On a
short form it fires an error at someone who merely clicked through a field they had not filled in yet.

No validation, just a precondition (sign-in, search, any single-field submit):
When nothing about the value is locally judgeable — a password is only wrong once the backend says so — skip the
validation machinery and gate on the value itself:
{
  "$localState": { "password": { "type": "string", "initial": "" } },
  ...
  "disabled": { "$": "!local.password" }
}
A "required" rule here would exist only to drive "disabled", and its message is then one stray { "$touch": … }
away from telling the user "Password is required" about a field they simply have not typed into yet.

## Block-level Dynamic Structures

Block-level structures use "type" starting with "$" for dynamic rendering of schema nodes.

Each loop:
{ "type": "$each", "props": { "items": { "$": "storeName.arrayProperty" }, "as": "itemName" }, "children": [ ... ] }
Renders children once for each item. The "as" name becomes a name expressions read — { "$": "itemName.title" }. Defaults to "item" — omit "as" unless you need a different name.

Each row also gets two names describing its position in the list:
- index — the 0-based position.
- prev — the previous item, absent on the first row. Read fields off it like any name: { "$": "prev.author" }.

prev is what makes **grouping** expressible — collapsing consecutive rows by the same author so
a run of messages shows one avatar and byline instead of repeating them. Without it a row can only
ask about itself, and the compact form is unreachable by any prop or theme:
{
  "type": "$if",
  "props": {
    "condition": { "$": "message.author == prev.author" },
    "then": { "...": "compact row — no avatar, no byline" },
    "else": { "...": "full row" }
  }
}
The first row has no prev at all, so the condition is false there and it keeps its byline —
which is what a feed wants, and why absent must not read as "same as the last item".

Both shadow in a nested $each, exactly as the item does: the inner index restarts at 0.

Conditional rendering:
{ "type": "$if", "props": { "condition": ..., "then": { ... }, "else": { ... } } }
Renders "then" node if condition is truthy, else renders "else" node.
Supports enterTransition / exitTransition for CSS animations when the node mounts/unmounts.
TransitionConfig = TransitionEffect | TransitionEffect[]
TransitionEffect = { type: 'fade'|'slide'|'scale'|'reveal'|'pulse', duration?: ms, easing?: string, delay?: ms, direction?: 'left'|'right'|'up'|'down', distance?: string, axis?: 'block'|'inline' }
fade controls opacity only; slide/scale control transform only. pulse is a persistent looping animation (not a one-shot transition) — starts once entered, stops on exit; direction/distance don't apply (default duration 1200ms, easing 'ease-in-out'). Compose fade/slide/scale together in an array; pulse is typically used alone.
Example: enterTransition: [{ type: 'fade', duration: 300 }, { type: 'slide', direction: 'up', distance: '40px', duration: 400 }]
Example (pulse): enterTransition: { type: 'pulse', duration: 1500 }

reveal — opening and closing in place:
reveal is the size axis the others lack: it eases the element open to the size its content actually
wants, and closed again. Use it for anything that opens in place — a disclosure, an accordion
section, a "show more", a sidebar label appearing as the rail expands. axis: 'block' (the default)
opens downward; axis: 'inline' opens sideways.
Example (disclosure): enterTransition: [{ "type": "reveal", "duration": 300 }, { "type": "fade", "duration": 180 }]
Example (label beside an icon): enterTransition: { "type": "reveal", "axis": "inline", "duration": 250 }
Do NOT hand-roll this with maxHeight and a transition string. A guessed maxHeight applies the easing
curve to the guess rather than to the real height, so most of the duration is spent crossing space
that isn't there, and it breaks silently the day the content grows past the guess.
reveal composes with fade exactly as slide does. Pair them: opening a box that is fully opaque from
the first frame reads as a jump, however smooth the size change is.
A reveal in an exitTransition also decides when the node unmounts — the node stays mounted for the
longest effect in the config, so the collapse finishes before the content is removed.

Viewport / mount / condition animation (child always in DOM):
{ "type": "$animate", "props": { "condition"?: SchemaProp, "scrollReveal"?: true | number, "scrollLeave"?: true | number, "scrollPast"?: string, "enterTransition"?: TransitionConfig, "exitTransition"?: TransitionConfig }, "children": [<node>] }
The child is always mounted. fade/slide/scale are CSS transitions (opacity/transform); reveal animates the element's own size; pulse is a real CSS @keyframes loop — use this for scroll-reveal effects.
Do NOT use $animate when the child should be absent from the DOM. Use $if for conditional DOM presence.
For an open/close that must NOT destroy what is inside it — a section holding a scroll position, a
half-typed field, or a live subscription a collapsed row shouldn't tear down — use $animate with
condition rather than $if, which unmounts the content when closed.
condition works like $if's condition (an expression), except the child
is never unmounted: only enterTransition/exitTransition replay as it changes. The initial render
already matches whatever the condition is at mount — a node that starts open does not flash
closed-then-open, and one that starts closed does not briefly show its content first.
When exitTransition is omitted, closing reuses enterTransition (mirrored), the same fallback $if uses.
A reveal clips a closed section to zero size, so it is already unreachable; without one (a plain fade),
the wrapper's pointer-events follow the condition too, so a fully transparent closed section can't be
clicked through.
condition is mutually exclusive with the scroll triggers below and, when present, takes over as the
sole trigger — scrollReveal/scrollLeave/scrollPast are ignored on that node.
scrollReveal: true fires enterTransition when the element enters the viewport.
scrollReveal: -100 fires 100px before the element would enter (negative = earlier reveal).
scrollLeave fires exitTransition when the element leaves the viewport.
scrollPast: "element-id" watches a sentinel element (by DOM id) go past the $animate element itself.
  enterTransition fires once the sentinel has scrolled above the $animate element's top edge (or out of
  the viewport) — so a sentinel sliding under a sticky bar counts as gone the moment it does.
  exitTransition fires when the sentinel comes back below it (user scrolled back up).
  The sentinel may mount later than the $animate node; it is picked up when it appears.
  Use this for sticky headers: place a zero-height sentinel div at the bottom of the non-sticky header section,
  then wrap the mini-profile in $animate with scrollPast pointing to that sentinel's id.
  scrollPast is mutually exclusive with scrollReveal/scrollLeave.
Without condition or a scroll trigger, the enterTransition runs once on mount.
Only one child node is supported.
Example (condition-driven disclosure — a collapsible group whose rows hold live store bindings and
must not resubscribe every time it opens):
{
  "type": "$animate",
  "props": {
    "condition": { "$": "!local.sectionCollapsed" },
    "enterTransition": { "type": "reveal", "duration": 250 }
  },
  "children": [{ "type": "$each", "props": { "items": { "$": "listStore.items" }, "as": "item" },
    "children": [{ "type": "we-text", "children": [{ "$": "item.name" }] }] }]
}
Example (scroll-reveal):
{
  "type": "$animate",
  "props": {
    "scrollReveal": -100,
    "enterTransition": [
      { "type": "fade", "duration": 600, "easing": "ease-in-out" },
      { "type": "slide", "direction": "left", "distance": "200px", "duration": 1000, "easing": "ease-in-out" }
    ]
  },
  "children": [{ "type": "SomeCard", "children": [] }]
}
Example (sticky header mini-profile):
Place a sentinel at the bottom of the header, reference it in the sticky nav:
{ "type": "div", "props": { "id": "header-sentinel" }, "styles": { "height": "0px", "pointerEvents": "none" } }
{
  "type": "$animate",
  "props": {
    "scrollPast": "header-sentinel",
    "enterTransition": { "type": "fade", "duration": 250 },
    "exitTransition": { "type": "fade", "duration": 200 }
  },
  "children": [{ "type": "Row", "props": { "ay": "center", "gap": "300" }, "children": [
    { "type": "we-avatar", "props": { "image": { "$": "space.avatar" }, "size": "sm" } },
    { "type": "we-text", "props": { "fontWeight": "600" }, "children": [{ "$": "space.name" }] }
  ]}]
}

Single model item (load one record, render children with it in context):
{
  "type": "$single",
  "props": {
    "item": { "$query": { "entity": "EntityName", "params": { ... }, "subscribe": true } },
    "as": "profile"   // context key for children — default: 'item'
  },
  "children": [{ "type": "we-text", "children": [{ "$": "profile.username" }] }]
}
Renders nothing until a matching record is found. Like $each but for a single result.
query options (entity, params, include, dataset, subscribe) work identically to $query.

Route outlet:
{ "type": "$routes" }
Indicates where nested routes should render within a layout.

Responsive boundary:
{ "type": "$surface", "props": { "as": "pane" }, "children": [ ... ] }
A box the content inside it measures itself against. Everything inside it — \`*UpProps\` on any
descendant, and \`surface.tier\` read in an expression — is answered by THIS box rather than by the
window or the page.

The host already puts one wherever it mounts a schema tree (the template area, the shell overlays,
every docked module panel), so an ordinary template needs none: \`mdUpProps\` works out of the box.
Declare one when a *part* of your layout should adapt to itself — a two-pane workspace whose right
pane is narrow while the page is wide. Nesting works; the innermost surface wins.

\`as\` names the context key (default \`surface\`), so a nested one can be addressed separately.
Read it with \`surface.tier\` (\`base\` | \`sm\` | \`md\` | \`lg\`) or \`surface.width\` (px):

{ "type": "$if", "props": { "condition": { "$": "surface.tier == 'base'" }, "then": <drawer>, "else": <sidebar> } }

USE THIS SPARINGLY, and only for a genuinely different tree. \`$if\` unmounts and rebuilds its
subtree when the condition changes, which loses scroll position, half-typed input and any live
resource inside it. For different *values* — padding, gap, width, font size — use \`*UpProps\`, which
is pure CSS and remounts nothing. See "Which mechanism to reach for" in the Design System Props
section.

Module slot outlet:
{ "type": "$slot", "props": { "anchor": "call-controls" } }
Renders whatever other feature modules have contributed to that anchor, in order. Only meaningful
inside a module's own chrome: the module declares the anchor name in its \`anchors\` list and marks
where contributions land with this. Resolves to nothing when no module has contributed — no empty
container, no gap. Templates have no use for it; chrome is the host's and the modules', not a
template's.
`;
}
