/**
 * Design System Props fragment — documents the prop groups inherited by all primitives.
 *
 * Hand-maintained: update when DesignSystemProps layers change.
 * Source: packages/design-system/types/src/index.ts
 */
export const designSystemProps = `
## Design System Props

Most @we/primitives inherit **all** layers below. Props use design token values (e.g. "200", "md", "primary") — not raw CSS.

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
| shadow | ShadowValue | Shadow token |
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
| fontFamily | FontFamilyValue | Font family token |
| fontWeight | FontWeightValue \\| "light" \\| "normal" \\| "medium" \\| "bold" \\| "bolder" | Font weight |
| fontSize | FontSizeValue | Font size token |
| lineHeight | LineHeightValue | Line height token |
| letterSpacing | LetterSpacingValue | Letter spacing token |
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
