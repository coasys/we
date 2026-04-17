/**
 * Routing fragment — documents route arrays, path syntax, and $routes outlet.
 *
 * Hand-maintained: update when routing capabilities change.
 */
export const routing = `
## Routing Structure

Define nested routes using the "routes" array at the root node of the schema.
Each route object describes a path and the UI node to render when that path is active.
Routes can be nested to support sub-pages and layouts.

Route objects follow the same structure as schema nodes, with an additional "path" property.

- Use "path: '*'" or "path: '/*'" for catch-all/not-found routes.
- Use ":paramName" for dynamic route parameters (e.g. "/space/:spaceId").
- Use nested "routes" arrays for sub-pages and layouts.
- Use { "type": "$routes" } in children to indicate where nested routes should render.
- NEVER duplicate a route path — every route in the same "routes" array MUST have a unique path.
- When using tabs, each tab's key and navigate path MUST have a matching route. Ensure a 1:1 correspondence between tabs and routes.

### Tabs + Routing

IMPORTANT: we-tabs only manages visual selection — clicking a tab does NOT navigate automatically.
Each we-tab MUST have an onClick with { "$action": "routeStore.navigate" } to trigger route changes.
Bind we-tabs selectedKey to the matching route segment so the active tab stays in sync.
(Alternatively, a single onChange on we-tabs can replace per-tab onClick — see onChange pattern below.)

Recommended pattern (per-tab onClick):
{
  "type": "Column",
  "children": [
    {
      "type": "we-tabs",
      "props": { "selectedKey": { "$store": "routeStore.segments.0" } },
      "children": [
        { "type": "we-tab", "props": { "key": "posts", "label": "Posts", "onClick": { "$action": "routeStore.navigate", "args": ["/posts"] } } },
        { "type": "we-tab", "props": { "key": "articles", "label": "Articles", "onClick": { "$action": "routeStore.navigate", "args": ["/articles"] } } }
      ]
    },
    { "type": "$routes" }
  ],
  "routes": [
    { "path": "/", "type": "we-text", "children": ["Select a tab"] },
    { "path": "/posts", "type": "Column", "children": [{ "type": "we-text", "children": ["Posts content"] }] },
    { "path": "/articles", "type": "Column", "children": [{ "type": "we-text", "children": ["Articles content"] }] }
  ]
}

Alternative: single onChange on we-tabs (fires with $event.detail.value = selected key):
{ "onChange": { "$action": "routeStore.navigate", "args": [{ "$concat": ["/", "$arg.detail.value"] }] } }
This replaces all per-tab onClick handlers but requires $concat to build the path.

Nested routing example:
{
  "routes": [
    { "path": "*", "type": "Column", "props": { "ax": "center", "p": "500" }, "children": [{ "type": "we-text", "children": ["Page not found"] }] },
    { "path": "/", "type": "Column", "props": { "ax": "center", "p": "500" }, "children": [{ "type": "we-text", "children": ["Home page"] }] },
    {
      "path": "/space/:spaceId",
      "type": "Row",
      "children": [{ "type": "$routes" }],
      "routes": [
        { "path": "/*", "type": "we-text", "children": ["Space page not found"] },
        { "path": "/", "type": "we-text", "children": ["About sub-page"] },
        { "path": "/posts", "type": "Column", "children": [{ "type": "$routes" }],
          "routes": [
            { "path": "/*", "type": "we-text", "children": ["Post not found"] },
            { "path": "/", "type": "we-text", "children": ["No posts selected"] },
            { "path": "/1", "type": "we-text", "children": ["Post 1 page"] }
          ]
        }
      ]
    }
  ]
}
`;
