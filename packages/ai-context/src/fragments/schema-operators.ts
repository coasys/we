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

Set membership:
{ "$in": [value, array] } — true if array contains value (false if second operand is not an array)
Example: { "$in": [{ "$store": "spaceStore.uuid" }, { "$store": "adamStore.systemPerspectiveUuids" }] }
Example: { "$in": ["$item.role", ["admin", "moderator"]] }

Boolean logic:
{ "$and": [a, b, ...] } — all truthy
{ "$or": [a, b, ...] } — any truthy
{ "$not": a } — negation

Query (data retrieval):
{ "$query": { "model": "ModelName", "where": { "field": "value" }, "limit": 10, "order": { "field": "asc" } } }
Queries the local perspective for model instances. Always returns an array.
Options: model (required), where, order, limit, offset, include, parent, perspectiveStore, subscribe.
subscribe defaults to true — reactive live updates. Set subscribe: false to do a one-time fetch.
By default $query targets the current WE space's perspective. Use perspectiveStore to query a different perspective —
required when reading models from an external app (e.g. Flux) that is open as a WE space:
{ "$query": { "model": "Channel", "perspectiveStore": "spaceStore.perspective" } }
spaceStore.perspective resolves to the AD4M Perspective instance of the currently active space.

Eager-loading relations with include (most common relational pattern):
include hydrates related model instances in the same query — no extra fetches needed.
Relation names come from the HasMany relations listed for each model in externalModels.

Simple include — hydrate all related instances:
{ "$query": { "model": "Channel", "include": { "conversations": true } } }
Each item in the result will have a conversations array of hydrated Conversation objects.

Sub-query include — filter, sort, or limit the related records:
{ "$query": { "model": "Channel", "include": { "conversations": { "order": { "createdAt": "desc" }, "limit": 10 } } } }

Nested include — hydrate relations of relations:
{ "$query": { "model": "Channel", "include": { "conversations": { "include": { "messages": true } } } } }
Nesting can go as deep as needed. Each level adds one batched fetch (not N+1).

Count projection — add a derived numeric field:
{ "$query": { "model": "Post", "include": { "$likeCount": { "from": "likes", "count": true } } } }
The $-prefixed key becomes a new field on each result item (e.g. item.$likeCount = 42).

Single-item projection — add a derived field that resolves to one instance or null:
{ "$query": { "model": "Post", "include": { "$myLike": { "from": "likes", "where": { "author": { "$store": "adamStore.me.did" } }, "limit": 1 } } } }
With limit: 1 the field unwraps to T | null instead of an array.

include only works with typed relations — ones where the target model class is known.
For WE models this is always the case. For external models, check the externalModels listing:
relations marked "→ ModelName" are typed (safe for include); relations marked "parent query only"
are untyped and will crash at runtime if used with include — use parent instead.

Relational queries — fetch children by parent id (drill-down navigation):
{ "$query": { "model": "Conversation", "parent": { "id": "$channel.id", "relation": "conversations" } } }
The parent.id is the id of the parent record (typically from a $each context variable or a route segment).
The parent.relation name matches the HasMany relation listed for that model in externalModels.
Use this pattern when navigating to a detail route and loading only that record's children.
For external-app perspectives, always add perspectiveStore: "spaceStore.perspective".

Local state (scoped ephemeral state):
Declare on any node: "$localState": { "name": { "type": "string", "initial": "" } }
Read:  { "$local": "name" } — returns the signal value (reactive).
Write: { "$setLocal": "name", "from": "$event.target.value" } — event handler that updates the signal.
       { "$setLocal": "name", "value": "literal" } — sets to a literal value (string, number, boolean).
Toggle: { "$toggleLocal": "fieldName" } — toggles a boolean field (equivalent to setting it to !current). Use for show/hide, open/close, expand/collapse patterns.
State is created on mount and destroyed on unmount. Nested $localState declarations merge, inner fields shadow outer.
$local values can be used in $action args: { "$action": "store.method", "args": [{ "$local": "name" }] }

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
{ "onClick": [{ "$touch": "$all" }, { "$if": { "condition": { "$formValid": "$scope" }, "then": { "$action": "store.submit" } } }] }
Array entries execute sequentially. Non-function entries (e.g. $if with false condition) are skipped.

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
          { "$if": { "condition": { "$formValid": "$scope" }, "then": { "$action": "store.save", "args": [{ "$local": "name" }] } } }
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

Route outlet:
{ "type": "$routes" }
Indicates where nested routes should render within a layout.
`;
