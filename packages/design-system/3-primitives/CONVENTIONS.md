# Primitives — Design Conventions

Rules and patterns for building and maintaining `@we/primitives` components.

## Event Naming

Components use **standard DOM event names** and put the new value in the event's `detail` property.

| Event Name | Use For                                   | `detail` Payload |
| ---------- | ----------------------------------------- | ---------------- |
| `change`   | Value committed (blur, selection, toggle) | New value        |
| `input`    | Value updating while typing               | Current value    |
| `focus`    | Element received focus                    | _(none)_         |
| `blur`     | Element lost focus                        | _(none)_         |
| `keydown`  | Key pressed                               | `{ key, code }`  |
| `close`    | Dismissible element closed/dismissed      | _(none)_         |
| `click`    | Element clicked                           | _(contextual)_   |

**Rules:**

1. **Use standard DOM event names** when the semantics match a native event (`change`, `input`, `focus`, `blur`, `click`, `close`, `keydown`, `toggle`).
2. **Internal coordination events** (parent ↔ child within the same component family) use kebab-case descriptive names (e.g. `tab-select` for tab → tabs). These are not part of the public API and never reach the schema system.
3. **Always set `bubbles: true, composed: true`** so events cross shadow DOM boundaries.
4. **Put the new value in `detail`**, not just on `event.target`. This ensures framework wrappers (Solid, React, Vue, etc.) can read values via `event.detail` without direct DOM access.
5. **Prevent internal element events from leaking.** If a component contains a native `<input>` or `<select>`, either stop propagation on its native events or ensure they don't conflict with the component's own dispatched events.

### Framework Interop

Standard event names are critical for framework compatibility. All major frameworks map handler props to DOM event listeners:

| Handler prop | DOM event | Value access   |
| ------------ | --------- | -------------- |
| `onChange`   | `change`  | `event.detail` |
| `onInput`    | `input`   | `event.detail` |
| `onFocus`    | `focus`   | —              |
| `onBlur`     | `blur`    | —              |
| `onClick`    | `click`   | `event.detail` |
| `onClose`    | `close`   | —              |
| `onKeyDown`  | `keydown` | `event.detail` |

```ts
// Dispatch with standard name + detail payload
this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true, composed: true }));
```

## Base Class Selection

| Base Class                      | Layers                                  | Use When                                                                                  |
| ------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DesignSystemElement`           | layout, visual, flex, typography, state | Component needs padding, gap, alignment, hover/focus/disabled states — **default choice** |
| `OverlayElement`                | (extends DSE)                           | Full-viewport backdrop with sized content (modals, drawers)                               |
| `LayoutElement`                 | layout only                             | Truly structural — no visual/interactive styling needed                                   |
| `LayoutTypographyElement`       | layout, typography                      | Text-only, no background/border/padding                                                   |
| `LayoutVisualTypographyElement` | layout, visual, typography              | **Avoid** — prefer `DesignSystemElement` so padding/gap/alignment are available           |

**Rule:** When in doubt, use `DesignSystemElement`. Unused layer keys are harmless (they only apply when set). Choosing a narrow base class to "save" keys leads to CSS escape hatches when requirements grow.

## Variant / Size Pattern

All visual variation should flow through the **JS merge chain**, not CSS attribute selectors.

```ts
const DEFAULT_PROPS: Partial<DesignSystemProps> = { bg: '...', px: '...', ... };

const VARIANT_DEFAULTS: Record<string, Partial<DesignSystemProps>> = {
  primary: { bg: '...', color: '...' },
};

const SIZE_DEFAULTS: Record<string, Partial<DesignSystemProps>> = {
  sm: { px: '...', py: '...', fontSize: '...' },
};
```

The component overrides `getInstanceProps()` with a 4-layer merge:

```
explicit user props  >  variant defaults  >  size defaults  >  component defaults
```

Using `mergeProps()` from `@we/design-utils`, which handles shorthand precedence (`p` vs `px`/`py`, etc.).

### When to use CSS instead

Use CSS only for properties **not covered by DesignSystemProps**:

- Non-DS layout (`position: absolute`, `overflow: hidden`)
- Pseudo-elements (`::before`, `::after`)
- Animations / transitions
- Child element styling (`[part='base'] { all: unset }`)
- Host display override (`--we-{name}-host-display`)

**Never** use `:host([variant='...'])` or `:host([size='...'])` CSS selectors for DS-covered properties (bg, color, padding, fontSize, etc.). Those belong in the JS maps.

## Static `getDefaultProps()`

Every component with non-trivial defaults should define:

```ts
static getDefaultProps() {
  return DEFAULT_PROPS;
}
```

This is read once at class registration to generate the static DS stylesheet (CSS custom property fallbacks).

## Property Declarations

- Use `@property({ reflect: true })` for `variant`, `size`, and any attribute that should appear in the DOM for CSS/testing.
- Do **not** redeclare DS props (`bg`, `color`, `fontSize`, etc.) as `@property` on the class — they're handled by the mixin via `filterProps()`.
- Exception: if a legacy prop (e.g. `weight`) was previously declared and has consumers, migrate consumers to the DS prop name (`fontWeight`) and remove the legacy declaration.

## Naming

- Variant/size type unions live in `types.ts` (e.g. `BadgeVariant`, `ButtonSize`).
- Default props map: `DEFAULT_PROPS`
- Variant map: `VARIANT_DEFAULTS`
- Size map: `SIZE_DEFAULTS`
- CSS block: `styles` or `CSS_STYLES`

## Token Types vs CSS Enums

When adding or referencing types in `DesignSystemProps`:

- **Design scale values** (curated numeric/named scales with a value map) belong in `@we/tokens` — e.g. `FontSizeToken`, `SpaceValue`, `ColorValue`, `FontWeightToken`.
- **CSS keyword enums** (standard CSS value sets with no design-specific scale) stay in `@we/design-types` — e.g. `Display`, `Cursor`, `FlexDirection`, `Position`.

**Rule of thumb:** If there's a value map that generates CSS custom properties, it's a token. If it's just a union of CSS keywords, it's a type.

See [token-type-consolidation plan](../../docs/internal/plans/prs/token-type-consolidation.md) for the full migration plan.

## Migration Checklist

When aligning an existing primitive to this pattern:

1. Switch base class to `DesignSystemElement` (unless overlay).
2. Create `DEFAULT_PROPS`, `VARIANT_DEFAULTS`, `SIZE_DEFAULTS` maps with DS token values.
3. Add `static getDefaultProps()` returning `DEFAULT_PROPS`.
4. Override `getInstanceProps()` with the 4-layer merge chain.
5. Remove manual `:host([variant])` / `:host([size])` CSS selectors for DS-covered properties.
6. Remove manual `@property` declarations for DS props (`bg`, `color`, `weight`, etc.).
7. Remove manual `updated()` handlers that set CSS custom properties for DS-covered props.
8. Update consumers using removed legacy props (e.g. `weight` → `fontWeight`).
9. Keep CSS only for non-DS concerns (host display, child layout, animations).
