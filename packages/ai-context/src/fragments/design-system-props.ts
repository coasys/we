/**
 * Design System Props fragment — documents the prop groups inherited by all primitives.
 *
 * Hand-maintained: update when DesignSystemProps layers change.
 * Source: packages/design-system/utils/src/index.ts
 */
export const designSystemProps = `
## Design System Props

Most @we/primitives inherit **all** layers below. Props use design token values — not raw CSS.

### Token Value Reference

| Token Type | Valid Values |
|---|---|
| SpaceValue | "0", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000" (or CSS length e.g. "16px") |
| ColorValue | A **role** — see the table below — or a scale position "{hue}-{shade}" where hue = neutral, primary, success, warning, danger and shade = 0, 25, 50, 75, 100, 200–900, 1000. Also "white", "black". (or CSS color). **Prefer a role.** |
| RadiusValue | "0", "100", "200", "300", "400", "500", "600", "700", "800", "900", "pill", "full" (or CSS length). Also two *semantic* values that follow the theme instead of naming a size: "avatar" (circular by default; use for anything square that reads as a profile picture) and "media" (square by default; images, video, embeds). Prefer these on an \`EditableImage\` or a raw element standing in for one — a pinned "full" or "pill" cannot follow a theme's shape settings. Note "full" is 50%, so it is an ellipse on any box that is not square; reach for "pill" on wide boxes. |
| ShadowValue | "sm", "md", "lg", "xl" |
| FontSizeValue | "base", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000" (or CSS length) |
| FontFamilyValue | "base" (or CSS font-family) |
| LineHeightValue | "none", "tight", "snug", "normal", "relaxed", "loose" (or CSS value) |
| LetterSpacingValue | "tighter", "tight", "normal", "wide", "wider", "widest" (or CSS value) |
| FontWeightValue | Named tokens: "regular" (400), "medium" (500), "semibold" (600), "bold" (700). Numeric: "100"–"900". CSS pass-through: "light", "normal", "bolder". |

### Semantic Colour Roles — reach for these before a scale position

A scale position says *which grey*. A role says *what the colour is for*, and that is what a theme
can redesign. Some relationships invert between light and dark — a raised surface gets **lighter**
in dark rather than casting a shadow — and a scale position cannot express that, because the whole
scale flips together. Templates written with roles restyle correctly under any theme; templates
written with \`neutral-100\` are frozen into one theme's idea of what that grey meant.

**Use a role for every \`bg\`, \`color\` and border colour.** Reach for a scale position only when the
colour is a *palette* rather than a meaning — a graph's node colours by category, a chart series,
a user-chosen swatch.

| Role | Use for |
|---|---|
| \`page\` | The app/route background behind everything. Set it on a template's root node. |
| \`surface\` | A card, panel or sheet sitting on the page. |
| \`surface-raised\` | Something floating above the page — a popover, a floating bar, a docked rail with a shadow. |
| \`surface-sunken\` | A well recessed into a surface — an inset box, a code block, an input trough. |
| \`surface-hover\` / \`surface-active\` | Row and item feedback. Use inside \`hoverProps\` / \`activeProps\`. |
| \`text\` | Primary body and heading text. |
| \`text-muted\` | Secondary text — captions, labels, metadata. |
| \`text-faint\` | Tertiary text — placeholders, disabled labels, decorative icons. |
| \`surface-inverse\` | A surface deliberately opposite to the page — a tooltip. Holds a fixed lightness, so it does *not* flip with the theme. |
| \`text-inverse\` | Text on \`surface-inverse\`. **Not** for text on the accent — that is \`accent-text\`. |
| \`border\` | Default borders and dividers. |
| \`border-strong\` | Emphasised separation. |
| \`accent\` | An accent *fill* — a primary button, a selected disc. |
| \`accent-hover\` / \`accent-active\` | Hover and pressed states of an accent fill. |
| \`accent-text\` | Text or an icon **on top of** an accent fill. |
| \`accent-strong\` | An accent-coloured heading or icon **on an ordinary surface**, where \`accent\` is often too light to read. |
| \`accent-muted\` | An accent-tinted fill — a selected row, a subtle highlight. |
| \`focus\` | The focus ring. Rarely set directly; \`--we-ring-color\` already resolves to it. |
| \`danger-text\` / \`success-text\` / \`warning-text\` | Status as a **foreground** — an error message, a warning icon, a "connected" tick. |
| \`danger-surface\` / \`success-surface\` / \`warning-surface\` | The tinted **panel** behind status content. |
| \`overlay\` | The scrim behind a modal or drawer. Carries its own alpha. |
| \`shadow-color\` | The colour shadows are built from. |

\`\`\`json
{ "type": "Column", "props": { "bg": "surface", "border": "1px solid border" }, "children": [
  { "type": "we-text", "props": { "variant": "heading-md", "color": "text" }, "children": ["Title"] },
  { "type": "we-text", "props": { "color": "text-muted" }, "children": ["Supporting line"] }
]}
\`\`\`

Roles work anywhere a colour token does, including inside a border shorthand
(\`"1px solid border"\`) and behind \`$if\` (\`{ "$if": { "condition": …, "then": "accent-muted", "else": "surface-sunken" } }\`).

**Always kebab-case: \`"surface-sunken"\`, never \`"surfaceSunken"\`.** The camelCase spelling is the
TypeScript key of a \`ThemeRole\`; a schema writes the CSS spelling. Getting it wrong fails silently —
the value resolves to a variable that does not exist and the element paints nothing at all — so the
validator rejects it with the right spelling rather than letting it through.

**Layout-only primitives** — these accept only Layout props (not Visual, Flex, Typography, or State):
we-divider, we-icon, we-menu-group, we-popover, we-spinner, we-tooltip

### Layout

| Prop | Type | Description |
|------|------|-------------|
| width | string | Element width |
| height | string | Element height |
| minWidth | string | Minimum width |
| minHeight | string | Minimum height |
| maxWidth | string | Maximum width |
| maxHeight | string | Maximum height |
| position | "relative" \\| "absolute" \\| "fixed" \\| "sticky" | CSS position |
| top | SpaceValue | Top offset — space token or CSS length |
| right | SpaceValue | Right offset — space token or CSS length |
| bottom | SpaceValue | Bottom offset — space token or CSS length |
| left | SpaceValue | Left offset — space token or CSS length |
| zIndex | number | Stack order |
| display | "flex" \\| "block" \\| "inline" \\| "inline-block" \\| "grid" \\| "inline-flex" | Display mode |
| flex | string | Flex shorthand (e.g. "1", "0 0 auto", "none") — controls grow/shrink/basis |
| alignSelf | string | Override parent cross-axis alignment for this child |
| overflow | "hidden" \\| "auto" | Overflow behavior |
| m | SpaceValue | Margin (all sides) |
| mx | SpaceValue | Margin left + right |
| my | SpaceValue | Margin top + bottom |
| mt | SpaceValue | Margin top |
| mr | SpaceValue | Margin right |
| mb | SpaceValue | Margin bottom |
| ml | SpaceValue | Margin left |

### Visual

| Prop | Type | Description |
|------|------|-------------|
| bg | ColorValue | Background color (token) |
| bgImage | string | Background image — a URL, or a CSS gradient (linear-, radial- or conic-gradient, including several comma-separated for a mesh). Sets background-image, defaults background-size to cover, background-position to center, background-repeat to no-repeat. Composes with bg, which paints beneath it |
| bgFit | "cover" \\| "contain" | Background image sizing (default: "cover") — only meaningful with bgImage |
| bgPosition | string | Background image position (default: "center", e.g. "top", "50% 20%") — only meaningful with bgImage |
| bgImageOpacity | number | Fades bgImage only (0–1), independent of the element's own content/opacity — only meaningful with bgImage |
| bgImageTint | ColorValue | Color bgImage fades toward as bgImageOpacity decreases (default: the element's own \`bg\`, or neutral-0) — only meaningful with bgImageOpacity |
| color | ColorValue | Text/foreground color (token) |
| opacity | number | Opacity (0–1) |
| border | string | Border shorthand (e.g. "1px solid neutral-200" — color tokens are resolved) |
| borderColor | ColorValue | Border color (token, e.g. "neutral-200", "primary-500") |
| borderTop | string | Top border shorthand (color tokens resolved) |
| borderRight | string | Right border shorthand (color tokens resolved) |
| borderBottom | string | Bottom border shorthand (color tokens resolved) |
| borderLeft | string | Left border shorthand (color tokens resolved) |
| borderWidth | string | Border width (raw CSS, e.g. "1px", "2px 0") |
| shadow | "sm" \\| "md" \\| "lg" \\| "xl" | Shadow token |
| cursor | "pointer" \\| "default" \\| "text" \\| "not-allowed" | Cursor style |
| pointerEvents | "none" \\| "auto" | Pointer events |
| transform | string | CSS transform |
| transition | string | CSS transition. Durations may be animation tokens (\`'0'\`–\`'500'\`): \`'width 300 ease-in-out'\`. Prefer the token — a theme's animationSpeed preset overrides those, so \`300\` respects a reduced-motion setting where \`300ms\` overrides it. Use for a property whose *value* changes in place (a width bound to \`$local\`); for something appearing and disappearing use \`$if\`/\`$animate\` transitions instead |
| r | RadiusValue | Border radius (all corners) |
| rt | RadiusValue | Border radius top |
| rb | RadiusValue | Border radius bottom |
| rl | RadiusValue | Border radius left |
| rr | RadiusValue | Border radius right |
| rtl | RadiusValue | Border radius top-left |
| rtr | RadiusValue | Border radius top-right |
| rbr | RadiusValue | Border radius bottom-right |
| rbl | RadiusValue | Border radius bottom-left |

### Flex (Container)

| Prop | Type | Description |
|------|------|-------------|
| direction | "row" \\| "row-reverse" \\| "column" \\| "column-reverse" | Flex direction |
| ax | "start" \\| "center" \\| "end" \\| "between" \\| "around" \\| "even" \\| "stretch" | Main-axis alignment |
| ay | "start" \\| "center" \\| "end" \\| "between" \\| "around" \\| "even" \\| "stretch" | Cross-axis alignment |
| wrap | boolean | Enable flex wrap |
| gap | SpaceValue | Gap between children (token) |
| p | SpaceValue | Padding (all sides) |
| px | SpaceValue | Padding left + right |
| py | SpaceValue | Padding top + bottom |
| pt | SpaceValue | Padding top |
| pr | SpaceValue | Padding right |
| pb | SpaceValue | Padding bottom |
| pl | SpaceValue | Padding left |

### Typography

| Prop | Type | Description |
|------|------|-------------|
| textAlign | "left" \\| "center" \\| "right" \\| "justify" | Text alignment |
| fontFamily | "base" \\| {css-font-family} | Font family token |
| fontWeight | "regular" \\| "medium" \\| "semibold" \\| "bold" (named tokens) or "100"–"900" (numeric) or "light" \\| "normal" \\| "bolder" (CSS pass-through) | Font weight |
| fontSize | "base" \\| "100"–"1000" \\| {css-length} | Font size token |
| lineHeight | "none" \\| "tight" \\| "snug" \\| "normal" \\| "relaxed" \\| "loose" | Line height token |
| letterSpacing | "tighter" \\| "tight" \\| "normal" \\| "wide" \\| "wider" \\| "widest" | Letter spacing token |
| textDecoration | "underline" \\| "line-through" \\| "overline" \\| "none" | Text decoration |
| textTransform | "uppercase" \\| "lowercase" \\| "capitalize" \\| "none" | Text transform |

**Typography defaults:** fontSize and fontWeight have **no built-in defaults** — omitting them inherits from parent elements (browser default is ~16px / normal weight). Do not set fontSize or fontWeight unless you need a non-default value. For example, \`fontSize: '300'\` (16px) and \`fontWeight: '500'\` (normal) are the inherited defaults — omit them.

\`we-text\` variants (set via the \`variant\` prop) bundle typography presets. Always pair with a semantic \`tag\` prop for correct HTML structure:
body (300, tag: p/span), label (200 + medium, tag: span), footnote (100, tag: span), subheading (400 + medium, tag: h5/p), ingress (400 + lineHeight 1.6, tag: p), heading-sm (500 + bold, tag: h4), heading-md (600 + bold, tag: h3), heading-lg (700 + bold, tag: h2), heading-xl (800 + bold, tag: h1).
Variants set size and weight only — color is always inherited or set explicitly. For muted footnote text add \`color="neutral-400"\` explicitly.

### State

| Prop | Type | Description |
|------|------|-------------|
| hoverProps | Partial\\<DesignSystemProps\\> | Styles on :hover |
| activeProps | Partial\\<DesignSystemProps\\> | Styles on :active |
| focusProps | Partial\\<DesignSystemProps\\> | Styles on keyboard focus (:focus-visible) — deliberately not applied on mouse click. \`we-button\` and \`we-input\` already carry a default focus ring; only set this to override it |
| disabledProps | Partial\\<DesignSystemProps\\> | Styles when disabled |

### Additional

| Prop | Type | Description |
|------|------|-------------|
| styles | Record\\<string, string \\| number\\> | Inline CSS applied directly to the component's own element (raw CSS values allowed). For Column, Row, Grid — use this when you need CSS the DS props don't cover. Applied last, so it genuinely overrides a DS prop setting the same property. **Do not confuse with node-level styles** (see Schema Structure) which applies to a wrapper div, not the component. |
| onClick | ActionToken | Event handler (see dynamic logic) |
`;
