/**
 * Rules fragment — constraints and best practices for schema generation.
 *
 * Hand-maintained: update when new rules are established.
 */
export const rules = `
## Rules & Best Practices

- Always use the correct prop names and value types for each component.
- Never use null as a value in any children array. Only use valid schema nodes or strings.
- Each item in a children array must be either a valid schema node object or a string.
- Use design tokens for spacing, color, radius, etc. (do not use raw CSS except in styles).
- Use the styles prop for custom inline CSS (e.g., { "width": "100px" }).
- Use hoverProps for hover state overrides, activeProps for pressed state, focusProps for keyboard-focus state. Supported on @we/primitives (we-text, we-button, etc.) and layout components (Column, Row). focusProps fires on \`:focus-visible\` (keyboard), not on mouse click. Do not add a focus ring by hand — \`we-button\` and \`we-input\` already have one, themeable via the \`ringColor\` theme key.
- Use dynamic logic tokens ($store, $if, $action, etc.) for reactivity and conditional behavior.
- Nest components using children or slots as needed.
- For routes, use the routes array with path and child nodes.
- Do not invent new components or props — use only those listed in the component registry.
- Do not set props to their default/inherited values — omit them. fontSize and fontWeight inherit from parents (~16px / normal), so only set them when you need a different value.
- Omit empty \`props\` and \`children\` — both are optional. Do not write \`props: {}\` or \`children: []\`.
- Do not use \`as const\` on schema node \`type\` fields — \`SchemaNode.type\` is \`string\`, so it is never needed.
- For icon-only buttons, nest a \`we-icon\` child inside \`we-button\` rather than using a \`text\` prop with a Unicode character. **Omit the \`size\` prop on \`we-icon\` when nesting inside sized primitives** (\`we-button\`, \`we-input\`, \`we-badge\`, \`we-textarea\`) — these components auto-size nested icons via \`--we-context-icon-size\` (xs→12px, sm→16px, md→24px, lg→32px, xl→40px). Only set an explicit icon \`size\` if you need to override the automatic sizing. Example: \`{ type: 'we-button', props: { variant: 'ghost', size: 'sm' }, children: [{ type: 'we-icon', props: { name: 'x' } }] }\`.
- NEVER pass a bare number like "16" as a size or dimension prop — it is not valid CSS. Always check the component's declared prop type: if it's a string union, use one of the listed values; if it accepts arbitrary strings, include a CSS unit (e.g. "16px", "2rem").
- For interactive list items and selectable options, use \`we-button\` with variant switching (e.g., \`secondary\` when selected, \`ghost\` when not) instead of manually styling \`Row\` with cursor, bg, and onClick. Buttons provide hover, focus, and active states for free.
- To make a block of content clickable **without any button appearance**, use \`we-button\` with \`variant: 'bare'\` — never a \`Column\`/\`Row\` with an \`onClick\`. \`bare\` is the appearance-free variant: no background, no hover, no padding, no radius, inherited colour — but still a real \`<button>\`, so it keeps keyboard activation, the \`disabled\` prop, and the accessibility role that a clickable \`Column\` silently loses. Do not use \`ghost\` for this: ghost's hover background is deliberate, and it paints a rectangle over content that supplies its own affordance. Example: \`{ type: 'we-button', props: { variant: 'bare', disabled: { $store: 'someStore.busy' }, onClick }, children: [{ type: 'Column', props: { gap: '150', ax: 'center' }, children: [...] }] }\`.
- For card-like layouts, compose from \`Column\` with DS props (bg, r, border, p, gap). This gives full control over spacing and appearance.
- When rendering lists of similar items (posts, cards, users, etc.), ALWAYS use \`$each\` with a single template child — never duplicate the same node structure multiple times. Use literal arrays in \`items\` for static data, or \`$store\`/\`$query\` for dynamic data.

### Icon Names (Phosphor Icons)

we-icon uses **Phosphor Icons** (v2.1). Do NOT use Heroicons, Material, or FontAwesome names.
Phosphor names are lowercase-kebab-case. The \`weight\` prop controls style: "regular" (default), "bold", "fill", "light", "thin", "duotone".

Common Phosphor icon names (use these, NOT Heroicons equivalents):
- Navigation: house, arrow-left, arrow-right, caret-left, caret-right, caret-down, caret-up, arrows-clockwise
- Actions: plus, minus, x, check, pencil-simple, trash, copy, download, upload, share, link, magnifying-glass, funnel, sliders-horizontal
- Communication: chat-circle, chat-dots, envelope-simple, paper-plane-tilt, bell, megaphone
- Social: heart, thumbs-up, thumbs-down, star, share-network, users, user, user-plus
- Media: image, camera, play, pause, stop, microphone, speaker-high, video-camera
- Files: file, file-text, folder, folder-open, clipboard-text, note
- UI: list, squares-four, gear, dots-three, dots-three-vertical, warning, info, question, check-circle, x-circle, eye, eye-slash
- Misc: lightning, rocket, globe, map-pin, calendar, clock, tag, bookmark, flag, lock, shield-check

WRONG icon names (Heroicons/Material — do NOT use):
- "chat-bubble-left" → use "chat-circle"
- "chevron-right" → use "caret-right"
- "cog" / "settings" → use "gear"
- "trash-can" → use "trash"
- "magnifying-glass-circle" → use "magnifying-glass"
- "home" → use "house"
- "favorite" → use "heart"
- "delete" → use "trash"
- "search" → use "magnifying-glass"
- "close" → use "x"
- "menu" → use "list"
- All schemas must be valid JSON with property names and string values in double quotes.
- The meta property at the root is required: { "meta": { "name": "...", "description": "...", "icon": "..." } }
- Always set \`bg: 'page'\` on root-level schema nodes (templates, pages). Without a background, dark mode renders white. Use the role, not \`neutral-50\`: the role is what a theme redefines, and a theme that wants a page darker than its cards cannot say so through a scale position.
- Colour every \`bg\`, \`color\` and border with a **semantic role** — \`surface\`, \`text-muted\`, \`border\`, \`accent-text\`, \`danger-text\` — rather than a scale position. See "Semantic Colour Roles" in the Design System Props section for the full table and what each is for. Scale positions are for palettes (a graph's node colours by category, a chart series), not for meanings.
- Use \`we-text\`'s \`loading\` prop for text bound to data that has not arrived — never a hand-authored \`$if\` + \`we-skeleton\` beside it. A separate placeholder needs a height nobody can derive from the schema, and any value you measure drifts the moment a theme changes \`fontScale\` or the type scale. \`we-text\` sizes its own placeholder from the line it would occupy, so it stays right. Set \`loadingWidth\` (default \`'100%'\`) for the one thing the element cannot infer: how wide the absent text would have been.
- An empty \`we-text\` already reserves one line, so text that simply arrives late does not shift the layout even without \`loading\`. Only \`inline\` text still collapses, which is correct for a run inside a sentence.
- Distinguish "not loaded yet" from "loaded and empty" when the difference is visible. A condition like \`{ $store: 'spaceStore.currentSpace.description' }\` is falsy in both cases, so an \`else\` branch saying "No description" asserts it about a space that has not arrived. Test the container first (\`currentSpace\`), then its field.
- Prefer intrinsic sizing to a fixed pixel width. A wrapping \`Row\` whose children carry \`flex: '1'\` and \`minWidth: '0'\`, or a \`Grid\` with \`minChildWidth\`, adapts at every width rather than at three thresholds and cannot overflow a narrow surface. An unconditional \`minWidth: '500px'\` inside a non-wrapping row pushes the whole route sideways on a phone or in a docked panel. Where the layout must genuinely change its mind rather than merely stretch, reach for \`mdUpProps\` — and write the narrow value at base, since every tier is min-width.
- A set of same-shaped things filling a box — video tiles, a photo wall, a board of cards — wants \`Grid\` with \`childAspect: '16 / 9'\`, which solves for the arrangement that makes them largest in the box it is given. \`columns\` is fixed and letterboxes; \`minChildWidth\` uses width alone and gives columns of postage stamps in a tall box.
- Size a template root with \`minHeight\`, never \`height\`. \`height: '100%'\` makes the root exactly as tall as the viewport, so a route with more content than that overflows the *box* — and the root's background stops at the fold while the content keeps scrolling. \`minHeight: '100%'\` fills the viewport when a route is short and grows when it is long, which is what a page background needs. The same applies to \`'100vh'\` — and prefer \`'100dvh'\` to \`'100vh'\` anywhere a full-viewport height is meant: on a phone the address bar makes \`vh\` taller than what is actually visible, so the last rows of the page sit under the browser chrome. Identical on a desktop.

Most @we/primitives inherit all Design System Props documented above (layout, visual, flex, typography, state).
Some layout-only primitives (we-avatar, we-icon, we-image, we-spinner, etc.) only accept Layout props — see the Design System Props section for the full list.

Native HTML elements (lowercase tags render directly without registry entries):
- Layout: div, section, article, aside, main, nav, header, footer
- Text: p, span, h1-h6, pre, code, blockquote
- Lists: ul, ol, li
- Forms: form, input, button, label, select, textarea
- Media: img, video, audio, canvas, figure, figcaption
- Other: a, table, tr, td, th, details, summary, dialog

## Schema Validation

Run \`we-validate-schemas\` (or \`node packages/schema-system/shared/dist/cli/we-validate-schemas.js\`) from the monorepo root to validate all \`.schema.ts\` files.
For a specific file: \`we-validate-schemas packages/app-shell/src/shared/schemas/MyTemplate.schema.ts\`

After creating or modifying a \`.schema.ts\` file, always run validation to catch:
- Unknown component types (typos, missing registry entries)
- Invalid or misspelled props (with "did you mean?" suggestions)
- Prop type mismatches (e.g., number where string expected)
- Missing required \`meta\` field on root TemplateSchema nodes
- \`$routes\` outlet without a \`routes\` array on an ancestor
- Orphan \`$local\` / \`$setLocal\` references without a \`$localState\` ancestor
- DS layer consistency (mixing props from layers the component doesn't support)
`;
