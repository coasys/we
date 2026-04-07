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
- children: An array of child nodes (or strings for text). Do not use objects like { "$expr": ... } directly in children; use a prop (e.g. "text") for dynamic content.
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
