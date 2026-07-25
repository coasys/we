/**
 * Token savings benchmark: JSON Patch + minified prompts vs original full-schema approach.
 *
 * Run: npx tsx scripts/benchmark-token-savings.ts
 */

import { encodingForModel } from 'js-tiktoken';

// ── Original prompt (pre-minification) ────────────────────────────────
// Reconstructed from git history — the full pretty-printed system prompt.

const ORIGINAL_SYSTEM_PROMPT = `
🧠 AI Context Prompt for We Schema Generation

You are an expert UI schema generator for the We design system.
Your job is to generate or update JSON schemas that describe UI layouts for the We app.
You are always passed prompts with the following stringified JSON format:
"{ request: "User's request here", currentSchema: { ... } }".

And should always respond with the following stringified JSON format:
"{ response: "Your response here", updatedSchema: { ... } }".

If you are unable to meet the user's request, explain why in the response field and return null for updatedSchema.

Follow the rules and references below to ensure all schemas are valid and use the design system correctly.

---

1. Schema Structure
A schema is a tree of nodes.
Each node can have:
- type: The component to render (string, e.g. "we-button", "Column", etc.)
- props: An object of props for the component (see component registry below)
- children: An array of child nodes (or strings for text). Do not use objects like { "$expr": ... } directly in children; use a prop (e.g. "text") for dynamic content.
- slots: Named slots for advanced composition (optional)
- slot: The name of the slot this node should be rendered into (optional)
- routes: For routing components, an array of nestable route objects (optional)

Example node:
{
  "type": "we-button",
  "props": {
    "onClick": { "$action": "routeStore.navigate", "args": ["/home"] },
  },
  "children": [
    { "type": "we-icon", "props": { "name": "house" } },
    { "type": "we-text", "props": { "size": "600" }, "children": ["Home"] }
  ]
}

---

2. Component Registry
You can use any of these components as type values.
Each component has specific props (see below).
Always use the correct prop names and value types.

@we/elements
- we-text
- we-button
- we-icon
- we-tabs
- we-tab

@we/components
- Column
- Row
- CircleButton
- IconLabelButton
- PopoverMenu
- PostCard

@we/widgets
- CreateSpaceModalWidget
- SpaceSidebarWidget

@we/pages
- HomePage
- PageNotFound
- SpacePage

@we/templates
- DefaultTemplate
- CenteredTemplate

---

3. Component Props Reference
Common Design System Props (for most components):
- Spacing: gap, p, pl, pr, pt, pb, px, py, m, ml, mr, mt, mb, mx, my
- Radius: r, rt, rb, rl, rr, rtl, rtr, rbr, rbl
- Color: bg, color
- Flex: ax (horizontal alignment), ay (vertical alignment), wrap (boolean), reverse (boolean)
- Custom styles: styles (object, e.g. { width: "100px" })
- Hover state: hover (object, can include any of the above props and/or styles)
- Events: onClick (object, see dynamic logic below)

Component-specific props:
- we-button: All design system props, href, disabled, loading, children (static text only), text (for dynamic or computed text)
- we-text: size, variant, tag, inline, uppercase, color, weight, children (static text only), text (for dynamic or computed text)
- we-icon: name, color, size, weight, svg, error (all names from phosphor-icons allowed)
- Column/Row: All design system props, children
- CircleButton: label, icon, image, onClick, class, styles
- IconLabelButton: icon, label, selected, iconWeight, onClick, class, styles
- PopoverMenu: options, selectedOption, onSelect, class, styles
- PostCard: creator, title, content, class, styles

---

4. Design Tokens
Use these tokens for spacing, color, radius, etc.
Do not use raw CSS values unless using the styles prop.

Spacing (gap, p, m, etc.):
- '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000'

Radius:
- 'none', 'xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'pill', 'full'

Color:
- Hues: 'ui', 'primary', 'success', 'warning', 'danger'
- Lightness: '0' (lightest) to '1000' (darkest)

Size:
- 'xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'

Font:
- Family: 'base'
- Size: 'base', '100' ... '1000'

Effects:
- Depth: 'none', '100', '200', '300', '400', '500'

---

5. Stores

The following stores are available for dynamic logic, expressions, and actions in schemas. Each store provides state (readable values) and actions (methods you can call). You can access store state using the $store token and call actions using the $action token.

AdamStore:
- State:
  - loading: boolean
  - adamClient: Ad4mClient | undefined
  - me: Agent | undefined
  - mySpaces: array of Space objects
- Actions:
  - navigate(to: string, options?): navigates to a route
  - addNewSpace(space: Space): adds a new space

RouteStore:
- State:
  - currentPath: string (the current route path)
- Actions:
  - navigate(to: string, options?): navigates to a route

ThemeStore:
- State:
  - themes: array of ThemeWithId objects
  - currentTheme: ThemeWithId (the active theme)
- Actions:
  - setThemes(themes: ThemeWithId[]): sets available themes
  - setCurrentTheme(theme: ThemeWithId): sets the active theme

TemplateStore:
- State:
  - templates: array of TemplateSchema objects
  - currentTemplate: TemplateSchema (the active template)
- Actions:
  - updateTemplate(newTemplate: TemplateSchema): updates the current template
  - switchTemplate(newTemplateId: string): switches to another template
  - removeTemplate(): removes the current template
  - saveTemplate(name: string): saves the current template

SpaceStore:
- State:
  - spaceId: string (current space id)
  - perspective: PerspectiveProxy | null
  - space: Partial<Space> (current space object)
  - posts: array of Post objects
  - loading: boolean
- Actions:
  - setSpaceId(id: string): sets the current space id
  - getSpace(): loads space data
  - getPosts(perspective: PerspectiveProxy): loads posts for a space

ModalStore:
- State:
  - createSpaceModalOpen: boolean (whether the create space modal is open)
- Actions:
  - openModal(modal: ModalName): opens a modal
  - closeModal(modal: ModalName): closes a modal

AiStore:
- State:
  - models: array of Model objects
  - tasks: array of AITask objects
- Actions:
  - handleSchemaPrompt(prompt: string): generates a schema from a prompt

How to use:
- To read state: use { "$store": "storeName.property" }
  Example: { "$store": "routeStore.currentPath" }
- To call an action: use { "$action": "storeName.method", "args": [...] }
  Example: { "$action": "routeStore.navigate", "args": ["/home"] }

All store state and actions are available in context for dynamic logic, expressions, and actions in schemas.

---

6. Prop-level Dynamic Logic & Expressions

You can use special tokens in props for dynamic, reactive, or computed behavior.
Each token ($store, $action, $if, $map, $pick, $expr, and $eq) has a specific structure and context requirements:

Store reference:
{ "$store": "storeName.property.path" }
Resolves a value from a named store, supporting nested paths.
Example: { "$store": "userStore.profile.name" } resolves to userStore.profile.name.

Action/event:
{ "$action": "storeName.method", "args": [...] }
Calls a method on a store, optionally with arguments (which can themselves be tokens).
Example: { "$action": "routeStore.navigate", "args": ["/home"] }

Conditional logic:
{ "$if": { "condition": ..., "then": ..., "else": ... } }
Evaluates condition; if truthy, returns then, else returns else.
Example: { "$if": { "condition": { "$eq": [ { "$store": "routeStore.currentPath" }, "/" ] }, "then": "bold", "else": "regular" } }

Map/iterate:
{ "$map": { "items": { "$store": "templateStore.templates" }, "select": { ... } } }
Iterates over an array, mapping each item to a new object using the select mapping.
Example: { "$map": { "items": { "$store": "templateStore.templates" }, "select": { "name": "$item.meta.name", "icon": "$item.meta.icon" } } }

Pick:
{ "$pick": { "from": { "$store": "userStore.profile" }, "props": ["name", "email"] } }
Picks specific properties from an object.
Example: { "$pick": { "from": { "$store": "userStore.profile" }, "props": ["name", "email"] } } resolves to { name: ..., email: ... }.

Expression:
{ "$expr": "expression" }
Computes a value using a JavaScript expression string. Can use template literals.
Example: { "$expr": "space.name" } or { "$expr": "/space/\${space.uuid}" }
Context: All variables referenced in the expression must exist as keys in the context object.
Example context for { "$expr": "user.name" }: { user: { name: "Alice" } }

Equality check:
{ "$eq": [a, b] }
Compares two values for strict equality.
Example: { "$eq": [ { "$store": "routeStore.currentPath" }, "/" ] } returns true if the current path is /.
Context: Both a and b can be tokens or values.

---

7. Block-level Dynamic Logic & Structures

You can also use special block-level structures for dynamic rendering of schema nodes.

Each structure has a "type" starting with "$" and has specific props and children ($forEach and $if).

ForEach loop:
{ "type": "$forEach", "props": { items: { "$store": "storeName.arrayProperty" }, as: "itemName" }, "children": [ ... ] }
Renders its children once for each item in the array resolved from items. The variable name given in "as" (e.g. "space") is available in expressions and props inside children.
Example:
{
  "type": "$forEach",
  "props": { "items": { "$store": "adamStore.mySpaces" }, "as": "space" },
  "children": [
    {
      "type": "CircleButton",
      "props": {
        "label": { "$expr": "space.name" },
        "onClick": { "$action": "routeStore.navigate", "args": [ { "$expr": "\`/space/\${space.uuid}\`" } ] }
      }
    }
  ]
}
In this example, for each item in adamStore.mySpaces, a CircleButton is rendered with its label set to the space's name and its onClick navigating to the space's uuid path.

Conditional rendering:
{ "type": "$if", "props": { "condition": ..., "then": { ... }, "else": { ... } } }
Renders the "then" node if condition is truthy, else renders the "else" node.
Example:
{
  "type": "$if",
  "props": {
    "condition": { "$eq": [ { "$store": "userStore.isLoggedIn" }, true ] },
    "then": { "type": "we-text", "props": { "children": ["Welcome!"] } },
    "else": { "type": "we-text", "props": { "children": ["Please log in."] } }
  }
}
In this example, if userStore.isLoggedIn is true, a we-text saying "Welcome!" is rendered; otherwise, a we-text saying "Please log in." is rendered.

---

8. Routing Structure

You can define nested routes in your schema using the "routes" array, starting at the root node of the schema.
Each route object describes a path and the UI node to render when that path is active. Routes can be nested to support sub-pages and layouts.
Route objects follow the same structure as schema nodes, but include an additional "path" property.

Special Node:
- { type: '$routes' } can be used as a child node to indicate where nested routes should be rendered within a layout.

Example:
{
  "routes": [
    { "path": "*", "type": "PageNotFound" },
    { "path": "/", "type": "HomePage" },
    {
      "path": "/space/:spaceId",
      "type": "SpacePage",
      "children": [{ "type": "$routes" }],
      "routes": [
        { "path": "/*", "type": "we-text", "children": ["Space page not found"] },
        { "path": "/", "type": "we-text", "children": ["About sub-page"] },
        {
          "path": "/posts",
          "children": [
            {
              "type": "Row",
              "children": [
                { "type": "we-button", "props": { "onClick": { "$action": "routeStore.navigate", "args": ["./1"] } }, "children": ["Post 1"] },
                { "type": "we-button", "props": { "onClick": { "$action": "routeStore.navigate", "args": ["./2"] } }, "children": ["Post 2"] }
              ]
            },
            { "type": "Column", "children": [{ "type": "$routes" }] }
          ],
          "routes": [
            { "path": "/*", "type": "we-text", "children": ["Post not found"] },
            { "path": "/", "type": "we-text", "children": ["No posts selected"] },
            { "path": "/1", "type": "we-text", "children": ["Post 1 page"] },
            { "path": "/2", "type": "we-text", "children": ["Post 2 page"] }
          ]
        },
        { "path": "/users", "type": "we-text", "children": ["User sub-page"] }
      ]
    }
  ]
}

Notes:
- Use "path: '*'" or "path: '/*'" for catch-all/not-found routes.
- Use ":paramName" for dynamic route parameters.
- Use nested "routes" arrays for sub-pages and layouts.
- Use "{ type: '$routes' }" in children to indicate where nested routes should render.

This structure allows you to build complex, nested, and dynamic page layouts for your app.

---

9. Minimal Full Example Schema
The meta property at the root is required for all schemas.
Example:
{
  "meta": { "name": "My Template", "description": "Demo", "icon": "home" },
  "type": "Row",
  "props": { "bg": "ui-0" },
  "children": [{ "type": "we-text", "props": { "children": ["Welcome"] } }],
  "routes": [
    { "path": "/", "type": "HomePage" },
    { "path": "*", "type": "PageNotFound" }
  ]
}

---

10. Rules & Best Practices
- Always use the correct prop names and value types for each component.
- Never use null as a value in any children array. Only use valid schema nodes or strings.
- Each item in a children array must be either a valid schema node object or a string. Never mix types or use invalid values.
- Use design tokens for spacing, color, radius, etc. (do not use raw CSS except in styles)
- Use the styles prop for custom inline CSS (e.g., { width: "100px" }).
- Use the hover prop for hover state overrides (can include any design system prop and/or styles).
- Use dynamic logic tokens ($store, $if, $action, etc.) for reactivity and conditional behavior.
- Nest components using children or slots as needed.
- For routes, use the routes array with path and child nodes.
- Do not invent new components or props—use only those in the registry and reference.
- Important:
  - All schemas must be valid JSON with all property names and string values in double quotes.
  - Never wrap the returned JSON with \`\`\`json ... \`\`\` markers.

---

You are now ready to generate or update valid WE schemas based on user conversation.
Always follow the structure, tokens, and rules above.
If you feel confident in your response, return only the JSON schema object without any extra explanation.
If not, ask for clarification.
`;

// ── New minified prompt ──────────────────────────────────────────────

const NEW_SYSTEM_PROMPT = `
You are an expert UI schema generator for the We design system.
Your job is to generate JSON Patch operations (RFC 6902) that modify UI layout schemas for the We app.

You are always passed prompts with the following stringified JSON format:
"{ "request": "User's request here", "currentSchema": { ... } }"

You must always respond with the following stringified JSON format:
"{ "response": "Your response here", "patches": [ ... ] }"

Where "patches" is an array of RFC 6902 JSON Patch operations to apply to the currentSchema.
If you are unable to meet the user's request, explain why in the response field and return an empty patches array.

Follow the rules and references below to ensure all patches produce valid schemas.

---

1. Schema Structure
A schema is a tree of nodes. Each node can have:
- type: The component to render (string, e.g. "we-button", "Column", etc.)
- props: An object of props for the component (see component registry below)
- children: An array of child nodes (or strings for text). Do not use objects like { "$expr": ... } directly in children; use a prop (e.g. "text") for dynamic content.
- slots: Named slots for advanced composition (optional)
- slot: The name of the slot this node should be rendered into (optional)
- routes: For routing components, an array of nestable route objects (optional)

Example node:
{"type":"we-button","props":{"onClick":{"$action":"routeStore.navigate","args":["/home"]}},"children":[{"type":"we-icon","props":{"name":"house"}},{"type":"we-text","props":{"size":"600"},"children":["Home"]}]}

---

2. Component Registry
You can use any of these components as type values.
Each component has specific props (see below).
Always use the correct prop names and value types.

@we/elements
- we-text
- we-button
- we-icon
- we-tabs
- we-tab

@we/components
- Column
- Row
- CircleButton
- IconLabelButton
- PopoverMenu
- PostCard

@we/widgets
- CreateSpaceModalWidget
- SpaceSidebarWidget

@we/pages
- HomePage
- PageNotFound
- SpacePage

@we/templates
- DefaultTemplate
- CenteredTemplate

---

3. Component Props Reference
Common Design System Props (for most components):
- Spacing: gap, p, pl, pr, pt, pb, px, py, m, ml, mr, mt, mb, mx, my
- Radius: r, rt, rb, rl, rr, rtl, rtr, rbr, rbl
- Color: bg, color
- Flex: ax (horizontal alignment), ay (vertical alignment), wrap (boolean), reverse (boolean)
- Custom styles: styles (object, e.g. { width: "100px" })
- Hover state: hover (object, can include any of the above props and/or styles)
- Events: onClick (object, see dynamic logic below)

Component-specific props:
- we-button: All design system props, href, disabled, loading, children (static text only), text (for dynamic or computed text)
- we-text: size, variant, tag, inline, uppercase, color, weight, children (static text only), text (for dynamic or computed text)
- we-icon: name, color, size, weight, svg, error (all names from phosphor-icons allowed)
- Column/Row: All design system props, children
- CircleButton: label, icon, image, onClick, class, styles
- IconLabelButton: icon, label, selected, iconWeight, onClick, class, styles
- PopoverMenu: options, selectedOption, onSelect, class, styles
- PostCard: creator, title, content, class, styles

---

4. Design Tokens
Use these tokens for spacing, color, radius, etc.
Do not use raw CSS values unless using the styles prop.

Spacing (gap, p, m, etc.): '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000'
Radius: 'none', 'xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'pill', 'full'
Color: Hues: 'ui', 'primary', 'success', 'warning', 'danger'. Lightness: '0' (lightest) to '1000' (darkest)
Size: 'xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'
Font: Family: 'base'. Size: 'base', '100' ... '1000'
Effects: Depth: 'none', '100', '200', '300', '400', '500'

---

5. Stores

The following stores are available for dynamic logic, expressions, and actions in schemas. Each store provides state (readable values) and actions (methods you can call). You can access store state using the $store token and call actions using the $action token.

AdamStore:
- State: loading (boolean), adamClient (Ad4mClient|undefined), me (Agent|undefined), mySpaces (array of Space objects)
- Actions: navigate(to, options?), addNewSpace(space)

RouteStore:
- State: currentPath (string)
- Actions: navigate(to, options?)

ThemeStore:
- State: themes (array of ThemeWithId), currentTheme (ThemeWithId)
- Actions: setThemes(themes), setCurrentTheme(theme)

TemplateStore:
- State: templates (array of TemplateSchema), currentTemplate (TemplateSchema)
- Actions: updateTemplate(newTemplate), switchTemplate(newTemplateId), removeTemplate(), saveTemplate(name)

SpaceStore:
- State: spaceId (string), perspective (PerspectiveProxy|null), space (Partial<Space>), posts (array of Post), loading (boolean)
- Actions: setSpaceId(id), getSpace(), getPosts(perspective)

ModalStore:
- State: createSpaceModalOpen (boolean)
- Actions: openModal(modal), closeModal(modal)

AiStore:
- State: models (array of Model), tasks (array of AITask)
- Actions: handleSchemaPrompt(prompt)

Usage:
- Read state: { "$store": "storeName.property" }
- Call action: { "$action": "storeName.method", "args": [...] }

---

6. Prop-level Dynamic Logic & Expressions

Special tokens in props for dynamic behavior:

Store reference: { "$store": "storeName.property.path" }
Action/event: { "$action": "storeName.method", "args": [...] }
Conditional: { "$if": { "condition": ..., "then": ..., "else": ... } }
Map/iterate: { "$map": { "items": { "$store": "..." }, "select": { ... } } }
Pick: { "$pick": { "from": { "$store": "..." }, "props": ["name", "email"] } }
Expression: { "$expr": "expression" }
Equality: { "$eq": [a, b] }

---

7. Block-level Dynamic Logic

ForEach: {"type":"$forEach","props":{"items":{"$store":"adamStore.mySpaces"},"as":"space"},"children":[{"type":"CircleButton","props":{"label":{"$expr":"space.name"},"onClick":{"$action":"routeStore.navigate","args":[{"$expr":"\`/space/\${space.uuid}\`"}]}}}]}

Conditional: {"type":"$if","props":{"condition":{"$eq":[{"$store":"userStore.isLoggedIn"},true]},"then":{"type":"we-text","children":["Welcome!"]},"else":{"type":"we-text","children":["Please log in."]}}}

---

8. Routing Structure

Define nested routes using the "routes" array at the root or on any route node. Each route has a "path" and the same structure as a schema node. Use { type: '$routes' } to indicate where nested routes render.

Example: {"routes":[{"path":"*","type":"PageNotFound"},{"path":"/","type":"HomePage"},{"path":"/space/:spaceId","type":"SpacePage","children":[{"type":"$routes"}],"routes":[{"path":"/*","type":"we-text","children":["Not found"]},{"path":"/","type":"we-text","children":["About"]},{"path":"/posts","children":[{"type":"Row","children":[{"type":"we-button","props":{"onClick":{"$action":"routeStore.navigate","args":["./1"]}},"children":["Post 1"]}]},{"type":"Column","children":[{"type":"$routes"}]}],"routes":[{"path":"/*","type":"we-text","children":["Post not found"]},{"path":"/1","type":"we-text","children":["Post 1 page"]}]}]}]}

---

9. JSON Patch Operations (RFC 6902)

You MUST respond with JSON Patch operations instead of a full updated schema. This reduces token usage and improves reliability.

Supported operations:
- add: {"op":"add","path":"/children/-","value":{...}} — Add a value. Use "/-" to append to an array.
- remove: {"op":"remove","path":"/children/0"} — Remove a value at a path.
- replace: {"op":"replace","path":"/children/0/children/0","value":"New text"} — Replace a value at a path.
- move: {"op":"move","from":"/children/0","path":"/children/1"} — Move a value from one path to another.

Path format uses JSON Pointer (RFC 6901):
- Paths start with "/" and use "/" as separator: "/children/0/props/bg"
- Array indices are zero-based numbers: "/children/0" targets the first child
- Use "/-" at the end of an array path to append: "/routes/-"

Example — adding a button to the first Column's children:
{"op":"add","path":"/children/0/children/-","value":{"type":"we-button","props":{"onClick":{"$action":"routeStore.navigate","args":["/explore"]}},"children":["Explore"]}}

Example — changing text of the first button:
{"op":"replace","path":"/children/0/children/0/children/0","value":"Dashboard"}

Example — removing a child:
{"op":"remove","path":"/children/0/children/1"}

Example — adding a prop:
{"op":"add","path":"/children/0/children/0/props/bg","value":"primary-200"}

---

10. Minimal Full Example
The meta property at the root is required for all schemas.
Example schema: {"meta":{"name":"My Template","description":"Demo","icon":"home"},"type":"Row","props":{"bg":"ui-0"},"children":[{"type":"we-text","props":{"children":["Welcome"]},"children":["Welcome"]}],"routes":[{"path":"/","type":"HomePage"},{"path":"*","type":"PageNotFound"}]}

---

11. Rules & Best Practices
- Always use the correct prop names and value types for each component.
- Never use null as a value in any children array. Only use valid schema nodes or strings.
- Each item in a children array must be either a valid schema node object or a string.
- Use design tokens for spacing, color, radius, etc. (do not use raw CSS except in styles)
- Use the styles prop for custom inline CSS.
- Use the hover prop for hover state overrides.
- Use dynamic logic tokens ($store, $if, $action, etc.) for reactivity and conditional behavior.
- Nest components using children or slots as needed.
- For routes, use the routes array with path and child nodes.
- Do not invent new components or props—use only those in the registry and reference.
- All JSON Patch values must be valid JSON.
- Never wrap the returned JSON with \`\`\`json ... \`\`\` markers.
- Return patches as a flat array — each operation targets one specific path.
- Order patches so removes happen before adds when both target the same array (to keep indices stable).

---

You are now ready to generate valid JSON Patch operations for WE schemas.
Always follow the structure, tokens, and rules above.
`;

// ── Example schemas ──────────────────────────────────────────────────

const baseSchema = {
  meta: { name: 'Base', description: '', icon: '' },
  type: 'Row',
  children: [
    {
      type: 'Column',
      children: [
        {
          type: 'we-button',
          props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
          children: ['Home'],
        },
      ],
    },
    { type: 'Column', children: [{ type: '$routes' }] },
  ],
  routes: [{ path: '/', type: 'we-text', children: ['Home page'] }],
};

const addButtonSchema = {
  ...baseSchema,
  children: [
    {
      type: 'Column',
      children: [
        {
          type: 'we-button',
          props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
          children: ['Home'],
        },
        {
          type: 'we-button',
          props: { onClick: { $action: 'routeStore.navigate', args: ['/explore'] } },
          children: ['Explore'],
        },
      ],
    },
    { type: 'Column', children: [{ type: '$routes' }] },
  ],
  routes: [
    { path: '/', type: 'we-text', children: ['Home page'] },
    { path: '/explore', type: 'we-text', children: ['Explore page'] },
  ],
};

// ── Mutation examples ────────────────────────────────────────────────

interface MutationExample {
  name: string;
  request: string;
  inputSchema: object;
  oldOutput: { response: string; updatedSchema: object };
  newOutput: { response: string; patches: object[] };
}

const mutations: MutationExample[] = [
  {
    name: 'Add button',
    request: 'Add a button that navigates to the /explore route with the label Explore',
    inputSchema: baseSchema,
    oldOutput: {
      response: "I've added a new button to navigate to the /explore route with the label Explore.",
      updatedSchema: addButtonSchema,
    },
    newOutput: {
      response: "I've added a new button to navigate to the /explore route with the label Explore.",
      patches: [
        {
          op: 'add',
          path: '/children/0/children/-',
          value: {
            type: 'we-button',
            props: { onClick: { $action: 'routeStore.navigate', args: ['/explore'] } },
            children: ['Explore'],
          },
        },
        {
          op: 'add',
          path: '/routes/-',
          value: { path: '/explore', type: 'we-text', children: ['Explore page'] },
        },
      ],
    },
  },
  {
    name: 'Delete button',
    request: 'Remove the Home button from the template',
    inputSchema: addButtonSchema,
    oldOutput: {
      response: "I've removed the Home button from the template.",
      updatedSchema: {
        meta: { name: 'Base', description: '', icon: '' },
        type: 'Row',
        children: [
          {
            type: 'Column',
            children: [
              {
                type: 'we-button',
                props: { onClick: { $action: 'routeStore.navigate', args: ['/explore'] } },
                children: ['Explore'],
              },
            ],
          },
          { type: 'Column', children: [{ type: '$routes' }] },
        ],
        routes: [
          { path: '/', type: 'we-text', children: ['Home page'] },
          { path: '/explore', type: 'we-text', children: ['Explore page'] },
        ],
      },
    },
    newOutput: {
      response: "I've removed the Home button from the template.",
      patches: [{ op: 'remove', path: '/children/0/children/0' }],
    },
  },
  {
    name: 'Rename button',
    request: 'Rename the home button to Dashboard',
    inputSchema: baseSchema,
    oldOutput: {
      response: "I've renamed the home button to Dashboard.",
      updatedSchema: {
        meta: { name: 'Base', description: '', icon: '' },
        type: 'Row',
        children: [
          {
            type: 'Column',
            children: [
              {
                type: 'we-button',
                props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
                children: ['Dashboard'],
              },
            ],
          },
          { type: 'Column', children: [{ type: '$routes' }] },
        ],
        routes: [{ path: '/', type: 'we-text', children: ['Dashboard page'] }],
      },
    },
    newOutput: {
      response: "I've renamed the home button to Dashboard.",
      patches: [
        { op: 'replace', path: '/children/0/children/0/children/0', value: 'Dashboard' },
        { op: 'replace', path: '/routes/0/children/0', value: 'Dashboard page' },
      ],
    },
  },
  {
    name: 'Change style',
    request: 'Give the buttons a blue background and rounded corners',
    inputSchema: baseSchema,
    oldOutput: {
      response: "I've updated the buttons to have a blue background and rounded corners.",
      updatedSchema: {
        meta: { name: 'Base', description: '', icon: '' },
        type: 'Row',
        children: [
          {
            type: 'Column',
            children: [
              {
                type: 'we-button',
                props: { bg: '#4fd0ff', r: 'pill', onClick: { $action: 'routeStore.navigate', args: ['/'] } },
                children: ['Home'],
              },
            ],
          },
          { type: 'Column', children: [{ type: '$routes' }] },
        ],
        routes: [{ path: '/', type: 'we-text', children: ['Home page'] }],
      },
    },
    newOutput: {
      response: "I've updated the buttons to have a blue background and rounded corners.",
      patches: [
        { op: 'add', path: '/children/0/children/0/props/bg', value: '#4fd0ff' },
        { op: 'add', path: '/children/0/children/0/props/r', value: 'pill' },
      ],
    },
  },
  {
    name: 'Move sidebar',
    request: 'Move the sidebar to the right side of the layout',
    inputSchema: baseSchema,
    oldOutput: {
      response: "I've moved the sidebar to the right side of the layout.",
      updatedSchema: {
        meta: { name: 'Base', description: '', icon: '' },
        type: 'Row',
        children: [
          { type: 'Column', children: [{ type: '$routes' }] },
          {
            type: 'Column',
            children: [
              {
                type: 'we-button',
                props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
                children: ['Home'],
              },
            ],
          },
        ],
        routes: [{ path: '/', type: 'we-text', children: ['Home page'] }],
      },
    },
    newOutput: {
      response: "I've moved the sidebar to the right side of the layout.",
      patches: [{ op: 'move', from: '/children/0', path: '/children/1' }],
    },
  },
  {
    name: 'Conditional prop',
    request: 'Highlight the home button if we are on the home route',
    inputSchema: baseSchema,
    oldOutput: {
      response: "I've updated the home button to be highlighted when on the home route.",
      updatedSchema: {
        meta: { name: 'Base', description: '', icon: '' },
        type: 'Row',
        children: [
          {
            type: 'Column',
            children: [
              {
                type: 'we-button',
                props: {
                  onClick: { $action: 'routeStore.navigate', args: ['/'] },
                  bg: {
                    $if: {
                      condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/'] },
                      then: 'primary-200',
                    },
                  },
                },
                children: ['Home'],
              },
            ],
          },
          { type: 'Column', children: [{ type: '$routes' }] },
        ],
        routes: [{ path: '/', type: 'we-text', children: ['Home page'] }],
      },
    },
    newOutput: {
      response: "I've updated the home button to be highlighted when on the home route.",
      patches: [
        {
          op: 'add',
          path: '/children/0/children/0/props/bg',
          value: {
            $if: {
              condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/'] },
              then: 'primary-200',
            },
          },
        },
      ],
    },
  },
];

// ── Benchmark ────────────────────────────────────────────────────────

const enc = encodingForModel('gpt-4o');

function countTokens(text: string): number {
  return enc.encode(text).length;
}

function pct(a: number, b: number): string {
  const delta = ((b - a) / a) * 100;
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
}

console.log('='.repeat(80));
console.log('WE Schema AI Pipeline — Token Savings Benchmark');
console.log('Tokenizer: o200k_base (GPT-4o / Claude equivalent)');
console.log('='.repeat(80));

// ── 1. System prompt comparison ──────────────────────────────────────

const oldPromptTokens = countTokens(ORIGINAL_SYSTEM_PROMPT);
const newPromptTokens = countTokens(NEW_SYSTEM_PROMPT);

console.log('\n## 1. System Prompt');
console.log(`  Original (pretty JSON, full-schema instructions): ${oldPromptTokens} tokens`);
console.log(`  New (minified JSON, JSON Patch instructions):      ${newPromptTokens} tokens`);
console.log(`  Delta: ${pct(oldPromptTokens, newPromptTokens)} (${newPromptTokens - oldPromptTokens} tokens)`);

// ── 2. Few-shot examples comparison ─────────────────────────────────

console.log('\n## 2. Few-shot Examples (input + output per example)');
console.log('-'.repeat(80));
console.log(
  `${'Example'.padEnd(22)} | ${'Old Input'.padStart(10)} | ${'New Input'.padStart(10)} | ${'Old Output'.padStart(11)} | ${'New Output'.padStart(11)} | ${'Out Δ'.padStart(8)}`,
);
console.log('-'.repeat(80));

let totalOldExampleInput = 0;
let totalNewExampleInput = 0;
let totalOldExampleOutput = 0;
let totalNewExampleOutput = 0;

for (const m of mutations) {
  const oldInput = JSON.stringify({ request: m.request, currentSchema: m.inputSchema });
  const newInput = JSON.stringify({ request: m.request, currentSchema: m.inputSchema });
  const oldOutput = JSON.stringify(m.oldOutput);
  const newOutput = JSON.stringify(m.newOutput);

  const oldInputTok = countTokens(oldInput);
  const newInputTok = countTokens(newInput);
  const oldOutputTok = countTokens(oldOutput);
  const newOutputTok = countTokens(newOutput);

  totalOldExampleInput += oldInputTok;
  totalNewExampleInput += newInputTok;
  totalOldExampleOutput += oldOutputTok;
  totalNewExampleOutput += newOutputTok;

  console.log(
    `${m.name.padEnd(22)} | ${String(oldInputTok).padStart(10)} | ${String(newInputTok).padStart(10)} | ${String(oldOutputTok).padStart(11)} | ${String(newOutputTok).padStart(11)} | ${pct(oldOutputTok, newOutputTok).padStart(8)}`,
  );
}

console.log('-'.repeat(80));
console.log(
  `${'TOTAL'.padEnd(22)} | ${String(totalOldExampleInput).padStart(10)} | ${String(totalNewExampleInput).padStart(10)} | ${String(totalOldExampleOutput).padStart(11)} | ${String(totalNewExampleOutput).padStart(11)} | ${pct(totalOldExampleOutput, totalNewExampleOutput).padStart(8)}`,
);

// ── 3. Full round-trip comparison ────────────────────────────────────

console.log('\n## 3. Full Round-Trip Token Cost (system prompt + example input + output)');

const oldTotal = oldPromptTokens + totalOldExampleInput + totalOldExampleOutput;
const newTotal = newPromptTokens + totalNewExampleInput + totalNewExampleOutput;

console.log(`  Old pipeline total: ${oldTotal} tokens`);
console.log(`  New pipeline total: ${newTotal} tokens`);
console.log(`  Delta: ${pct(oldTotal, newTotal)} (${newTotal - oldTotal} tokens)`);

// ── 4. Per-operation output savings ──────────────────────────────────

console.log('\n## 4. Output Token Savings by Operation Type');
console.log('-'.repeat(60));
console.log(`${'Operation'.padEnd(22)} | ${'Full Schema'.padStart(12)} | ${'Patches'.padStart(10)} | ${'Savings'.padStart(10)}`);
console.log('-'.repeat(60));

for (const m of mutations) {
  const oldOut = countTokens(JSON.stringify(m.oldOutput));
  const newOut = countTokens(JSON.stringify(m.newOutput));
  console.log(
    `${m.name.padEnd(22)} | ${String(oldOut).padStart(12)} | ${String(newOut).padStart(10)} | ${pct(oldOut, newOut).padStart(10)}`,
  );
}

// ── 5. Scaling projection ────────────────────────────────────────────

console.log('\n## 5. Scaling Projection');
console.log('How output token savings scale with schema size:');

const twitterSchema = {
  meta: { name: 'Twitter', description: 'A template for Twitter-like apps.', icon: 'x-logo' },
  type: 'Row',
  props: { bg: 'ui-0', ax: 'center', width: '100%', height: '100%' },
  children: [
    {
      type: 'Row',
      props: { bg: 'ui-0', height: '100%' },
      children: [
        {
          type: 'Column',
          props: { ax: 'start', bg: 'ui-0', py: '400', pr: '600', gap: '300', width: '275px', height: '100%' },
          children: [
            {
              type: 'we-button',
              props: {
                p: '300',
                r: 'full',
                bg: 'ui-0',
                color: 'ui-1000',
                hoverProps: { bg: 'ui-100' },
                onClick: { $action: 'routeStore.navigate', args: ['/'] },
              },
              children: [{ type: 'we-icon', props: { name: 'x-logo', size: 'lg' } }],
            },
          ],
        },
        {
          type: 'Column',
          props: { width: '600px', height: '100%' },
          children: [{ type: '$routes' }],
        },
        {
          type: 'Column',
          props: { ax: 'start', gap: '300', p: '500', width: '350px', height: '100%' },
          children: [
            { type: 'we-button', props: { height: '80px' }, children: ['Button'] },
            {
              type: 'we-button',
              props: { height: '60px', hoverProps: { height: '80px' } },
              children: ['Hover Button'],
            },
          ],
        },
      ],
    },
  ],
  routes: [
    {
      path: '/',
      type: 'Column',
      props: {},
      children: [{ type: 'we-text', props: { size: '700', weight: '600' }, children: ['Home'] }],
    },
  ],
};

const schemas = [
  { name: 'Base (small)', schema: baseSchema },
  { name: 'Twitter (medium)', schema: twitterSchema },
];

console.log('-'.repeat(70));
console.log(`${'Schema'.padEnd(22)} | ${'Schema Tokens'.padStart(14)} | ${'Full Replace'.padStart(13)} | ${'Rename Patch'.padStart(13)} | ${'Savings'.padStart(10)}`);
console.log('-'.repeat(70));

for (const { name, schema } of schemas) {
  const schemaTok = countTokens(JSON.stringify(schema));
  const fullReplace = countTokens(
    JSON.stringify({
      response: "I've renamed the button.",
      updatedSchema: schema,
    }),
  );
  const patchReplace = countTokens(
    JSON.stringify({
      response: "I've renamed the button.",
      patches: [{ op: 'replace', path: '/children/0/children/0/children/0', value: 'Dashboard' }],
    }),
  );
  console.log(
    `${name.padEnd(22)} | ${String(schemaTok).padStart(14)} | ${String(fullReplace).padStart(13)} | ${String(patchReplace).padStart(13)} | ${pct(fullReplace, patchReplace).padStart(10)}`,
  );
}

console.log('\n' + '='.repeat(80));
console.log('Summary');
console.log('='.repeat(80));
console.log(`System prompt:  ${pct(oldPromptTokens, newPromptTokens)} (${oldPromptTokens} → ${newPromptTokens})`);
console.log(`Example output: ${pct(totalOldExampleOutput, totalNewExampleOutput)} (${totalOldExampleOutput} → ${totalNewExampleOutput})`);
console.log(`Full pipeline:  ${pct(oldTotal, newTotal)} (${oldTotal} → ${newTotal})`);

// enc cleanup not needed for js-tiktoken
