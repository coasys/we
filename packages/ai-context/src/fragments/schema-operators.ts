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
{ "$filter": { "items": <array>, "where": { "field": "value", ... } } }
Filters an array to items where all where conditions match. Mirrors the $query where operator set:

  { "field": "value" }                                   — strict equality
  { "field": { "not": "value" } }                        — inequality; array form excludes multiple values
  { "field": { "contains": "text" } }                    — case-insensitive substring match (strings only)
  { "field": { "exists": true } }                        — non-null / non-undefined presence check
  { "field": { "exists": false } }                       — null or undefined check

Where values (including those inside operator objects) are resolved through the prop system,
so $store, $local, and context refs like { "$local": "searchText" } all work.

$query-only logical combinators (OR / AND / NOT) — NOT supported in $filter, only in $query's where:
  { "OR": [ { "field": "value" }, { "field2": "value2" } ] }   — matches if ANY branch matches
  { "AND": [ { ... }, { ... } ] }                              — matches if ALL branches match (sibling keys at the
                                                                  same level are already implicitly ANDed — use AND
                                                                  to group a set of conditions alongside an OR/NOT)
  { "NOT": { "field": "value" } }                              — matches if the branch does NOT match
Branches are full where-clause objects (can contain multiple fields, and can nest OR/AND/NOT inside each other).
Sibling keys alongside OR/AND/NOT at the same level are implicitly ANDed with it.
Example — case-insensitive search across two fields:
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
Supported types: "string", "boolean", "number", "function", "object".
Read:  { "$local": "name" } — returns the signal value (reactive).
       { "$local": "name.nested.path" } — dot-notation reads into object-typed fields (reactive).
Write: { "$setLocal": "name", "from": "$event.target.value" } — event handler that updates the signal.
       { "$setLocal": "name", "value": "literal" } — sets to a literal value (string, number, boolean, null, object).
       { "$setLocal": "name", "merge": { "field": "$event.detail" } } — shallow-merges fields into an object-typed signal. Values are resolved as event paths (e.g. "$event.detail") or passed as literals. Use for partial updates to object state.
Toggle: { "$toggleLocal": "fieldName" } — toggles a boolean field (equivalent to setting it to !current). Use for show/hide, open/close, expand/collapse patterns.
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
{ "$touch": "fieldName" } — marks a single field as touched (use in onBlur).
{ "$touch": "$all" } — marks all fields in scope as touched (use before submit guard).
{ "$resetLocal": "$scope" } — resets all fields to initial values and clears touched state.

Handler arrays (compose multiple actions on one event):
{ "onClick": [{ "$touch": "$all" }, { "$if": { "condition": { "$formValid": "$scope" }, "then": { "$action": "store.submit", "onSuccess": [{ "$setLocal": "modalOpen", "value": false }] } } }] }
Array entries execute sequentially. Non-function entries (e.g. $if with false condition) are skipped.
Prefer onSuccess over a bare $setLocal before the $action — the bare form closes the modal immediately (losing the loading spinner); onSuccess waits for the Promise to resolve.

Typical form pattern:
{
  "$localState": { "name": { "type": "string", "initial": "", "validate": [{ "rule": "required" }] } },
  "children": [
    {
      "type": "we-form-field",
      "props": { "label": "Name", "error": { "$error": "name" } },
      "children": [{
        "type": "we-input",
        "props": {
          "value": { "$local": "name" },
          "onInput": { "$setLocal": "name", "from": "$event.detail" },
          "onBlur": { "$touch": "name" }
        }
      }]
    },
    {
      "type": "we-button",
      "props": {
        "disabled": { "$not": { "$formValid": "$scope" } },
        "onClick": [
          { "$touch": "$all" },
          { "$if": { "condition": { "$formValid": "$scope" }, "then": { "$action": "store.save", "args": [{ "$local": "name" }], "onSuccess": [{ "$setLocal": "submitDone", "value": true }] } } }
        ]
      },
      "children": ["Submit"]
    }
  ]
}

## Block-level Dynamic Structures

Block-level structures use "type" starting with "$" for dynamic rendering of schema nodes.

Each loop:
{ "type": "$each", "props": { "items": { "$store": "storeName.arrayProperty" }, "as": "itemName" }, "children": [ ... ] }
Renders children once for each item. The "as" name becomes a context key. Defaults to "item" — omit "as" unless you need a different name.

Conditional rendering:
{ "type": "$if", "props": { "condition": ..., "then": { ... }, "else": { ... } } }
Renders "then" node if condition is truthy, else renders "else" node.
Supports enterTransition / exitTransition for CSS animations when the node mounts/unmounts.
TransitionConfig = TransitionEffect | TransitionEffect[]
TransitionEffect = { type: 'fade'|'slide'|'scale'|'pulse', duration?: ms, easing?: string, delay?: ms, direction?: 'left'|'right'|'up'|'down', distance?: string }
fade controls opacity only; slide/scale control transform only. pulse is a persistent looping animation (not a one-shot transition) — starts once entered, stops on exit; direction/distance don't apply (default duration 1200ms, easing 'ease-in-out'). Compose fade/slide/scale together in an array; pulse is typically used alone.
Example: enterTransition: [{ type: 'fade', duration: 300 }, { type: 'slide', direction: 'up', distance: '40px', duration: 400 }]
Example (pulse): enterTransition: { type: 'pulse', duration: 1500 }

Viewport / mount animation (child always in DOM):
{ "type": "$animate", "props": { "scrollReveal"?: true | number, "scrollLeave"?: true | number, "scrollPast"?: string, "enterTransition"?: TransitionConfig, "exitTransition"?: TransitionConfig }, "children": [<node>] }
The child is always mounted. fade/slide/scale are CSS transitions (opacity/transform); pulse is a real CSS @keyframes loop — use this for scroll-reveal effects.
Do NOT use $animate when the child should be absent from the DOM. Use $if for conditional DOM presence.
scrollReveal: true fires enterTransition when the element enters the viewport.
scrollReveal: -100 fires 100px before the element would enter (negative = earlier reveal).
scrollLeave fires exitTransition when the element leaves the viewport.
scrollPast: "element-id" observes a sentinel element (by DOM id) instead of the $animate element itself.
  enterTransition fires when the sentinel leaves the viewport (user scrolled past it).
  exitTransition fires when the sentinel returns (user scrolled back up).
  Use this for sticky headers: place a zero-height sentinel div at the bottom of the non-sticky header section,
  then wrap the mini-profile in $animate with scrollPast pointing to that sentinel's id.
  scrollPast is mutually exclusive with scrollReveal/scrollLeave.
Without any scroll trigger, the enterTransition runs once on mount.
Only one child node is supported.
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
`;
