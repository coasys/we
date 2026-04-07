/**
 * Store patterns fragment — idiomatic examples of wiring components to stores.
 *
 * Hand-maintained: update when new patterns emerge.
 */
export const storePatterns = `
## Store Usage Patterns

Reading state:
{ "$store": "storeName.property" }
Example: { "$store": "routeStore.currentPath" }

Calling actions:
{ "$action": "storeName.method", "args": [...] }
Example: { "$action": "routeStore.navigate", "args": ["/home"] }

Iterating over store data:
{
  "type": "$each",
  "props": { "items": { "$store": "adamStore.mySpaces" }, "as": "space" },
  "children": [
    {
      "type": "CircleButton",
      "props": {
        "label": "$space.name",
        "onClick": { "$action": "routeStore.navigate", "args": [{ "$concat": ["/space/", "$space.uuid"] }] }
      }
    }
  ]
}

Conditional rendering from store:
{
  "type": "$if",
  "props": {
    "condition": { "$eq": [{ "$store": "routeStore.currentPath" }, "/"] },
    "then": { "type": "we-text", "children": ["Home"] },
    "else": { "type": "we-text", "children": ["Not home"] }
  }
}

Deriving options from store:
{
  "$map": {
    "items": { "$store": "templateStore.templates" },
    "select": { "name": "$item.meta.name", "icon": "$item.meta.icon" }
  }
}

Querying model data:
{
  "$query": { "model": "TaskBlock", "where": { "status": "todo" } }
}
`;
