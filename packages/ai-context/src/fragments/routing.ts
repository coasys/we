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

- The "routes" array MUST be placed on the ROOT template node (or on a route node for nested routing). The router only reads routes from these positions — placing routes on an arbitrary child node means the router will never find them and nothing will render.
- Use "path: '*'" or "path: '/*'" for catch-all/not-found routes.
- Use ":paramName" for dynamic route parameters (e.g. "/space/:spaceId").
- Use nested "routes" arrays for sub-pages and layouts.
- Use { "type": "$routes" } in children to indicate where nested routes should render. The $routes outlet can be deeply nested — only the routes array placement matters.
- EVERY { "type": "$routes" } outlet MUST have a "routes" array defined on the same node or an ancestor node. A $routes outlet without a routes array is invalid and will fail validation.
- NEVER duplicate a route path — every route in the same "routes" array MUST have a unique path.
- When using tabs, each tab's key and navigate path MUST have a matching route. Ensure a 1:1 correspondence between tabs and routes.

### Tabs + Routing

IMPORTANT: we-tabs only manages visual selection — clicking a tab does NOT navigate automatically.
Each we-tab MUST have an onClick with { "$action": "routeStore.navigate" } to trigger route changes.
Bind we-tabs selectedKey to the matching route segment so the active tab stays in sync.
(Alternatively, a single onChange on we-tabs can replace per-tab onClick — see onChange pattern below.)

Recommended pattern — header above tabs (routes on ROOT, $routes outlet nested inside):
{
  "type": "Column",
  "routes": [
    { "path": "/", "type": "we-text", "children": ["Select a tab"] },
    { "path": "/posts", "type": "Column", "children": [{ "type": "we-text", "children": ["Posts content"] }] },
    { "path": "/articles", "type": "Column", "children": [{ "type": "we-text", "children": ["Articles content"] }] }
  ],
  "children": [
    { "type": "Row", "props": { "p": "300", "ax": "between" }, "children": [
      { "type": "we-text", "props": { "variant": "heading-lg" }, "children": ["My App"] }
    ]},
    {
      "type": "we-tabs",
      "props": { "selectedKey": { "$store": "routeStore.segments.0" } },
      "children": [
        { "type": "we-tab", "props": { "key": "posts", "label": "Posts", "onClick": { "$action": "routeStore.navigate", "args": ["/posts"] } } },
        { "type": "we-tab", "props": { "key": "articles", "label": "Articles", "onClick": { "$action": "routeStore.navigate", "args": ["/articles"] } } }
      ]
    },
    { "type": "$routes" }
  ]
}
Note: "routes" is on the root Column, NOT on a child. The $routes outlet is a child — that's fine. Only the routes array placement matters.

WRONG — two common mistakes that produce empty tabs (validator will catch both):
{
  // MISTAKE 1: routes defined on an inner child node, not the root.
  // The router never inspects children for routes arrays — this routes array is invisible.
  "type": "Column",
  "children": [
    { "type": "we-tabs", "children": ["...tabs..."] },
    {
      "type": "Column",
      "routes": [                          // ← WRONG: router never reads this
        { "path": "/posts", "type": "Column", "children": ["..."] }
      ],
      "children": [{ "type": "$routes" }]  // ← outlet here does nothing without a live routes array
    }
  ]
}

{
  // MISTAKE 2: using { type: "$routes" } as a route entry's component type.
  // $routes is an outlet slot marker — as a leaf route entry it has no children injected,
  // so it returns null. Every tab navigates to a route that renders nothing.
  "type": "Column",
  "routes": [
    { "path": "/posts", "type": "$routes" }  // ← WRONG: renders null, use a real component
  ],
  "children": [{ "type": "$routes" }]
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
