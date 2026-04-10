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
- All schemas must be valid JSON with property names and string values in double quotes.
- The meta property at the root is required: { "meta": { "name": "...", "description": "...", "icon": "..." } }

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
