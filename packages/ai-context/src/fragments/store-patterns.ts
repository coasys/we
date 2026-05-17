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

Eager-loading relations with include (most common relational pattern):
When you need related data displayed alongside a list, use include to hydrate relations in one query.

Example — Channel list with conversation count and latest conversation:
{
  "type": "$each",
  "props": {
    "items": {
      "$query": {
        "model": "Channel",
        "perspective": "spaceStore.perspective",
        "include": {
          "$conversationCount": { "from": "conversations", "count": true },
          "$latestConversation": { "from": "conversations", "order": { "createdAt": "desc" }, "limit": 1 }
        }
      }
    },
    "as": "channel"
  },
  "children": [{
    "type": "Row",
    "children": [
      { "type": "we-text", "children": ["$channel.name"] },
      { "type": "we-text", "children": ["$channel.$conversationCount"] }
    ]
  }]
}

Example — Nested include (Conversations with their messages):
{
  "$query": {
    "model": "Conversation",
    "perspective": "spaceStore.perspective",
    "include": {
      "messages": {
        "order": { "createdAt": "desc" },
        "limit": 20
      }
    }
  }
}
Each conversation in the result has a messages array of hydrated Message instances.
Nesting works to any depth: "include": { "messages": { "include": { "reactions": true } } }

Relational drill-down (master-detail navigation across model relations):
Use routes + $query parent when you navigate to a detail route and need only that record's children.
The relation name must match a HasMany relation listed for that model in the externalModels description.
routeStore.segments.N extracts the Nth dynamic path segment (segments splits currentPath by "/").

Example — Channel list → Conversation list:
{
  "routes": [
    {
      "path": "/",
      "type": "Column",
      "props": { "gap": "300", "p": "400" },
      "children": [{
        "type": "$each",
        "props": {
          "items": { "$query": { "model": "Channel", "perspective": "spaceStore.perspective" } },
          "as": "channel"
        },
        "children": [{
          "type": "we-button",
          "props": {
            "variant": "ghost",
            "onClick": { "$action": "routeStore.navigate", "args": [{ "$concat": ["/channels/", "$channel.id"] }] }
          },
          "children": ["$channel.name"]
        }]
      }]
    },
    {
      "path": "/channels/:channelId",
      "type": "Column",
      "props": { "gap": "300", "p": "400" },
      "children": [{
        "type": "$each",
        "props": {
          "items": {
            "$query": {
              "model": "Conversation",
              "parent": { "id": { "$store": "routeStore.segments.1" }, "relation": "conversations" },
              "perspective": "spaceStore.perspective"
            }
          },
          "as": "convo"
        },
        "children": [{
          "type": "we-text",
          "children": ["$convo.conversationName"]
        }]
      }]
    }
  ]
}
Notes:
- Use include when you need related data displayed inline (e.g. a post with its comments, a channel with its conversation count).
- Use parent when you're on a detail route and want only children belonging to the current record.
- perspective must point to the perspective that holds the data. For external apps (e.g. Flux) opened as a WE space, use "spaceStore.perspective".
- The relation name (in include or parent.relation) is the HasMany field name on the parent model class.

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

Repeating lists with $each:
ALWAYS use $each for lists of similar items — never duplicate the same node structure.
Write the template once; $each renders it for each item.

Use literal arrays for fixed/sample data:
{
  "type": "$each",
  "props": {
    "items": [
      { "title": "First Post", "text": "Hello world.", "author": "Alice" },
      { "title": "Second Post", "text": "Another update.", "author": "Bob" }
    ],
    "as": "post"
  },
  "children": [
    {
      "type": "Column",
      "props": { "bg": "neutral-0", "r": "400", "border": "1px solid neutral-200", "p": "400", "gap": "300" },
      "children": [
        {
          "type": "Row",
          "props": { "gap": "300", "ay": "center" },
          "children": [
            { "type": "we-avatar", "props": { "initials": "$post.author", "size": "sm" } },
            { "type": "we-text", "props": { "variant": "label" }, "children": ["$post.author"] }
          ]
        },
        { "type": "we-text", "props": { "variant": "heading-sm" }, "children": ["$post.title"] },
        { "type": "we-text", "children": ["$post.text"] }
      ]
    }
  ]
}

Use $query or $store for dynamic data (more common in production):
{ "type": "$each", "props": { "items": { "$query": { "model": "TextBlock" } }, "as": "post" }, "children": [...] }
{ "type": "$each", "props": { "items": { "$store": "spaceStore.posts" }, "as": "post" }, "children": [...] }

Per-item customization inside $each:
To style or highlight specific items, add a data flag to those items and use $if on the flag inside the template. Do NOT use $eq: ["$index", N] comparisons — they are fragile, repetitive, and break when items are reordered.
Example: add "highlighted": true to one item's data, then use $if on "$post.highlighted" in the template:
{ "type": "$if", "props": { "condition": "$post.highlighted", "then": { "type": "we-badge", "props": { "variant": "primary" }, "children": ["Featured"] } } }
For conditional props (e.g. different bg on highlighted items):
{ "bg": { "$if": { "condition": "$post.highlighted", "then": "primary-50", "else": "neutral-0" } } }

Boolean toggle (show/hide, expand/collapse):
{
  "type": "Column",
  "$localState": { "showDetails": { "type": "boolean", "initial": false } },
  "children": [
    { "type": "we-button", "props": { "variant": "ghost", "onClick": { "$toggleLocal": "showDetails" } }, "children": ["Toggle Details"] },
    { "type": "$if", "props": { "condition": { "$local": "showDetails" }, "then": { "type": "we-text", "children": ["Details content here"] } } }
  ]
}

Signal types (community-specific reactions/votes):
Signal types are created per-community by the user. Never hardcode signal type UUIDs in schemas.
Instead reference them by slug through spaceStore.signalTypesBySlug.

ALWAYS ask the user: "What slug should I use? (e.g. 'like', 'upvote', 'star')"
Then use that slug in the pattern below.

Pattern — live wired SignalControl (inside a $each over a model with $query include):
{
  "type": "$each",
  "props": {
    "items": {
      "$query": {
        "model": "MyBlock",
        "include": {
          "$totalLikeCount": {
            "from": "signals",
            "where": { "signalTypeId": { "$store": "spaceStore.signalTypesBySlug.like.id" } },
            "count": true
          },
          "$myLikeSignal": {
            "from": "signals",
            "where": {
              "signalTypeId": { "$store": "spaceStore.signalTypesBySlug.like.id" },
              "author": { "$store": "adamStore.me.did" }
            },
            "limit": 1
          }
        }
      }
    },
    "as": "item"
  },
  "children": [
    {
      "type": "$if",
      "props": {
        "condition": { "$store": "spaceStore.signalTypesBySlug.like" },
        "then": {
          "type": "SignalControl",
          "props": {
            "signalType": { "$store": "spaceStore.signalTypesBySlug.like" },
            "myValue": "$item.$myLikeSignal.value",
            "aggregate": "$item.$totalLikeCount",
            "onSignal": {
              "$action": "spaceStore.upsertSignal",
              "args": ["$item.id", { "$store": "spaceStore.signalTypesBySlug.like.id" }, "$arg"]
            }
          }
        }
      }
    }
  ]
}

Notes:
- The $if guard hides SignalControl if the community hasn't created a signal type with that slug.
- Replace "like" with the user's slug throughout (in $store paths and args).
- $query include adds $totalLikeCount and $myLikeSignal as computed properties on each item.
- signalType prop accepts the full SignalType object (provides icon, mode, range to the UI component).

Preview / mockup mode (static, no store wiring):
{
  "type": "SignalControl",
  "props": {
    "preview": true,
    "signalType": { "icon": "❤️", "mode": "toggle", "rangeMin": 0, "rangeMax": 1 }
  }
}
Use preview: true when sketching a layout without real data. Remove it (and add the full wiring above) when going live.
`;
