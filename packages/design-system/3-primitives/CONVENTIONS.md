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
const DEFAULT_PROPS: Partial<DesignSystemProps> = { bg: '...', r: '...', ... };

const VARIANT_DEFAULTS: Record<string, Partial<DesignSystemProps>> = {
  primary: { bg: '...', color: '...' },
};

const SIZE_DEFAULTS: Record<string, Partial<DesignSystemProps>> = {
  sm: { fontSize: '...', height: '...' },
};
```

The component overrides `getInstanceProps()` with a 4-layer merge:

```
explicit user props  >  variant defaults  >  size defaults  >  component defaults
```

Using `mergeProps()` from `@we/design-utils`, which handles shorthand precedence (`p` vs `px`/`py`, etc.).

### Density-cascade properties: keep out of SIZE_DEFAULTS

Properties that participate in the theme density cascade (`px`/`gap` for controls) must **not** live in `SIZE_DEFAULTS` or `DEFAULT_PROPS`. If they did, `updateAllCustomVars` would set the concrete instance var (e.g. `--we-button-padding`) unconditionally, short-circuiting the cascade before `--we-theme-control-padding-x` is ever reached.

Instead, those properties live in **CSS host rules** that set the size-specific CSS custom variable:

```css
:host([size='sm']) {
  --we-button-size-padding-x: var(--we-space-300);
}
:host([size='md']) {
  --we-button-size-padding-x: var(--we-space-400);
}
```

The static DS stylesheet then emits the full fallback chain:

```css
/* x-only padding cascade */
padding: var(
  --we-button-padding,
  /* explicit prop */
  var(
      --we-theme-button-padding-x,
      /* component theme */
      var(--we-theme-control-padding-x, /* group density */ var(--we-button-size-padding-x, var(--we-space-400)))
    )
); /* size default */
```

Components that use this pattern set `nativePadding: true` in `COMPONENT_CASCADE` (helpers.ts) to suppress the generic padding declaration, and add their own custom padding rule in `CSS_STYLES`. Gap follows the same pattern via `gapGroup` in `COMPONENT_CASCADE`.

### When to use CSS instead

The rule is about **selector**, not property name. `DesignSystemElement` adopts a
per-instance generated stylesheet _after_ the component's own `static styles` (see
`applyDSBehavior` in `design-system-element.ts`), and that generated sheet declares
**every** `DesignSystemProps` key covered by the component's layers as
`property: var(--we-{name}-<x>)` — with no fallback in most cases — but only on two
selectors: `:host` and `[part='base']`. Any equal-or-lower-specificity rule for the
same property on one of those two selectors, written earlier in the component's own
`static styles`, is silently overridden back to the CSS-initial value once an instance
renders (`overflow: auto` → `visible`, `position: relative` → `static`, `min-height: 0`
→ `auto`, etc.) — regardless of which property it is. This isn't limited to obviously
"DS-ish" properties like `bg`/`padding`; it includes `position`, `top`/`right`/`bottom`/`left`,
`z-index`, `flex`, `align-self`, `overflow`/`overflowX`/`overflowY`, `scrollbarWidth`,
`scrollbarGutter`, and the full visual/flex/typography layers (see `HOST_LAYOUT` /
`BASE_LAYOUT` / `BASE_VISUAL` / `BASE_FLEX` / `BASE_TYPOGRAPHY` in `helpers.ts` for
the exact lists).

So: **hardcoding a DS-covered property on `:host` or `[part='base']` in a component's
own CSS does not work** — set it via `DEFAULT_PROPS` instead (see below), which routes
through `updateAllCustomVars()` and writes an inline custom property on the host,
outranking any stylesheet. Confirmed broken this way: `we-tooltip`'s
`:host { position: relative }` (not yet fixed — `tooltip.ts` has no `DEFAULT_PROPS`
at all, so its host `position: relative` is currently a no-op; harmless today only
because the tooltip's own positioning uses `position: fixed` promoted to the top
layer, not because the host's `position: relative` is doing anything).
`select.ts` independently worked around the same issue for `[part='base']`'s
`position: relative` by setting it as an inline style directly in `render()`
(`styleMap({ position: 'relative', ... })`) rather than in `static styles` — that
works for the same reason `DEFAULT_PROPS` does (inline style beats any stylesheet).

**`:host`'s own `overflow` is the one property that goes the _other_ way — it is
never DS-covered at all**, even though `overflow` on `[part='base']` is. `HOST_LAYOUT`
in `helpers.ts` (the list the generated stylesheet declares on `:host`) simply doesn't
include `overflow` — it's `[part='base']`-only. This is a real trap for any wrapper
component whose whole job is to clip or scroll its content (`we-scroll-area`, and check
anything similar): setting `overflow: auto` on `[part='base']` alone is not enough. If
`[part='base']` ends up taller than the host's own box — which happens easily, e.g. if
its `height: 100%` doesn't resolve to something smaller than its content — the excess
just visually spills out past the host, fully visible, with no scrollbar anywhere,
_because nothing ever told the host itself to clip or scroll it_. `[part='base']`'s
overflow only matters once `[part='base']` is actually bounded to something smaller
than its content; don't assume that follows automatically from a definite host height.
The fix (see `we-scroll-area`'s `scroll-area.ts`) is to set `overflow: auto` directly
on `:host` in the component's own `static styles` — safe to hardcode, since (unlike
almost every other layout property) `:host`'s overflow is never touched by the
generated stylesheet. When building or debugging a scrollable/clippable wrapper,
verify by giving the host a literal pixel height and confirming content actually clips
— don't assume a "definite height + `overflow:auto` on an inner div" combination works
without checking.

The two selectors above are the _only_ ones the generated stylesheet touches. CSS
targeting any other shadow part (`[part='trigger']`, `[part='arrow']`,
`[part='backdrop']`, `[part='listbox']`, custom classes, pseudo-elements, etc.) is
completely unaffected and safe to hardcode freely — this is how most existing
`position: absolute` usage in this package (tooltip's arrow, modal's backdrop,
select's listbox) already works correctly.

Safe to hardcode in a component's own `static styles` (not DS-covered, or not on
`:host`/`[part='base']`):

- Positioning/layout on any part _other than_ `:host` or `[part='base']`
- Pseudo-elements (`::before`, `::after`)
- Animations / transitions
- Structural resets on inner elements (`[part='base'] { all: unset }` — targets
  properties `all` doesn't include in the generated sheet's explicit list, but verify
  case-by-case)
- Host display override (`--we-{name}-host-display`) — a uniquely-named custom
  property the generated sheet only ever _reads_ via `var()`, never sets itself
- **Size-specific CSS custom properties** for density-cascade vars (see above)

**Never** use `:host([variant='...'])` or `:host([size='...'])` CSS selectors to directly set DS-covered properties (bg, color, padding, fontSize, etc.) — those belong in the JS maps. **Exception:** setting CSS custom properties (e.g. `--we-button-size-padding-x`) via host selectors is fine — that feeds the cascade rather than bypassing it.

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

- Unique variant/size type unions live in `types.ts` (e.g. `ButtonVariant`, `ModalSize`). Shared types (`ComponentSize`, `ComponentVariant`) come from `@we/tokens`.
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
