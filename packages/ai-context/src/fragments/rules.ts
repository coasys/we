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
- Use hoverProps for hover state overrides, activeProps for pressed state, focusProps for focus state. Supported on @we/primitives (we-text, we-button, etc.) and layout components (Column, Row).
- Use dynamic logic tokens ($store, $if, $action, etc.) for reactivity and conditional behavior.
- Nest components using children or slots as needed.
- For routes, use the routes array with path and child nodes.
- Do not invent new components or props — use only those listed in the component registry.
- Do not set props to their default/inherited values — omit them. fontSize and fontWeight inherit from parents (~16px / normal), so only set them when you need a different value.
- Omit empty \`props\` and \`children\` — both are optional. Do not write \`props: {}\` or \`children: []\`.
- Do not use \`as const\` on schema node \`type\` fields — \`SchemaNode.type\` is \`string\`, so it is never needed.
- For icon-only buttons, nest a \`we-icon\` child inside \`we-button\` rather than using a \`text\` prop with a Unicode character. Example: \`{ type: 'we-button', props: { variant: 'ghost', size: 'sm' }, children: [{ type: 'we-icon', props: { name: 'x', size: '20px' } }] }\`.
- For interactive list items and selectable options, use \`we-button\` with variant switching (e.g., \`secondary\` when selected, \`ghost\` when not) instead of manually styling \`Row\` with cursor, bg, and onClick. Buttons provide hover, focus, and active states for free.

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
- Always set \`bg: 'neutral-50'\` on root-level schema nodes (templates, pages). This ensures proper background in all themes — without it, dark mode renders white backgrounds.

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
For a specific file: \`we-validate-schemas packages/app-framework/src/shared/schemas/MyTemplate.schema.ts\`

After creating or modifying a \`.schema.ts\` file, always run validation to catch:
- Unknown component types (typos, missing registry entries)
- Invalid or misspelled props (with "did you mean?" suggestions)
- Prop type mismatches (e.g., number where string expected)
- Missing required \`meta\` field on root TemplateSchema nodes
- \`$routes\` outlet without a \`routes\` array on an ancestor
- Orphan \`$local\` / \`$setLocal\` references without a \`$localState\` ancestor
- DS layer consistency (mixing props from layers the component doesn't support)
`;
