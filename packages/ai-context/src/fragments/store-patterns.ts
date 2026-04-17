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
  "props": { "items": { "$store": "adamStore.personalSpaces" }, "as": "space" },
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

Local state (form with validation):
{
  "type": "Column",
  "$localState": {
    "name": {
      "type": "string",
      "initial": "",
      "validate": [{ "rule": "required" }, { "rule": "minLength", "value": 2 }]
    },
    "loading": { "type": "boolean", "initial": false }
  },
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
        "text": "Submit",
        "loading": { "$local": "loading" },
        "disabled": { "$not": { "$formValid": "$scope" } },
        "onClick": [
          { "$touch": "$all" },
          { "$if": { "condition": { "$formValid": "$scope" }, "then": { "$action": "myStore.submit", "args": [{ "$local": "name" }] } } }
        ]
      }
    }
  ]
}

Boolean toggle (show/hide, expand/collapse):
{
  "type": "Column",
  "$localState": { "showDetails": { "type": "boolean", "initial": false } },
  "children": [
    { "type": "we-button", "props": { "variant": "ghost", "onClick": { "$toggleLocal": "showDetails" } }, "children": ["Toggle Details"] },
    { "type": "$if", "props": { "condition": { "$local": "showDetails" }, "then": { "type": "we-text", "children": ["Details content here"] } } }
  ]
}
`;
