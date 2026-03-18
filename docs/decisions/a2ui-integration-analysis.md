# A2UI Integration Analysis

**Date:** March 2026
**Status:** Research / Under Consideration
**Protocol:** [A2UI](https://a2ui.org/) (Agent to UI) — v0.9 Draft, by Google (Apache 2.0)

## What Is A2UI?

A2UI is a protocol for AI agents to send declarative UI descriptions across trust boundaries. Instead of text-only responses or risky code execution, agents send JSON component descriptions that clients render using their own native widgets. Created by Google, with contributions from CopilotKit and the open-source community.

Core concepts:
- **Streaming JSON messages** — `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`
- **Flat adjacency list** — components are a flat list with ID references, not nested trees
- **Catalogs** — JSON Schema files describing available components, functions, and themes
- **Data binding** — JSON Pointer paths (`/user/name`) bind components to a separate data model
- **Catalog negotiation** — client and agent agree on which components are available
- **Transport-agnostic** — works over A2A, AG-UI, MCP, SSE, WebSockets, REST

## Competing Protocols

| Protocol | Owner | What It Is |
|---|---|---|
| **A2UI** | Google | Declarative component format (the payload) |
| **AG-UI** | CopilotKit | Transport protocol (the pipe) — complements A2UI |
| **MCP Apps** | Anthropic/MCP | Pre-built HTML served via `ui://` URIs in sandboxed iframes |
| **ChatKit** | OpenAI | Declarative components, similar to A2UI but locked to OpenAI |

None have won yet. All are <2 years old and still evolving.

## WE vs A2UI: Side-by-Side

### WE Schema Format
```json
{
  "type": "Column",
  "props": { "gap": 300 },
  "children": [
    {
      "type": "we-text",
      "props": { "text": { "$store": "spaceStore.currentSpace.name" } }
    },
    {
      "type": "we-button",
      "props": {
        "label": "Navigate",
        "onClick": { "$action": "routeStore.navigate", "args": ["/explore"] }
      }
    }
  ]
}
```

### A2UI Equivalent (v0.9)
```json
[
  { "version": "v0.9", "createSurface": { "surfaceId": "main", "catalogId": "..." }},
  { "version": "v0.9", "updateComponents": { "surfaceId": "main", "components": [
    { "id": "root", "component": "Column", "children": ["title", "nav_btn"] },
    { "id": "title", "component": "Text", "text": { "path": "/currentSpace/name" } },
    { "id": "nav_btn", "component": "Button", "text": "Navigate",
      "action": { "event": { "name": "navigate", "context": { "path": "/explore" } } } }
  ]}},
  { "version": "v0.9", "updateDataModel": { "surfaceId": "main", "path": "/currentSpace",
    "value": { "name": "My Space" } }}
]
```

### Where WE's Format Is Stronger

| Aspect | Why WE Is Better |
|---|---|
| **Store binding** | `$store: "spaceStore.posts"` directly taps reactive SolidJS stores backed by live AD4M data streams. A2UI's data model is a static JSON blob the agent must manually populate. |
| **Actions** | `$action: "routeStore.navigate"` calls real app methods. A2UI actions are fire-and-forget events sent to the server — no local method dispatch. |
| **Expressions** | `$expr: "item.count > 5"` enables inline computed logic. A2UI needs registered `FunctionCall` objects for everything. |
| **Conditionals** | `$if` is a first-class node type with animated transitions (fade/slide/scale). A2UI has no conditional rendering primitive. |
| **Template editing** | Nested trees are more natural for "edit this template" workflows — agent sees structure, finds a Column, adds a child. A2UI's flat list requires two edits for one logical change (create component + update parent's children array). |

### Where A2UI Has Advantages

| Aspect | Why A2UI Is Better |
|---|---|
| **Streaming** | Components stream as generated. WE currently returns the full tree at once. |
| **Validation** | JSON Schema-based catalog validation with formal error feedback. |
| **LLM flat format** | Flat lists avoid deeply nested JSON — the #1 LLM generation failure mode. |
| **Data separation** | Structure and data cleanly separated. Updating data doesn't touch components. |
| **Interop** | Any A2UI-compatible external agent could generate UI without knowing WE internals. |

## Should A2UI Replace WE's Schema?

**No.** WE's `$store`/`$action`/`$expr`/`$if` tokens are the glue between the UI and AD4M's live decentralized data. A2UI's data model is a static object the agent populates — it has no concept of reactive store binding, local method dispatch, or expression evaluation. Adopting A2UI as WE's schema format would require an adapter for every feature WE already has natively.

## Should WE Adopt A2UI As an Input Protocol (Hybrid)?

**Possible but premature.** The only reason to implement A2UI as a protocol is external agent interop — allowing agents built for other platforms to render rich UI in WE with zero WE-specific knowledge. However:

- The A2UI ecosystem hasn't matured yet (few real agents speak it)
- WE's agents are WE-aware by design — they receive the full schema and edit it directly
- AD4M already handles trust boundaries differently than A2UI's model
- Building an adapter has real present-day maintenance cost for theoretical future benefit

## Recommendation: Improve WE Natively, Revisit A2UI Later

Take A2UI's best ideas and implement them directly in WE's schema system:

### 1. Component Catalog as JSON Schema
Write a machine-readable JSON Schema describing every component in `componentRegistry` — type names, props, accepted children, allowed values. Feed this to agents as context instead of prose examples. Useful regardless of A2UI.

### 2. Accept Flat List Input From Agents
Let agents optionally return a flat adjacency list:
```json
[
  { "id": "root", "type": "Column", "props": { "gap": 300 }, "children": ["title", "btn"] },
  { "id": "title", "type": "we-text", "props": { "text": { "$store": "spaceStore.name" } } },
  { "id": "btn", "type": "we-button", "props": { "label": "Go" } }
]
```
Convert to nested `SchemaNode` tree internally. Reduces LLM bracket-nesting errors significantly.

### 3. Streaming Schema Diffs
Instead of "return the whole tree," let agents stream incremental patches:
```json
{ "add": { "parentId": "sidebar", "index": 2, "node": { "type": "we-button", ... } } }
{ "update": { "id": "title", "props": { "text": "New Title" } } }
{ "remove": { "id": "old-widget" } }
```
Enables progressive rendering for long-running agent tasks.

### 4. Validation Feedback Loop
When an agent returns invalid JSON, send structured errors back and let the agent retry:
```json
{
  "error": "VALIDATION_FAILED",
  "path": "/children/2/props/onClick",
  "message": "Unknown action: 'routeStore.nvigate'. Did you mean 'routeStore.navigate'?"
}
```

## Practical A2UI Use Cases (If We Adopt Later)

If A2UI adoption makes sense in the future, the highest-value scenarios are:

1. **Third-party AI assistants rendering rich responses inside spaces** — external agents return A2UI surfaces (cards, forms, tables) rendered natively with WE's design system
2. **Embedding external agent UIs without iframes** — native rendering with consistent theming instead of cross-origin iframe embeds
3. **Agent-generated forms that write to AD4M** — A2UI forms with WE adapter mapping submissions to AD4M store actions
4. **Multi-agent dashboards** — each agent owns a surface, streaming updates independently
5. **Safe UI from untrusted community/neighbourhood agents** — declarative-only, constrained to WE's approved catalog
6. **Streaming progressive UI** — agent builds interface in real-time as it processes
7. **Cross-platform agent UIs** — same payload renders on web, Electron, Tauri, future mobile
8. **MCP tool UIs** — tools return pre-built A2UI surfaces instead of raw JSON
9. **Collaborative real-time editing** — incremental `updateComponents` messages between users
10. **Dynamic seed templates** — seed specifies an agent endpoint that generates personalized launcher UI

## When to Revisit

Reconsider A2UI adoption when:
- A2UI reaches v1.0 stable
- Real external agents exist that speak A2UI and WE users want to run them
- WE's internal schema improvements are complete and we need an external-facing protocol
- The agentic UI protocol landscape consolidates around a clear winner
