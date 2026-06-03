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
| ColorValue | "{hue}-{shade}" where hue = neutral, primary, success, warning, danger and shade = 0, 25, 50, 75, 100, 200–900, 1000. Also "white", "black". (or CSS color) |
| RadiusValue | "0", "100", "200", "300", "400", "500", "600", "700", "800", "900", "pill", "full" (or CSS length) |
| ShadowValue | "sm", "md", "lg", "xl" |
| FontSizeValue | "base", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000" (or CSS length) |
| FontFamilyValue | "base" (or CSS font-family) |
| LineHeightValue | "none", "tight", "snug", "normal", "relaxed", "loose" (or CSS value) |
| LetterSpacingValue | "tighter", "tight", "normal", "wide", "wider", "widest" (or CSS value) |
| FontWeightValue | "100", "200", "300", "400", "500", "600", "700", "800", "900" |

**Layout-only primitives** — these accept only Layout props (not Visual, Flex, Typography, or State):
we-avatar, we-icon, we-iframe, we-image, we-menu-group, we-popover, we-spinner, we-tooltip

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
| top | string | Top offset |
| right | string | Right offset |
| bottom | string | Bottom offset |
| left | string | Left offset |
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
| transition | string | CSS transition |
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
| fontWeight | "100"–"900" \\| "light" \\| "normal" \\| "medium" \\| "bold" \\| "bolder" | Font weight |
| fontSize | "base" \\| "100"–"1000" \\| {css-length} | Font size token |
| lineHeight | "none" \\| "tight" \\| "snug" \\| "normal" \\| "relaxed" \\| "loose" | Line height token |
| letterSpacing | "tighter" \\| "tight" \\| "normal" \\| "wide" \\| "wider" \\| "widest" | Letter spacing token |
| textDecoration | "underline" \\| "line-through" \\| "overline" \\| "none" | Text decoration |
| textTransform | "uppercase" \\| "lowercase" \\| "capitalize" \\| "none" | Text transform |

**Typography defaults:** fontSize and fontWeight have **no built-in defaults** — omitting them inherits from parent elements (browser default is ~16px / normal weight). Do not set fontSize or fontWeight unless you need a non-default value. For example, \`fontSize: '500'\` (16px) and \`fontWeight: '500'\` (normal) are the inherited defaults — omit them.

\`we-text\` variants (set via the \`variant\` prop) bundle typography presets:
body (400), label (300 + medium), footnote (200 + neutral-400), subheading (500 + medium), ingress (500 + lineHeight 1.6), heading-sm (600 + bold), heading (800 + bold), heading-lg (1000 + bold).

### State

| Prop | Type | Description |
|------|------|-------------|
| hoverProps | Partial\\<DesignSystemProps\\> | Styles on :hover |
| activeProps | Partial\\<DesignSystemProps\\> | Styles on :active |
| focusProps | Partial\\<DesignSystemProps\\> | Styles on :focus |
| disabledProps | Partial\\<DesignSystemProps\\> | Styles when disabled |

### Additional

| Prop | Type | Description |
|------|------|-------------|
| styles | Record\\<string, string \\| number\\> | Inline CSS overrides (raw values allowed here) |
| onClick | ActionToken | Event handler (see dynamic logic) |
`;
