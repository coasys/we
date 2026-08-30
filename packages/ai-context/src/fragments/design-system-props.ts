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
| RadiusValue | "0", "100", "200", "300", "400", "500", "600", "700", "800", "900", "pill", "full" (or CSS length). Also three *semantic* values that follow the theme instead of naming a size: "avatar" (circular by default; anything square that reads as a profile picture), "surface" (rounded like a card by default; a box **inset inside** a sheet — a cover image in a modal, a panel in a card) and "media" (**square** by default; a full-bleed banner, and video or embeds at page width). "surface" and "media" read the same theme group and differ only in that fallback, so pick by whether the box is inset in something rounded or spans the edge. Prefer all three on an \`EditableImage\` or a raw element standing in for one — a pinned "full" or "pill" cannot follow a theme's shape settings. Note "full" is 50%, so it is an ellipse on any box that is not square; reach for "pill" on wide boxes. |
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

Two naming conventions run through the table. A bare noun is a **fill or a foreground in its own
right** (\`surface\`, \`accent\`, \`text\`). \`on<Fill>\` is a foreground that sits **on** a
specific fill and exists to contrast with it (\`on-accent\`, \`on-inverse\`) — so \`accent-text\`
is the accent *used as* text, and \`on-accent\` is the text *placed on* the accent. They are
different colours and the prefix is what tells you which you want.

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
| \`control-surface\` | The filled neutral of a *control* — a slider or switch track, a progress trough, a scrollbar thumb, a secondary button, a count chip. Not a surface and not a state. |
| \`text\` | Primary body and heading text. |
| \`text-muted\` | Secondary text — captions, labels, metadata. |
| \`text-faint\` | Tertiary text — placeholders, disabled labels, decorative icons. |
| \`surface-inverse\` | A surface deliberately opposite to the page — a tooltip. Holds a fixed lightness, so it does *not* flip with the theme. |
| \`on-inverse\` | Text or an icon **on top of** \`surface-inverse\` — a tooltip's own text. **Not** for text on the accent, which is \`on-accent\`. |
| \`border\` | Default borders and dividers. |
| \`border-strong\` | Emphasised separation. |
| \`accent\` | An accent *fill* — a primary button, a selected disc. |
| \`accent-hover\` / \`accent-active\` | Hover and pressed states of an accent fill. |
| \`on-accent\` | Text or an icon **on top of** an accent fill. |
| \`on-accent-muted\` | Secondary text on an accent fill — a caption under a heading on an accent panel, or on \`gradient-primary\`. The \`text-muted\` of fills, and the **only** correct choice there: \`text-muted\` and \`text-faint\` are measured against the *page*, so on a fill they are measured against the wrong thing and can vanish entirely. |
| \`accent-text\` | The accent used **as text** — an accented heading or icon on an ordinary surface, where \`accent\` is often too light to read. |
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
(\`"1px solid border"\`) and behind a ternary
(\`{ "$": "row.selected ? 'accent-muted' : 'surface-sunken'" }\`).

**Not \`$if\` in a prop.** \`$if\` is a *node* type and, in a value position, resolves to a handler —
so the colour resolver is handed a function, paints nothing, and warns about nothing. The validator
does not catch it either. A condition that chooses a value is a ternary, which is what the
expression language has one for.

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
| flexShrink | number \\| string | \`flex-shrink\` alone, for the common "just don't let it shrink" case (\`0\`) without committing to a grow and a basis |
| alignSelf | string | Override parent cross-axis alignment for this child |
| overflow | "hidden" \\| "auto" \\| "overlay" | Overflow behavior, both axes |
| overflowX | "hidden" \\| "auto" \\| "overlay" | Horizontal overflow alone — a nav strip or tab bar that scrolls sideways instead of pushing the page wide |
| overflowY | "hidden" \\| "auto" \\| "overlay" | Vertical overflow alone |
| scrollbarWidth | "auto" \\| "thin" \\| "none" | How much room the scrollbar takes. \`none\` for a strip in fixed-height chrome, where a gutter would not fit |
| scrollbarGutter | "auto" \\| "stable" \\| "stable both-edges" | Reserve the gutter whether or not it scrolls, so content does not shift when a scrollbar appears |
| m | SpaceValue | Margin (all sides) |
| mx | SpaceValue | Margin left + right |
| my | SpaceValue | Margin top + bottom |
| mt | SpaceValue | Margin top |
| mr | SpaceValue | Margin right |
| mb | SpaceValue | Margin bottom |
| ml | SpaceValue | Margin left |

**A row that overflows is a row where nobody said who gives up space.** Inside a \`Row\`, a child's
\`maxWidth\` is not a promise: a flex item's automatic minimum size is its *content*, so an item whose
content cannot narrow — a strip of \`we-button\`s, which set \`white-space: nowrap\` — refuses every
request to compress. Flexbox then takes the whole deficit out of whichever sibling *can* shrink
(usually a run of text, which folds onto two lines) and pushes the rest past the container. Where a
template is mounted in a scrolling box, that reads as the entire page sliding sideways.

Say who does what, and the row cannot overflow:

\`\`\`json
{ "type": "Row", "props": { "ay": "center" }, "children": [
  { "type": "Row", "props": { "flex": "1 1 auto", "minWidth": "0", "overflowX": "auto", "scrollbarWidth": "none" },
    "children": ["…the strip that gives up space and scrolls instead…"] },
  { "type": "Row", "props": { "flex": "0 0 auto" },
    "children": ["…the ornament that never absorbs somebody else's overflow…"] }
]}
\`\`\`

\`minWidth: '0'\` is the half that gets forgotten. Without it \`overflowX\` has nothing to do, because
the item is never asked to be narrower than its content in the first place.

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
| transition | string | CSS transition. Durations may be animation tokens (\`'0'\`–\`'500'\`): \`'width 300 ease-in-out'\`. Prefer the token — a theme's animationSpeed preset overrides those, so \`300\` respects a reduced-motion setting where \`300ms\` overrides it. Use for a property whose *value* changes in place (a width bound to a local); for something appearing and disappearing use \`$if\`/\`$animate\` transitions instead |
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
| whiteSpace | "normal" \\| "nowrap" \\| "pre" \\| "pre-wrap" \\| "pre-line" \\| "break-spaces" | How whitespace and line breaks in the source text are treated |
| overflowWrap | "normal" \\| "break-word" \\| "anywhere" | Where a line may break inside a word too long to fit. **Defaults to \`anywhere\`** — see below |

**Text that cannot break is text that breaks the page.** \`overflowWrap\` defaults to \`anywhere\` on
every typography component and on \`Column\`/\`Row\`/\`Grid\`/\`Card\`, so a URL, a DID, or a transcriber's
run-together output wraps instead of stretching its card off the screen. **Do not set it, and do not
reach for \`styles: { 'word-break': ... }\` — that is the patch this default replaced.**

Set \`overflowWrap: 'normal'\` only to deliberately opt a box *out* of breaking. Note \`'break-word'\` is
the value that looks right and is not: it breaks in the same places as \`anywhere\` but does not
reduce the element's min-content width, and a flex item and a \`1fr\` grid track are both sized by
min-content — so under it the long string still pushes its container wider than the viewport.

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

### Responsive — adapting to the space available

| Prop | Type | Description |
|------|------|-------------|
| smUpProps | Partial\\<DesignSystemProps\\> | Values that take over from 640px up |
| mdUpProps | Partial\\<DesignSystemProps\\> | …from 900px up |
| lgUpProps | Partial\\<DesignSystemProps\\> | …from 1200px up |

A partial prop bag applying above a width, exactly like \`hoverProps\` applies in a state:

\`\`\`json
{ "type": "Column", "props": { "gap": "300", "px": "300", "mdUpProps": { "gap": "500", "px": "400" } } }
\`\`\`

**Measured against the nearest surface, not the window.** A template renders inside a docked panel,
an editor preview pane and a phone, so the viewport is the wrong subject in two of those. The host
declares a surface wherever it mounts a schema tree; a template can declare its own with \`$surface\`
(see Block-level Dynamic Structures) when a pane should adapt to itself rather than to the page.

**Write the narrow value at base and grow.** Every tier is min-width — there is no \`smDownProps\` —
so the unqualified value is what a phone gets and each tier adds room as it appears. Tiers cascade
through: something set only in \`smUpProps\` still applies at \`lg\`.

\`mdUpProps\`, not \`mdProps\`: \`md\` is already a size value on ~15 primitives (\`size="md"\`), and \`Up\`
settles whether a tier means at-this-width or below it. The validator suggests the right spelling.

States and tiers do not cross — there is no \`mdUpHoverProps\`. A tier sets base values at that width;
\`hoverProps\` applies at every width.

### Which mechanism to reach for

Three ways to respond to size, and they are not interchangeable:

| Need | Use | Why |
|---|---|---|
| Different **values** — padding, gap, width, font size | \`*UpProps\` | Pure CSS. Nothing remounts. |
| A different **tree** — a pane becomes a drawer, two panes become one | \`$surface\` + \`$if\` on \`surface.tier\` | Only a branch can swap DOM. |
| Same-shaped things **filling a box** — video tiles, a photo wall | \`Grid\` with \`childAspect\` | Needs both axes and an argmax; CSS cannot express it. |

**Prefer \`*UpProps\` for anything that is a value.** \`$if\` on the tier works and is tempting, because
branching is the familiar tool — but it **unmounts and rebuilds the subtree** every time the surface
crosses a threshold. That loses scroll position, half-typed input, and anything holding a live
resource: it is why a video call laid out that way goes black when its panel is resized. Reserve it
for genuine structural change.

**Prefer intrinsic sizing over either, where it works.** A wrapping \`Row\` whose children have a flex
basis, or a \`Grid\` with \`minChildWidth\`, adapts continuously at every width instead of at three
thresholds, needs no surface, and cannot be got wrong. Reach for a breakpoint when the layout must
genuinely change its mind, not merely stretch.

### Additional

| Prop | Type | Description |
|------|------|-------------|
| styles | Record\\<string, string \\| number\\> | Inline CSS applied directly to the component's own element (raw CSS values allowed). For Column, Row, Grid — use this when you need CSS the DS props don't cover. Applied last, so it genuinely overrides a DS prop setting the same property. **Do not confuse with node-level styles** (see Schema Structure) which applies to a wrapper div, not the component. |
| onClick | ActionToken | Event handler (see dynamic logic) |
`;
