# Primitives: Tiered Architecture Refactor

Refactor `@we/primitives` from its current split (some components extend `DesignSystemElement`, others use bespoke `LitElement` subclasses) to a **tiered mixin architecture** where every component uses the same system but opts into only the prop layers it needs.

## Status

| Phase                                                                | Status      |
| -------------------------------------------------------------------- | ----------- |
| P1 — Define prop layers in `@we/design-utils`                        | Not started |
| P2 — Refactor `DesignSystemMixin` to accept layers                   | Not started |
| P3 — Refactor CSS generation + eliminate dynamic `<style>` injection | Not started |
| P4 — Migrate bespoke components to tiered mixin                      | Not started |
| P5 — Fix stale Storybook stories + old `j-` references               | Not started |
| P6 — Standardize event contract + a11y baseline                      | Not started |
| P7 — Icon bundling + SVG sanitization                                | Not started |
| P8 — Update CEM config + framework declarations                      | Not started |

---

## Problem Statement

### Current state

Components fall into two groups with no shared contract:

| Group    | Components                                                                | Base class            | How styling works                                                          |
| -------- | ------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| DS-aware | button, input, menu-item, tab, tabs, modal                                | `DesignSystemElement` | Full DS prop system (40+ props, state variants, generated CSS)             |
| Bespoke  | text, icon, avatar, badge, spinner, image, menu, popover, tooltip, iframe | `LitElement`          | Manual token resolution in `updated()`, hardcoded host-attribute selectors |

This causes:

- **Two mental models** for consumers — DS-prop components vs custom-API components
- **Duplicated token logic** — `we-text`, `we-badge`, `we-icon` each hand-roll `tokenVar()` calls
- **No layout control** on bespoke components — can't do `<we-icon m="300">` or `<we-text width="200px">`
- **API noise on DS-aware components** — `we-tabs` gets `hoverProps` even though it's not interactive itself
- **Performance overhead** — DS-aware components regenerate full CSS on every `updated()` call regardless of which props changed
- **Mixed CSS architecture** — two competing stylesheet systems (static `css` tag + dynamic `<style>` injection), requiring specificity hacks (`data-we-static-css-ready`, `!important` in `OverlayElement`) and causing brief unstyled flashes
- **`we-input` render structure** — wraps in a plain `<div>` where DS flex/gap props hit the inner `<input part="base">` instead of the layout wrapper; help/error text rely on `position: absolute` as a workaround
- **`we-iframe` security** — `postMessage(data, targetOrigin = '*')` sends messages to any origin; default `allow` grants camera/microphone/display-capture

### Target state

Every component uses the same mixin but declares which **layers** it needs. Five layers, applied additively:

| Layer          | Props included                                                                                                                                                                              | Purpose                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **layout**     | `m`, `mx`, `my`, `mt`, `mr`, `mb`, `ml`, `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `position`, `top`, `right`, `bottom`, `left`, `zIndex`, `display`, `overflow` | Box positioning in parent. Every component gets this.    |
| **visual**     | `bg`, `color`, `opacity`, `border`, `shadow`, `r` (+ radius shorthands), `cursor`, `pointerEvents`, `transform`, `transition`                                                               | Appearance. Most components.                             |
| **flex**       | `direction`, `ax`, `ay`, `wrap`, `gap`, `p` (+ padding shorthands)                                                                                                                          | Container layout. Only components that arrange children. |
| **typography** | `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `textAlign`, `textDecoration`, `textTransform`                                                                                     | Text styling. Only text-bearing components.              |
| **state**      | `hoverProps`, `focusProps`, `activeProps`, `disabledProps`                                                                                                                                  | Interactive state variants. Only interactive components. |

### Component layer assignments

| Component      | layout | visual | flex | typography | state |
| -------------- | ------ | ------ | ---- | ---------- | ----- |
| `we-button`    | x      | x      | x    | x          | x     |
| `we-input`     | x      | x      | x    | x          | x     |
| `we-menu-item` | x      | x      | x    | x          | x     |
| `we-tab`       | x      | x      | x    | x          | x     |
| `we-modal`     | x      | x      | x    | -          | -     |
| `we-tabs`      | x      | x      | x    | -          | -     |
| `we-badge`     | x      | x      | -    | x          | -     |
| `we-text`      | x      | -      | -    | x          | -     |
| `we-avatar`    | x      | x      | -    | -          | -     |
| `we-menu`      | x      | x      | -    | -          | -     |
| `we-popover`   | x      | -      | -    | -          | -     |
| `we-tooltip`   | x      | -      | -    | -          | -     |
| `we-image`     | x      | -      | -    | -          | -     |
| `we-icon`      | x      | -      | -    | -          | -     |
| `we-spinner`   | x      | -      | -    | -          | -     |
| `we-iframe`    | x      | -      | -    | -          | -     |

---

## P1 — Define Prop Layers in `@we/design-utils`

**Goal:** Split `designSystemKeys` into named layer arrays that can be composed.

**Changes:**

`design-utils/src/index.ts`:

```ts
// Layer key arrays
export const layoutKeys = [
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'display',
  'overflow',
  ...marginKeys,
] as const;

export const visualKeys = [
  'bg',
  'color',
  'opacity',
  'border',
  'shadow',
  'cursor',
  'pointerEvents',
  'transform',
  'transition',
  ...radiusKeys,
] as const;

export const flexKeys = ['direction', 'ax', 'ay', 'wrap', 'gap', ...paddingKeys] as const;

export const typographyKeys = [
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textDecoration',
  'textTransform',
] as const;

// stateKeys already exists: ['hoverProps', 'activeProps', 'focusProps', 'disabledProps']

export type DSLayer = 'layout' | 'visual' | 'flex' | 'typography' | 'state';

export const layerKeyMap: Record<DSLayer, readonly string[]> = {
  layout: layoutKeys,
  visual: visualKeys,
  flex: flexKeys,
  typography: typographyKeys,
  state: stateKeys,
};

// Derive combined keys from layers
export function getKeysForLayers(layers: DSLayer[]): string[] {
  const keys = new Set<string>();
  for (const layer of layers) {
    for (const key of layerKeyMap[layer]) keys.add(key);
  }
  return [...keys];
}

// Keep `designSystemKeys` as the union of all layers for backwards compat
export const designSystemKeys = getKeysForLayers(['layout', 'visual', 'flex', 'typography', 'state']);
```

**Validation:** Existing `designSystemKeys` output must not change. Add a test asserting `getKeysForLayers(['layout','visual','flex','typography','state'])` equals the current `designSystemKeys` set.

---

## P2 — Refactor `DesignSystemMixin` to Accept Layers

**Goal:** `DesignSystemMixin(Base, layers)` only registers `@property` for the keys in the selected layers.

**Changes:**

`3-primitives/src/shared/design-system-mixin.ts`:

```ts
import type { DSLayer } from '@we/design-utils';
import { getKeysForLayers, stateKeys } from '@we/design-utils';

const ALL_LAYERS: DSLayer[] = ['layout', 'visual', 'flex', 'typography', 'state'];

export function DesignSystemMixin<T extends Constructor<LitElement>>(
  Base: T,
  layers: DSLayer[] = ALL_LAYERS,
): MixedClass<T> {
  const activeKeys = getKeysForLayers(layers);
  const hasState = layers.includes('state');
  const stateKeySet = new Set<string>(stateKeys);

  const primitiveKeys = activeKeys.filter((key) => !stateKeySet.has(key));

  // Register only active keys as properties
  primitiveKeys.forEach((key) => property({ type: primitiveTypes[key] || String, reflect: true })(Base.prototype, key));

  if (hasState) {
    stateKeys.forEach((key) => property({ type: Object, attribute: false })(Base.prototype, key));
  }

  class DesignSystemMixed extends Base {
    // Expose active layers for CSS generation
    static readonly __dsLayers: DSLayer[] = layers;
    // ...rest stays the same
  }

  return DesignSystemMixed as MixedClass<T>;
}
```

**Consumer usage:**

```ts
class Button extends DesignSystemElement(LitElement, ['layout', 'visual', 'flex', 'typography', 'state']) { ... }
class Text extends DesignSystemElement(LitElement, ['layout', 'typography']) { ... }
class Icon extends DesignSystemElement(LitElement, ['layout']) { ... }
```

**Validation:** Existing DS-aware components should pass through unchanged when using the default (all layers).

---

## P3 — Refactor CSS Generation + Eliminate Dynamic `<style>` Injection

**Goal:** Replace the dual-stylesheet architecture (static `css` tag + dynamic `<style>` element) with a single, clean approach: **static CSS templates that consume CSS custom properties, with JS only setting/removing those custom properties.**

### Current architecture (problematic)

```
static styles = [sharedStyles, componentCSS]     ← static, parsed once
firstUpdated() → inject <style> element           ← dynamic, re-parsed every update
updated() → regenerate full CSS string + set .textContent
```

This causes:

- Browser re-parses the dynamic stylesheet on every prop change
- `data-we-static-css-ready` attribute needed as a specificity gate
- `!important` in `OverlayElement` to win the specificity battle
- Brief flash of unstyled content before dynamic styles apply
- Debugging two competing stylesheets in devtools

### Target architecture

```
static styles = [sharedStyles, dsLayerCSS, componentCSS]   ← all static, parsed once
updated() → set/remove CSS custom properties on host       ← lightweight property updates only
```

**How it works:**

1. `DesignSystemElement` generates a **static** `CSSResult` at class definition time based on the component's declared layers. This CSS uses `var(--we-componentName-prop)` references — it never changes.
2. On `updated()`, JS only calls `el.style.setProperty()` / `el.style.removeProperty()` for the CSS custom properties that actually changed (the `updateCustomVars` logic that already exists in `helpers.ts`).
3. The dynamic `<style>` element, `_dsStyle`, `getDesignSystemCSS()` string builder, `data-we-static-css-ready` attribute, and `!important` overrides are all eliminated.

**Changes:**

`helpers.ts`:

- Convert `hostStyles()`, `baseStyles()`, `hostStateStyles()`, `baseStateStyles()` to return `CSSResult` instead of strings
- New export: `getStaticDSStyles(componentName, layers)` → returns a `CSSResult` that can be spread into `static styles`
- Keep `updateCustomVars()` — it already does the right thing (set/remove CSS custom properties on the host). Just make it layer-aware and add dirty-checking.
- Delete `getDesignSystemCSS()` entirely

`design-system-element.ts`:

- Remove `_dsStyle`, `firstUpdated()` style injection, `data-we-static-css-ready`
- `updated()` only calls `updateCustomVars()` with dirty-checking:

```ts
private _prevDSSnapshot?: string;

updated() {
  const props = this.getInstanceProps();
  const snapshot = JSON.stringify(props);
  if (snapshot === this._prevDSSnapshot) return;
  this._prevDSSnapshot = snapshot;
  updateCustomVars(this, this._componentName, props);
}
```

`overlay-element.ts`:

- Remove the `!important` overrides — no longer needed since there's only one stylesheet source
- Overlay-specific sizing overrides move into static CSS using the same `var()` pattern

**Layer-aware CSS generation:**

Only emit CSS properties for active layers:

```ts
// At class-definition time (runs once)
static styles = [
  sharedStyles,
  getStaticDSStyles('button', ['layout', 'visual', 'flex', 'typography', 'state']),
  componentSpecificCSS,
];
```

A layout-only component like `we-icon` gets a tiny static stylesheet (just host positioning). A fully-featured component like `we-button` gets the full set. But in all cases it's **parsed once** by the browser and never regenerated.

**Validation:** Visual output of all components must be identical before and after. The key test is that no `<style>` elements are injected into shadow roots at runtime.

---

## P4 — Migrate Bespoke Components to Tiered Mixin

Migrate each bespoke component one at a time. For each:

1. Change base class to `DesignSystemElement(LitElement, [layers])`
2. Remove manual `updated()` token resolution code
3. Remove bespoke CSS custom properties that are now handled by the DS layer
4. Keep component-specific properties (e.g., `we-icon.name`, `we-text.tag`) as-is
5. Keep component-specific structural CSS as-is in `static styles`

### Migration order (least risk first):

**P4a — `we-image`** (layout only, simplest)

- Layers: `['layout']`
- Remove manual `this.style.width` / `this.style.height` in `updated()`
- Width/height now handled by layout layer

**P4b — `we-spinner`** (layout only)

- Layers: `['layout']`
- Keep size-based CSS custom properties (`--we-spinner-size`) as component-specific
- Layout layer handles external positioning

**P4c — `we-icon`** (layout only)

- Layers: `['layout']`
- Keep `--icon-size` / `--icon-color` as component-specific (driven by `name`, `size`, `weight`, `color` props)
- Layout layer handles margin/positioning

**P4d — `we-text`** (layout + typography)

- Layers: `['layout', 'typography']`
- Remove manual `style.setProperty('--we-font-size', ...)` in `updated()`
- Typography layer handles `fontSize`, `fontWeight`, `color`, etc.
- Keep `tag`, `variant`, `inline`, `uppercase` as component-specific props

**P4e — `we-avatar`** (layout + visual)

- Layers: `['layout', 'visual']`
- Keep `--we-avatar-size` as component-specific (driven by `size` prop)
- Visual layer handles `bg`, `color`, `border`, `shadow`

**P4f — `we-badge`** (layout + visual + typography)

- Layers: `['layout', 'visual', 'typography']`
- Remove manual `tokenVar('color', this.bg)` in `updated()`
- Visual layer handles `bg`, `color`; typography layer handles `fontSize`, `fontWeight`
- Keep `variant`, `size` as component-specific semantic props

**P4g — `we-menu`** (layout + visual)

- Layers: `['layout', 'visual']`
- Minimal change — add DS layers, keep structural CSS

**P4h — `we-popover` + `we-tooltip`** (layout only)

- Layers: `['layout']`
- Keep floating-ui positioning logic as-is
- Layout layer only handles external box model

**P4i — `we-iframe`** (layout only)

- Layers: `['layout']`
- Remove inline `display: block; width: 100%; height: 100%` in favor of layout layer
- **Security fix:** Change `postMessage(data, targetOrigin = '*')` to require an explicit `targetOrigin` parameter (no default). Consumers must specify the expected origin.
- **Security fix:** Change default `allow` from `'camera; microphone; display-capture'` to `''` (empty). Consumers opt in to permissions explicitly.

**P4j — `we-input`** (fix render structure)

- Currently wraps everything in a plain `<div>` — DS flex/gap props apply to the inner `<input part="base">` instead of the component's layout
- Restructure render to use `<div part="base">` as the outer flex container, with the `<input part="input">` nested inside
- Move help/error text from `position: absolute` hacks to natural document flow within the flex container
- Fix `<j-text>` reference → `<we-text>`

Target structure:

```html
<div part="base">
  ← DS flex/visual props apply here
  <we-text part="label">...</we-text>
  <div part="input-wrapper">
    <slot name="start"></slot>
    <input part="input" /> ← no longer the DS target
    <slot name="end"></slot>
  </div>
  <we-text part="help-text">...</we-text>
  <we-text part="error-text">...</we-text>
</div>
```

### Existing DS-aware components (no migration, just verify):

- `we-button`, `we-input`, `we-menu-item`, `we-tab`, `we-tabs` — already use `DesignSystemElement`
- Update their constructor to pass explicit layers (all 5) for documentation clarity
- `we-modal` — uses `OverlayElement` → update to pass `['layout', 'visual', 'flex']`

---

## P5 — Fix Stale Storybook + Old References

**P5a — Fix story imports**

- Button.stories.tsx imports `./../../src/components/Button` → fix to `../../src/primitives/button`
- Remove references to `variant` and `size` args that don't exist on current `we-button`
- Write stories for other components

**P5b — Fix `j-` prefix references**

- `we-input` render uses `<j-text>` → change to `<we-text>`
- Storybook preview uses `--j-color-ui-100` → change to `--we-color-ui-100`

**P5c — Update theme imports in preview**

- Verify theme CSS files exist at the imported paths
- Ensure theme switching works in Storybook

---

## P6 — Standardize Event Contract + A11y Baseline

**P6a — Event contract**

Establish convention: **custom events for web component consumers, no callback props.**

- Remove `onClick`, `onInput`, `onChange`, `onFocus`, `onBlur`, `onKeyDown` callback properties from all components
- All interaction dispatches named `CustomEvent`s with consistent naming: `we-click`, `we-input`, `we-change`, `we-focus`, `we-blur`
- Don't `stopPropagation()` on native events — let them bubble naturally
- Document the event contract in the package README

**P6b — A11y baseline**

| Component      | Required fixes                                                      |
| -------------- | ------------------------------------------------------------------- |
| `we-button`    | Add `role="button"` to `<a>` variant                                |
| `we-modal`     | Add `role="dialog"`, `aria-modal="true"`, implement focus trap      |
| `we-tooltip`   | Add `aria-describedby` linking trigger to tooltip, `role="tooltip"` |
| `we-popover`   | Add Escape key to close, `aria-expanded` on trigger                 |
| `we-menu`      | Add keyboard navigation (arrow keys, Home/End)                      |
| `we-menu-item` | Add keyboard activation (Enter/Space)                               |
| `we-input`     | Associate label via `aria-labelledby` or `<label for>`              |

---

## P7 — Icon Bundling + SVG Sanitization

**Current problem:** `we-icon` fetches SVGs from `cdn.jsdelivr.net` at runtime — no offline support, no caching, XSS surface via `unsafeHTML()`.

**P7a — Add in-memory icon cache**

- Module-level `Map<string, string>` keyed by `${weight}/${name}`
- Check cache before fetch, store response on success
- 10 identical `<we-icon name="check">` = 1 fetch

**P7b — SVG sanitization**

- Sanitize fetched SVG before rendering (strip `<script>`, event handlers, `<foreignObject>`, data URIs)
- Replace `unsafeHTML(this.svg)` with sanitized rendering

**P7c — Support bundled icons (future)**

- Allow a `setIconResolver()` API so consuming apps can provide bundled SVG imports
- Fall back to CDN fetch only if no resolver is registered
- Document both approaches

---

## P8 — Update CEM Config + Framework Declarations

**P8a — CEM plugin**

- Update `custom-elements-manifest.config.mjs` to detect `DesignSystemElement(LitElement, [...layers])` pattern
- Inject only the DS props matching the component's declared layers
- Currently only checks `superclass.name === 'DesignSystemElement'` — needs updating since all components now use the mixin

**P8b — Framework declarations**

- `generate-framework-declarations.ts` should produce correct types per component
- Verify React/Solid/Svelte type exports include only the relevant DS props per component

---

## Implementation Order

```
P1 (define layers) → P2 (mixin refactor) → P3 (CSS generation)
    ↓
P4a-P4i (migrate components, one at a time)
    ↓
P4j (we-input restructure) — after P3, pairs well with P5b (j-text fix)
P5 (storybook fixes) — can start in parallel after P4a
P6 (events + a11y) — can start in parallel after P4
P7 (icons) — independent, can start anytime
P8 (CEM + declarations) — after P4 is complete
```

P1–P3 are the foundation. P4 is the bulk of the work but each sub-task is independent and low-risk. P5–P8 are cleanup that can be parallelized.

---

## Risks

| Risk                                                                | Mitigation                                                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Breaking existing consumers that use DS props on current components | P2 defaults to all layers — existing components don't change until explicitly migrated                                                      |
| CSS specificity changes after refactor                              | Visual regression testing via Storybook before/after screenshots                                                                            |
| `designSystemKeys` change breaking `@we/design-types` consumers     | P1 preserves the existing array as a computed union of all layers                                                                           |
| CEM plugin failing to detect new mixin pattern                      | P8 addressed explicitly, run CEM build as part of CI                                                                                        |
| `we-input` render restructure breaks form integrations              | Test form submission, validation, autofill before/after. Keep native `<input>` as a direct child of the shadow root form-associated element |
| Removing dynamic `<style>` causes visual regressions                | Static CSS generates identical selectors and properties — diff generated CSS output before/after to verify parity                           |
