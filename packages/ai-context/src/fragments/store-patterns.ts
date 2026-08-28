/**
 * Store patterns fragment — idiomatic examples of wiring components to stores.
 *
 * Hand-maintained: update when new patterns emerge.
 */
export const storePatterns = `
## Store Usage Patterns

Reading state — an expression naming the store:
{ "$": "storeName.property" }
Example: { "$": "routeStore.currentPath" }

Calling actions:
{ "$action": "storeName.method", "args": [...] }
Example: { "$action": "routeStore.navigate", "args": ["/home"] }

Feature-module stores:
{ "$": "modules.<moduleId>.<key>" } and { "$action": "modules.<moduleId>.<method>" }
Each installed feature module publishes its store under its own id — modules.call.tiles,
modules.notes.open, modules.transcribe.pending. Which ids exist depends on the deployment's seed,
so these are not listed in the Stores section below and are never checked against a known-member
list. A reference to a module that is not installed simply resolves to nothing.

Iterating over store data:
{
  "type": "$each",
  "props": { "items": { "$": "spaceStore.personalSpaces" }, "as": "space" },
  "children": [
    {
      "type": "we-button",
      "props": {
        "variant": "ghost",
        "onClick": { "$action": "routeStore.navigate", "args": [{ "$": "\`/space/\${space.uuid}\`" }] }
      },
      "children": [
        { "type": "we-avatar", "props": { "image": "$space.avatar", "initials": "$space.name", "size": "sm" } },
        { "type": "we-text", "children": ["$space.name"] }
      ]
    }
  ]
}

Conditional rendering from store:
{
  "type": "$if",
  "props": {
    "condition": { "$": "routeStore.currentPath == '/'" },
    "then": { "type": "we-text", "children": ["Home"] },
    "else": { "type": "we-text", "children": ["Not home"] }
  }
}

Deriving options from store:
{ "$": "templateStore.templates.map(t, { name: t.meta.name, icon: t.meta.icon })" }

Querying model data:
{
  "$query": { "entity": "TaskBlock", "where": { "status": "todo" } }
}

Eager-loading relations with include (most common relational pattern):
When you need related data displayed alongside a list, use include to hydrate relations in one query.

Example — Channel list with conversation count and latest conversation:
{
  "type": "$each",
  "props": {
    "items": {
      "$query": {
        "entity": "Channel",
        "dataset": { "$": "currentDataset" },
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
    "entity": "Conversation",
    "dataset": { "$": "currentDataset" },
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

Relational drill-down (master-detail navigation across entity relations):
Use routes + a $query \`scope\` when you navigate to a detail route and need only that record's children.
scope.anchor is the parent entity type; scope.via is its HasMany relation (see externalModels) whose targets
are the query's entity; scope.anchorId is the parent record's id. The adapter resolves the relation to a
backend handle, so no protocol details live in the template.
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
          "items": { "$query": { "entity": "Channel", "dataset": { "$": "currentDataset" } } },
          "as": "channel"
        },
        "children": [{
          "type": "we-button",
          "props": {
            "variant": "ghost",
            "onClick": { "$action": "routeStore.navigate", "args": [{ "$": "\`/channels/\${channel.id}\`" }] }
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
              "entity": "Conversation",
              "scope": { "anchor": "Channel", "via": "conversations", "anchorId": { "$": "routeStore.segments[1]" } },
              "dataset": { "$": "currentDataset" }
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
- Use a scope drill-down when you're on a detail route and want only children belonging to the current record.
- dataset must point to the dataset that holds the data. For external apps (e.g. Flux) opened as a WE space, use { "$": "currentDataset" }.
- The relation name (in include, or scope.via) is the HasMany field name on the parent entity.

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
        "text": "Submit",
        "loading": { "$": "local.loading" },
        "disabled": { "$": "local.loading" },
        "onClick": [
          { "$touch": "$all" },
          { "$if": { "condition": { "$": "formValid()" }, "then": { "$action": "myStore.submit", "args": [{ "$": "local.name" }] } } }
        ]
      }
    }
  ]
}
The button is disabled only while the submit is in flight. Disabling it on { "$": "!formValid()" }
instead contradicts the { "$touch": "$all" } beneath it — the button is unclickable in exactly the state that
guard exists to report. See the "Typical form pattern" section for the full rationale and the two valid shapes.

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
      "props": { "bg": "surface", "r": "400", "border": "1px solid border", "p": "400", "gap": "300" },
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

Use $query or a store read for dynamic data (more common in production):
{ "type": "$each", "props": { "items": { "$query": { "entity": "TextBlock" } }, "as": "post" }, "children": [...] }
{ "type": "$each", "props": { "items": { "$": "spaceStore.posts" }, "as": "post" }, "children": [...] }

Per-item customization inside $each:
To style or highlight specific items, add a data flag to those items and use $if on the flag inside the template. Do NOT use index == N comparisons — they are fragile, repetitive, and break when items are reordered.
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
    { "type": "$if", "props": { "condition": { "$": "local.showDetails" }, "then": { "type": "we-text", "children": ["Details content here"] } } }
  ]
}

Signal types (community-specific reactions/votes):
Signal types are created per-community by the user. Never hardcode signal type UUIDs in schemas.
Resolve them by slug from a hoisted $queries subscription on the node.

There is no store accessor for this. spaceStore.signalTypesBySlug existed once and was removed;
schemas still referencing it filtered on undefined — a like count that silently counted the wrong
thing. Query the SignalType entity instead, and look the slug up with find().

ALWAYS ask the user: "What slug should I use? (e.g. 'like', 'upvote', 'star')"
Then use that slug in the pattern below.

Pattern — live wired SignalControl (one hoisted query, reused by the projection and the control):
{
  "$queries": { "signalTypes": { "entity": "SignalType", "subscribe": true } },
  "type": "Column",
  "children": [
    {
      "type": "$each",
      "props": {
        "items": {
          "$query": {
            "entity": "MyBlock",
            "include": {
              "signals": true,
              "$totalLikeCount": {
                "from": "signals",
                "where": {
                  "signalTypeId": { "$": "find(local.signalTypes, { slug: 'like' }).id" }
                },
                "count": true
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
            "condition": { "$": "count(local.signalTypes)" },
            "then": {
              "type": "$each",
              "props": { "items": { "$": "local.signalTypes" }, "as": "sig" },
              "children": [
                {
                  "type": "SignalControl",
                  "props": {
                    "signalType": { "$": "sig" },
                    "signals": { "$": "filter(item.signals, { signalTypeId: sig.id })" },
                    "myDid": { "$": "me.did" },
                    "onSignal": { "$action": "spaceStore.upsertSignal", "args": [{ "$": "item.id" }, { "$": "sig.id" }, { "$": "arg" }] }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ]
}

Notes:
- $queries and $localState share one local namespace, so { "$": "local.signalTypes" } reads the
  subscription from any descendant — the projection above and the controls below stay in agreement
  about which type a slug means.
- The count() guard renders nothing until the community has created a signal type.
- Iterating signalTypes renders every type the community defined; use find() with a slug only where
  one specific type is meant (e.g. a like count).
- Replace "like" with the user's slug.
- $query include adds $totalLikeCount as a computed property on each item.
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
