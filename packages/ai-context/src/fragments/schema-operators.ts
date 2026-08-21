/**
 * Schema operators fragment — documents schema structure, prop-level dynamic logic,
 * and block-level dynamic structures ($each, $if, $query).
 *
 * Hand-maintained: update when new schema tokens are implemented.
 */
export const schemaOperators = `
## Schema Structure

A schema is a tree of nodes. Each node can have:
- type: The component to render (string, e.g. "we-button", "Column")
- props: An object of props for the component
- children: An array of child nodes (or strings for text), or token objects like { $store: '...' } or { $concat: [...] }.
- slots: Named slots for advanced composition (optional)
- slot: The name of the slot this node should be rendered into (optional)
- routes: For routing components, an array of nestable route objects (optional)
- styles: Raw CSS escape hatch — Record<string, string | number> applied as inline styles on a **wrapper div** that surrounds the component. Use only for CSS that must live on a wrapper: filter, clip-path, backdrop-filter, mix-blend-mode. When present the wrapper participates in layout (no display:contents), so CSS effects apply correctly. **Important:** this is NOT the same as props.styles. If you want to apply custom CSS to a Column, Row, or Grid's own element (e.g. a background image), put it in props.styles instead — node-level styles go on a wrapper div around the component and will be hidden behind the component's own background.

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

Special tokens in props enable dynamic, reactive, or computed behavior.

Store reference:
{ "$store": "storeName.property.path" }
Resolves a value from a named store, supporting nested paths.

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
  onSuccess: [...actions]  — fired on resolve; '$result' (and '$result.<path>') in args refers to the resolved value
  onError: [...actions]    — fired on reject; '$result.message' etc. refers to the error object
  onFinally: [...actions]  — fired regardless of outcome
Non-promise (synchronous) methods are unaffected — lifecycle keys are ignored.
Example — close modal after async submission:
{ "$action": "spaceStore.createSpace", "args": [...], "onSuccess": [{ "$setLocal": "modalOpen", "value": false }] }
Example — navigate to newly created item:
{ "$action": "spaceStore.createSpace", "args": [...], "onSuccess": [{ "$setLocal": "modalOpen", "value": false }, { "$action": "routeStore.navigate", "args": [{ "$concat": ["/space/", "$result.uuid"] }] }] }

Model mutations via $action (use these for creating/updating/deleting model instances):
model.create — creates a model instance in the current perspective (default) or a specified one:
{ "$action": "model.create", "args": ["ModelName", { "field": "value" }, { "perspective": "datasetStore.rootDataset" }] }
The third argument is an options object. Omit it to use the current space perspective.

model.update — updates a model instance:
{ "$action": "model.update", "args": ["ModelName", "$item.id", { "field": "newValue" }] }
To target a non-current perspective: { "$action": "model.update", "args": ["ModelName", "$item.id", { "field": "value" }, { "perspective": "datasetStore.rootDataset" }] }

model.delete — deletes a model instance:
{ "$action": "model.delete", "args": ["ModelName", "$item.id"] }

Use perspective: 'datasetStore.rootDataset' for we-root models (AgentSettings, ChatSession, etc.).
Use the default (no perspective) for space-scoped models (Space, Signal, etc.).

Conditional logic:
{ "$if": { "condition": ..., "then": ..., "else": ... } }
Evaluates condition; if truthy, returns then, else returns else.

Map/iterate:
{ "$map": { "items": { "$store": "templateStore.templates" }, "select": { ... } } }
Iterates over an array, mapping each item to a new object using the select mapping.

Pick:
{ "$pick": { "from": { "$store": "userStore.profile" }, "props": ["name", "email"] } }
Picks specific properties from an object.

Concat (string building):
{ "$concat": ["part1", "$context.value", "part2"] }
Joins multiple parts into a single string.

Context references:
Strings starting with "$" followed by a context key resolve to context values.
Example: "$space.name" resolves to the name property of the space context variable.
Dot paths supported: "$item.profile.avatar".

Equality / inequality checks:
{ "$eq": [a, b] } — strict equality
{ "$ne": [a, b] } — strict inequality

Numeric comparisons:
{ "$lt": [a, b] } — a < b (less than)
{ "$gt": [a, b] } — a > b (greater than)
Example: { "$gt": [{ "$count": { "items": { "$store": "listStore.items" } } }, 0] }

Set membership:
{ "$in": [value, array] } — true if array contains value (false if second operand is not an array)
Example: { "$in": [{ "$store": "spaceStore.uuid" }, { "$store": "datasetStore.systemDatasetUuids" }] }
Example: { "$in": ["$item.role", ["admin", "moderator"]] }

Boolean logic:
{ "$and": [a, b, ...] } — all truthy
{ "$or": [a, b, ...] } — any truthy
{ "$not": a } — negation

Array operators:
{ "$filter": { "items": <array>, "where": { "field": "value", ... }, "limit": <number> } }
Filters an array to items where all where conditions match. Mirrors the $query where operator set:

  { "field": "value" }                                   — strict equality
  { "field": ["a", "b"] }                                — set membership (IN); matches any of them
  { "field": { "not": "value" } }                        — inequality; array form excludes multiple values
  { "field": { "contains": "text" } }                    — case-insensitive substring match (strings only)
  { "field": { "startsWith": "text" } }                  — anchored prefix match, case-SENSITIVE
  { "field": { "endsWith": "text" } }                    — anchored suffix match, case-SENSITIVE
  { "field": { "exists": true } }                        — non-null / non-undefined presence check
  { "field": { "exists": false } }                       — null or undefined check

A bare array is the positive counterpart of "not" with an array, and it is the way to fetch a known
set: { "id": ["id1", "id2", "id3"] }. Native on the AD4M backend, where it pushes down to a SPARQL
VALUES clause, so it is index-friendly rather than a scan. An empty array matches nothing, which is
what "none of these" should mean.

startsWith/endsWith are case-sensitive where contains is not: they exist to match structured strings
against a known prefix (an ISO date out of a datetime, an id out of a URI), where folding case would
match things it should not. contains searches prose, which is a different question.
Note they are NOT native to the AD4M backend, so a $query using one is refused outright — use
contains there. Inside $filter they are evaluated client-side and always available.

"limit" keeps only the first N matches — the only way to express "the first few", since the operator
set has no arithmetic and no slice. Use it for a cell showing two of a day's events with a "more"
marker; without it the only option is rendering all of them and clipping, which cuts a row through
the middle of the last one. It is resolved through the prop system, so it can come from $local.

Where values (including those inside operator objects) are resolved through the prop system,
so $store, $local, and context refs like { "$local": "searchText" } all work.

Logical combinators (OR / AND / NOT) — supported in both $query's where and $filter's where:
  { "OR": [ { "field": "value" }, { "field2": "value2" } ] }   — matches if ANY branch matches
  { "AND": [ { ... }, { ... } ] }                              — matches if ALL branches match (sibling keys at the
                                                                  same level are already implicitly ANDed — use AND
                                                                  to group a set of conditions alongside an OR/NOT)
  { "NOT": { "field": "value" } }                              — matches if the branch does NOT match
Branches are full where-clause objects (can contain multiple fields, and can nest OR/AND/NOT inside each other).
Sibling keys alongside OR/AND/NOT at the same level are implicitly ANDed with it.
Example — case-insensitive search across two fields ($filter takes the same shape, e.g. a member
list matching name OR handle):
{
  "$query": {
    "entity": "Space",
    "where": {
      "OR": [
        { "name": { "contains": { "$local": "searchText" } } },
        { "description": { "contains": { "$local": "searchText" } } }
      ]
    }
  }
}
Note: using OR/AND/NOT disables the SPARQL-level sort/pagination pushdown (see count-projection and
relation-property ordering below) — those orderings silently stop working if combined with OR/AND/NOT in the
same query's where clause, because the fallback sort runs before the projection/relation data is attached.

Examples:
{ "$filter": { "items": { "$store": "spaceStore.members" }, "where": { "role": "admin" } } }
{ "$filter": { "items": { "$store": "spaceStore.members" }, "where": { "location": { "exists": true }, "handle": { "contains": { "$local": "searchText" } } } } }
{ "$filter": { "items": { "$local": "dayEvents" }, "where": { "startDate": { "startsWith": "$cell.date" } }, "limit": 2 } }

{ "$count": { "items": <array> } }
Returns the length of an array.
Example: { "badge": { "$count": { "items": { "$store": "notificationStore.unread" } } } }

{ "$find": { "items": <array>, "where"?: { ... }, "select"?: "fieldName" } }
Finds the first matching item. where is optional (returns first item if omitted). select plucks a single field.
Example: { "$find": { "items": { "$store": "spaceStore.members" }, "where": { "id": "$item.creatorId" }, "select": "name" } }

{ "$plural": { "count": <number>, "one": "singular", "other": "plural" } }
Returns "one" when count === 1, otherwise "other". Use in children arrays for count-noun labels.
count is resolved through the prop system — any numeric expression ($count, $store, context ref) works.
Example: { "$plural": { "count": { "$count": { "items": { "$store": "spaceStore.members" } } }, "one": "Member", "other": "Members" } }
Compose with we-number for a full "N Members" display:
  we-number (value: { "$count": ... }, shorten: true) + we-text (children: [{ "$plural": { "count": { "$count": ... }, "one": "Member", "other": "Members" } }])

Query (data retrieval):
{ "$query": { "entity": "ModelName", "where": { "field": "value" }, "limit": 10, "order": { "field": "asc" } } }
Queries the current dataset for entity instances. Always returns an array.
Options: entity (required), where, order, limit, offset, include, scope, dataset, subscribe.
subscribe defaults to true — reactive live updates. Set subscribe: false to do a one-time fetch.
By default $query targets the current dataset ($currentDataset). Use dataset to query a different dataset —
required when reading entities from an external app (e.g. Flux) that is open as a WE space:
{ "$query": { "entity": "Channel", "dataset": "$currentDataset" } }

Backend-neutral identity & dataset refs — prefer these over backend-store paths inside $query and conditions:
- $currentDataset — the currently active dataset (an AD4M perspective, in the AD4M backend). Use as a dataset value.
  A host store's dataset accessor (e.g. \`dataset: 'datasetStore.marketplaceDataset'\`) works as a dataset value too.
  When passing a dataset to a *component prop* rather than a query, append \`.handle\` — component props take the
  backend's own dataset handle: { "perspective": { "$store": "datasetStore.currentDataset.handle" } }.
- $me — the current agent's identity object. Use $me.did for their DID (ownership checks, author filters, e.g. { "$eq": ["$post.author", "$me.did"] }); $me.handle / $me.avatar for profile fields once loaded.

Eager-loading relations with include (most common relational pattern):
include hydrates related model instances in the same query — no extra fetches needed.
Relation names come from the HasMany relations listed for each model in externalModels.

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
Combine with $if for a user-togglable sort field (e.g. "newest" vs "most liked"):
{
  "order": {
    "$if": {
      "condition": { "$eq": [{ "$local": "sortField" }, "likes"] },
      "then": { "$likeCount": { "$local": "sortDirection" } },
      "else": { "createdAt": { "$local": "sortDirection" } }
    }
  }
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
read the field in the UI (e.g. "$space.location.country").
Combine with $if the same way as count-projection ordering to let the user toggle between sort fields.

Single-item projection — add a derived field that resolves to one instance or null:
{ "$query": { "entity": "Post", "include": { "$myLike": { "from": "likes", "where": { "author": "$me.did" }, "limit": 1 } } } }
With limit: 1 the field unwraps to T | null instead of an array.

include only works with typed relations — ones where the target model class is known.
For WE models this is always the case. For external models, check the externalModels listing:
relations marked "→ ModelName" are typed (safe for include); relations marked "parent query only"
are untyped and will crash at runtime if used with include — use a scope drill-down instead.

Relational queries — fetch a parent record's children (drill-down navigation):
{ "$query": { "entity": "Conversation", "scope": { "anchor": "Channel", "via": "conversations", "anchorId": "$channel.id" } } }
scope.anchor is the parent entity type; scope.via is its relation whose targets are this query's entity (the
HasMany relation listed for that entity in externalModels); scope.anchorId is the parent record's id (typically
from a $each context variable or a route segment). The adapter resolves the relation to a backend handle —
no protocol details live in the template.
Use this pattern when navigating to a detail route and loading only that record's children.
For external-app datasets, always add dataset: "$currentDataset".

Local state (scoped ephemeral state):
Declare on any node: "$localState": { "name": { "type": "string", "initial": "" } }
Supported types: "string", "boolean", "number", "function", "object", "array".
"array" is a set of values — the type $toggleLocalIn writes and $in reads. Use it for per-row state
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
Read:  { "$local": "name" } — returns the signal value (reactive).
       { "$local": "name.nested.path" } — dot-notation reads into object-typed fields (reactive).
Write: { "$setLocal": "name", "from": "$event.target.value" } — event handler that updates the signal.
       { "$setLocal": "name", "value": "literal" } — sets to a literal value (string, number, boolean, null, object).
       { "$setLocal": "name", "merge": { "field": "$event.detail" } } — shallow-merges fields into an object-typed signal. Values are resolved as event paths (e.g. "$event.detail") or passed as literals. Use for partial updates to object state.
       { "$setLocal": "name", "by": 20 } — adds to a NUMBER field, reading the current value first. The only arithmetic the schema layer has: use it to advance a page size ("show 20 more") or bump a counter something else watches. A non-numeric current value counts as 0.
Note "value" is a LITERAL and is not resolved — a token object inside it is stored as the object, not as what it would resolve to. To store something computed, bind the prop that reads it instead, or use "from"/"merge", whose values ARE resolved as event paths.
Toggle: { "$toggleLocal": "fieldName" } — toggles a boolean field (equivalent to setting it to !current). Use for show/hide, open/close, expand/collapse patterns.
Toggle one of many: { "$toggleLocalIn": "fieldName", "value": "$group.id" } — adds the value to an
  array-typed field, or removes it if already there. Read it back with $in:
  { "$in": ["$group.id", { "$local": "collapsedGroups" }] }.
  This is how PER-ROW state works when the rows come from data. $localState field names are fixed
  when the template is written, so "expanded?" cannot be a boolean per row for rows that come from a
  $query or a $store — there is no name to give them. Hold the ids instead:
    "$localState": { "collapsedGroups": { "type": "array", "initial": [] } }
  A fixed, known-in-advance set of sections is still better served by one boolean each.
Call function: { "$callLocal": "fieldName" } — event handler that calls the function stored in a function-typed local field.
  Used when a child component needs to trigger a callback passed in via $localState.
  The field must be declared as type: 'function' and set via $setLocal.
  Example: { "onClick": { "$callLocal": "onConfirm" } }
State is created on mount and destroyed on unmount. Nested $localState declarations merge, inner fields shadow outer.
$local values can be used in $action args: { "$action": "store.method", "args": [{ "$local": "name" }] }

Object-typed local state (consolidating related scalar fields):
When several related fields share a common condition on their initial values (e.g. all null/empty when a store value is absent), prefer a single "object" field seeded from the store, then read sub-fields with dot-notation and write with merge.
Example — location object (replaces 5 separate scalar fields with $if guards):
  "$localState": { "location": { "type": "object", "initial": { "$store": "spaceStore.currentSpace.location" } } }
  Read:  { "$local": "location.latitude" }, { "$local": "location.city" }
  Write (picker confirm): { "$setLocal": "location", "from": "$event.detail" }
  Write (partial edit):   { "$setLocal": "location", "merge": { "city": "$event.detail" } }
  Write (clear):          { "$setLocal": "location", "value": null }
  Condition (has location): { "$local": "location" }
Use "object" whenever you would otherwise write 3+ related scalar fields each needing $if on their initial value.

Hoisted query state ($queries):
Declare on any node to run reactive subscriptions at the node root and expose results in $local.
Solves two problems: avoids N duplicate subscriptions inside $each loops, and makes query results available for $if conditions.
"$queries": { "signalTypes": { "entity": "SignalType", "subscribe": true } }
Results are injected into $local as read-only reactive arrays, accessible via { "$local": "signalTypes" }.
Query options are identical to $each's $query prop (entity, where, order, limit, include, dataset, subscribe).
Each entry also exposes a read-only boolean { "$local": "<name>Loaded" } — false until the first
result set (or error) arrives, then true for good. Gate a loading skeleton on it so the empty
state only ever asserts "loaded and empty", never "not answered yet":
{ "$if": { "condition": { "$local": "signalTypesLoaded" }, "then": <list-or-empty>, "else": <skeleton> } }
$queries and $localState share the same $local namespace — avoid duplicate names across both.
$setLocal will warn and no-op on $queries entries (they are read-only).
Use with $count + $gt for conditional visibility:
{ "condition": { "$gt": [{ "$count": { "items": { "$local": "signalTypes" } } }, 0] } }
Example:
{
  "$queries": { "signalTypes": { "entity": "SignalType", "subscribe": true } },
  "type": "Column",
  "children": [
    {
      "type": "$each",
      "props": { "items": { "$local": "signalTypes" }, "as": "sig" },
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
        "condition": { "$local": "showComments" },
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

Read tokens:
{ "$error": "fieldName" } — first validation error message (only shown after field is touched), or "".
{ "$valid": "fieldName" } — true if all rules pass (regardless of touched state).
{ "$touched": "fieldName" } — true after the field has been blurred/touched.
{ "$formValid": "$scope" } — true if ALL validated fields in the current $localState scope pass.

Action tokens:
{ "$touch": "fieldName" } — marks a single field as touched (in onBlur; opt-in, see below).
{ "$touch": "$all" } — marks all fields in scope as touched (use before submit guard).
{ "$resetLocal": "$scope" } — resets all fields to initial values and clears touched state.

Handler arrays (compose multiple actions on one event):
{ "onClick": [{ "$touch": "$all" }, { "$if": { "condition": { "$formValid": "$scope" }, "then": { "$action": "store.submit", "onSuccess": [{ "$setLocal": "modalOpen", "value": false }] } } }] }
Array entries execute sequentially. Non-function entries (e.g. $if with false condition) are skipped.
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
      "props": { "label": "Name", "error": { "$error": "name" } },
      "children": [{
        "type": "we-input",
        "props": {
          "value": { "$local": "name" },
          "onInput": { "$setLocal": "name", "from": "$event.detail" }
        }
      }]
    },
    {
      "type": "we-button",
      "props": {
        "loading": { "$local": "submitting" },
        "disabled": { "$local": "submitting" },
        "onClick": [
          { "$touch": "$all" },
          { "$if": { "condition": { "$formValid": "$scope" }, "then": { "$action": "store.save", "args": [{ "$local": "name" }], "onSuccess": [{ "$setLocal": "submitDone", "value": true }] } } }
        ]
      },
      "children": ["Submit"]
    }
  ]
}

The submit button is disabled only while the request is in flight — NOT on { "$not": { "$formValid": "$scope" } }.
Those two are mutually exclusive. A button disabled while the form is invalid can never be clicked in the one
state where { "$touch": "$all" } would reveal something, so the guard chain becomes dead code and blur is left
as the user's only feedback path. Choose one shape:
  - Validate on submit (above). The button is always clickable and the errors appear on the click that was
    refused, which is where the user asked the question.
  - Hard gate: "disabled": { "$not": { "$formValid": "$scope" } }, and then drop { "$touch": "$all" } as dead
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
  "disabled": { "$not": { "$local": "password" } }
}
A "required" rule here would exist only to drive "disabled", and its message is then one stray { "$touch": … }
away from telling the user "Password is required" about a field they simply have not typed into yet.

## Block-level Dynamic Structures

Block-level structures use "type" starting with "$" for dynamic rendering of schema nodes.

Each loop:
{ "type": "$each", "props": { "items": { "$store": "storeName.arrayProperty" }, "as": "itemName" }, "children": [ ... ] }
Renders children once for each item. The "as" name becomes a context key. Defaults to "item" — omit "as" unless you need a different name.

Each row also gets two context keys describing its position in the list:
- { "$index": ... } — read as "$index", the 0-based position.
- "$prev" — the previous item, absent on the first row. Read fields off it like any context ref: "$prev.author".

"$prev" is what makes **grouping** expressible — collapsing consecutive rows by the same author so
a run of messages shows one avatar and byline instead of repeating them. Without it a row can only
ask about itself, and the compact form is unreachable by any prop or theme:
{
  "type": "$if",
  "props": {
    "condition": { "$eq": ["$message.author", "$prev.author"] },
    "then": { "...": "compact row — no avatar, no byline" },
    "else": { "...": "full row" }
  }
}
The first row has no "$prev" at all, so the condition is false there and it keeps its byline —
which is what a feed wants, and why absent must not read as "same as the last item".

Both shadow in a nested $each, exactly as the item does: the inner "$index" restarts at 0.

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
condition works like $if's condition (any resolvable prop — $store, $local, $eq, …), except the child
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
scrollPast: "element-id" observes a sentinel element (by DOM id) instead of the $animate element itself.
  enterTransition fires when the sentinel leaves the viewport (user scrolled past it).
  exitTransition fires when the sentinel returns (user scrolled back up).
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
    "condition": { "$not": { "$local": "sectionCollapsed" } },
    "enterTransition": { "type": "reveal", "duration": 250 }
  },
  "children": [{ "type": "$each", "props": { "items": { "$store": "listStore.items" }, "as": "item" },
    "children": [{ "type": "we-text", "children": ["$item.name"] }] }]
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
    { "type": "we-avatar", "props": { "image": "$space.avatar", "size": "sm" } },
    { "type": "we-text", "props": { "fontWeight": "600" }, "children": ["$space.name"] }
  ]}]
}

Single model item (load one record, render children with it in context):
{
  "type": "$single",
  "props": {
    "item": { "$query": { "entity": "ModelName", "params": { ... }, "subscribe": true } },
    "as": "profile"   // context key for children — default: 'item'
  },
  "children": [{ "type": "we-text", "children": ["$profile.username"] }]
}
Renders nothing until a matching record is found. Like $each but for a single result.
query options (entity, params, include, dataset, subscribe) work identically to $query.

Route outlet:
{ "type": "$routes" }
Indicates where nested routes should render within a layout.

Module slot outlet:
{ "type": "$slot", "props": { "anchor": "call-controls" } }
Renders whatever other feature modules have contributed to that anchor, in order. Only meaningful
inside a module's own chrome: the module declares the anchor name in its \`anchors\` list and marks
where contributions land with this. Resolves to nothing when no module has contributed — no empty
container, no gap. Templates have no use for it; chrome is the host's and the modules', not a
template's.
`;
