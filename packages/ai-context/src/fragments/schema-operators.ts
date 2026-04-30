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

Boolean logic:
{ "$and": [a, b, ...] } — all truthy
{ "$or": [a, b, ...] } — any truthy
{ "$not": a } — negation

Query (data retrieval):
{ "$query": { "model": "ModelName", "where": { "field": "value" }, "limit": 10, "order": { "field": "asc" } } }
Queries the local perspective for model instances. Always returns an array.
Options: model (required), where, order, limit, offset, include, parent, subscribe (default true).
Use perspectiveStore (e.g. "spaceStore.perspective") to query a different perspective than the default space perspective.

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
Renders children once for each item. The "as" name becomes a context key.

Conditional rendering:
{ "type": "$if", "props": { "condition": ..., "then": { ... }, "else": { ... } } }
Renders "then" node if condition is truthy, else renders "else" node.

Route outlet:
{ "type": "$routes" }
Indicates where nested routes should render within a layout.
`;
