# Theme System Overhaul Plan

**Goal:** Transform the DefaultTemplate from a hand-crafted aesthetic (individual prop overrides fighting the theme) into a properly semantic codebase where the theme drives the visual appearance. Then extend the theme system itself to support richer, more granular user customisation via the theme editor panel.

A key constraint throughout: this system needs to support independent marketplace contributors authoring themes and templates without internal guidance. Every convention, token, and pattern must be explicit enough that an external author can follow it correctly from documentation alone.

This work is split into two tracks:

- **Track A — Template cleanup:** Make the DefaultTemplate semantic so themes actually work.
- **Track B — Theme system extension:** Extend the cascade architecture and theme editor panel with new controls.

Track A must be substantially complete before Track B's theme panel controls become meaningful (there's no point exposing "button radius" in the theme panel if every button has a hardcoded `r=` override).

---

## Agreed Conventions

These conventions must be applied consistently across all template work going forward. The ai-context fragment (`packages/ai-context/src/fragments/design-system-props.ts`) is the authoritative source — update it and regenerate `CLAUDE.md` so AI-assisted authoring follows the same rules.

### we-text Variants

The variant table below reflects the state **after Phase 1** (heading scale rename + new `heading-md`). Do not use the old names `heading` or `heading-lg` anywhere in new code.

| Variant      | fontSize  | fontWeight | Recommended `tag` | Notes                                                                             |
| ------------ | --------- | ---------- | ----------------- | --------------------------------------------------------------------------------- |
| _(blank)_    | inherited | inherited  | `span`            | Default prose — omit variant entirely                                             |
| `body`       | 400       | —          | `p` or `span`     | Explicit body text                                                                |
| `label`      | 300       | medium     | `span`            | UI labels, captions                                                               |
| `footnote`   | 200       | —          | `span`            | Small text — add `color="neutral-400"` explicitly when muted appearance is needed |
| `subheading` | 500       | medium     | `h5` or `p`       | Section titles                                                                    |
| `ingress`    | 500       | —          | `p`               | Lead paragraphs (loose line-height)                                               |
| `heading-sm` | 600       | bold       | `h4`              | —                                                                                 |
| `heading-md` | 700       | bold       | `h3`              | **New in Phase 1**                                                                |
| `heading-lg` | 800       | bold       | `h2`              | **Renamed from `heading` in Phase 1**                                             |
| `heading-xl` | 1000      | bold       | `h1`              | **Renamed from `heading-lg` in Phase 1**                                          |

**Semantic tag guidance:** `we-text` defaults `tag` to `span`. Always set the appropriate semantic tag alongside the variant for correct HTML structure and accessibility. The table above shows recommended pairings — treat them as defaults, not rules (a page may have multiple `h2` elements under different `heading-lg` variants; only one should be `h1`).

**Rules:**

- Always use `variant=` on `we-text`. Only use `fontSize` directly for genuine one-off exceptions not covered by any variant.
- Never set `fontSize` + `fontWeight` to reproduce what a variant already defines — use the variant.
- Only set `fontWeight` explicitly when it differs from what the variant already provides; otherwise it is redundant noise.

### fontWeight Tokens

After Phase 1, named weight aliases (`regular`, `medium`, `semibold`, `bold`) will be **first-class design tokens** defined in `font.ts` — not CSS pass-through. They resolve through the token system to CSS variables (`var(--we-font-weight-bold)`) exactly like radius and spacing tokens do.

| Alias      | Numeric equivalent | Token variable              |
| ---------- | ------------------ | --------------------------- |
| `regular`  | 400                | `--we-font-weight-regular`  |
| `medium`   | 500                | `--we-font-weight-medium`   |
| `semibold` | 600                | `--we-font-weight-semibold` |
| `bold`     | 700                | `--we-font-weight-bold`     |

**Rules:**

- Prefer named aliases (`'bold'`, `'semibold'`, `'medium'`, `'regular'`) over raw numeric values for readability.
- Numeric values `'100'`–`'900'` remain valid for precise control.
- Remove `fontWeight` declarations that are already implied by the `variant` in use.

### Color Roles

Keep the five semantic hues: `primary`, `success`, `warning`, `danger`, `neutral`.

**Text color conventions:**

These are _reference constraints for when a color override is genuinely needed_ — not new variants or abstractions to build. The cleanup goal is to delete ~70% of existing `color=` props entirely (the theme handles contrast by default). The remaining ~30% of intentional overrides should use these shades consistently rather than picking arbitrary points on the neutral scale.

Color and typography are intentionally separate: `variant=` handles size/weight bundles, `color=` is set explicitly only when a specific semantic role requires it. This keeps variants composable (you can apply any color role to any text size).

| Role               | Token                   | When to set explicitly                                                       |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------- |
| Primary text       | _(inherit — don't set)_ | Never — the theme provides this automatically                                |
| Secondary text     | `neutral-600`           | Metadata, timestamps, supporting captions                                    |
| Muted / ghost text | `neutral-400`           | De-emphasised labels, captions, footnote-sized text                          |
| Disabled           | `neutral-300`           | Inactive states (prefer `disabledProps` on interactive elements)             |
| Interactive / link | `primary-600`           | Clickable inline text labels                                                 |
| Inverted text      | `neutral-0`             | Text on filled/dark surfaces (e.g. inside a filled button or coloured badge) |

**Surface/background conventions:**

| Role             | Token                 | Usage                                              |
| ---------------- | --------------------- | -------------------------------------------------- |
| Page background  | _(inherit)_           | Always set `bg: 'neutral-50'` on root schema nodes |
| Raised surface   | `neutral-50`          | Cards, panels, sidebars                            |
| Subtle container | `neutral-100`         | Tags, hover fills, code blocks                     |
| Overlay / modal  | _(component default)_ | `we-modal` sets `bg: neutral-0` — don't override   |

**Rules:**

- Never use hex color values (`#ffffff`, `#3388ff` etc.) — map to token equivalents.
- Don't set `color=` on text elements unless you specifically need a non-default shade. The theme handles contrast by default.
- The target is to remove ~70% of explicit `color=` props — most are unnecessary overrides.

### Radius

**Rules:**

- Do not set `r=` on component instances unless you intentionally want to deviate from the component's default.
- Component defaults (button: `400`, input: `300`, modal: `600`) are correct — redundant `r=` props that match the default should be deleted.
- Intentional per-instance overrides (e.g. a circular avatar: `r="full"`, a pill tag: `r="pill"`) are fine to keep.
- "All buttons should be pill" belongs in the theme, not in individual `r=` props.

### Spacing

- Use only the standard token scale: `'0'`, `'100'`–`'1000'`.
- `'50'` is not a valid token — replace all instances with `'100'`.
- Negative pixel margins (e.g. `-85px`) are acceptable exceptions when compensating for a fixed structural offset, but document why with a comment.

### Borders

- Standardise all border props to: `border: '1px solid neutral-200'` (the lightest separator) or `border: '1px solid neutral-300'` (slightly stronger). Use consistently — do not mix shades.
- Long-term target: a semantic `border="base"` token (deferred — requires changes to how the `border` prop resolves values).

### Focus Rings

- Standardise all `ring=` props to: `ring: '0 0 0 2px var(--we-ring-color)'`
- Never hardcode `var(--we-color-neutral-500)` or any specific color in a ring — `--we-ring-color` is theme-controlled.
- `--we-ring-color` defaults to `--we-color-primary-500`. Themes override it to match their accent colour.

### Layout Sizes (new tokens — see Phase 8)

New `--we-layout-*` tokens will replace hardcoded `maxWidth` pixel values:

| Token name  | Value    | Usage                      |
| ----------- | -------- | -------------------------- |
| `layout-xs` | `420px`  | Narrow modals, auth forms  |
| `layout-sm` | `640px`  | Standard modals, forms     |
| `layout-md` | `900px`  | Content columns            |
| `layout-lg` | `1200px` | Full-width page containers |

Until Phase 8 lands, keep `maxWidth: '1200px'` etc. as-is.

---

## Architecture Decisions

### fontWeight as proper tokens (decided: yes)

Named weight aliases will be added to `font.ts` as first-class tokens alongside the numeric scale. This is consistent with how radius handles `pill` and `full` alongside `100`–`900`. It means:

- They are validated by the type system (`FontWeightToken`)
- They resolve through the token CSS variable (`var(--we-font-weight-bold)`)
- They are theme-configurable in principle (a theme could redefine what 'bold' means)
- External authors see a consistent, documented token set rather than undocumented CSS pass-through

### Built-in themes (CSS) vs. custom themes (JSON ThemeOverrides)

Currently there are two authoring paths: built-in themes are pure CSS files using `[data-we-theme]` selectors; custom/marketplace themes are JSON `ThemeOverrides` objects stored in a `Theme` model. These don't compose.

**Decided:** Keep both paths but make them clearly documented and complementary:

- **JSON ThemeOverrides** — the primary path for marketplace themes. Structured, validated, exposable via the theme panel UI. Covers the most common customisation needs (colour, radius, spacing, typography, motion).
- **Raw CSS field** — the escape hatch for advanced themes that need component-level overrides beyond what `ThemeOverrides` supports. Available to both marketplace and built-in themes.
- **Built-in themes** — remain as CSS files for performance. The theme registry will eventually also support a JSON overrides field to align with marketplace themes, but this is deferred.

The `THEME_AUTHOR_GUIDE.md` (Phase 10) must document both paths clearly, including when to use each.

### Distinguishing explicit instance props from DEFAULT_PROPS (Phase 6)

The Phase 6 cascade requires that instance-level CSS vars (`--we-button-r`) are only set when a prop is explicitly passed by the user — not when it comes from `DEFAULT_PROPS`. Currently `updateAllCustomVars()` receives the merged result and can't distinguish the two.

**Implementation approach:** Pass the raw (unmerged) props object as a second argument to `updateAllCustomVars()`. Before setting any CSS var, check whether the key exists in the raw props. If it does, set the instance var (winning the cascade). If not, skip it and let the theme-level fallback chain in the static CSS handle it.

```
updateAllCustomVars(el, mergedProps, rawExplicitProps)
  → only set --we-button-r if 'r' is in rawExplicitProps
```

This is a non-breaking change to the internal API — no public interface changes required.

---

## Track A — Template Cleanup

### Phase 1: Token foundations + heading scale

**Why first:** Establishes the correct token vocabulary before any cleanup work. All subsequent phases depend on having the complete and correctly-named variant/token set.

**1a — Add fontWeight named tokens to `font.ts`:**

- Add `regular`, `medium`, `semibold`, `bold` as named keys mapping to `'400'`, `'500'`, `'600'`, `'700'`
- Update `FontWeightToken` type union to include the new keys
- Update `generate-css.ts` to emit `--we-font-weight-regular` etc. alongside the numeric vars
- Verify `resolveFontWeight()` in utils now finds these keys in the token set and emits `var(--we-font-weight-bold)` correctly

**1b — Add `heading-md` variant + rename heading scale in `text.ts`:**

- Add `heading-md`: `{ fontSize: '700', fontWeight: 'bold' }`
- Rename `heading` → `heading-lg` (fontSize: '800', fontWeight: 'bold')
- Rename `heading-lg` → `heading-xl` (fontSize: '1000', fontWeight: 'bold')
- Search entire codebase for `variant="heading"` and `variant="heading-lg"` and update (no backward compatibility needed — project has no external consumers)

**1c — Update ai-context fragment and regenerate CLAUDE.md:**

- Edit `packages/ai-context/src/fragments/design-system-props.ts`:
  - Update variant table with new names and `heading-md`
  - Update fontWeight documentation to show named token aliases
  - Add semantic `tag` recommendations to variant table
- Run `pnpm --filter @we/ai-context generate-context` to regenerate `CLAUDE.md`
- Commit fragment source and regenerated files together

**1d — Validate:**

- Run `pnpm --filter @we/schema-shared validate`
- Build design-system packages and confirm CSS output includes new fontWeight vars

---

### Phase 2: Replace fontSize numbers with variants (DefaultTemplate)

**Why:** 69+ instances of `fontSize: '400'`, `fontSize: '700'` etc. bypass the variant system and make the template immune to global typography theming.

**Approach:** File by file through the DefaultTemplate, replacing each `we-text` fontSize/fontWeight combination with the matching variant. Remove redundant `fontWeight` declarations where the variant already sets them. Add the appropriate `tag=` prop alongside each variant change.

**Key mapping:**

- `fontSize: '200'` → `variant="footnote"` (if muted context) or adjust to `label`
- `fontSize: '300'` + optional medium → `variant="label"`
- `fontSize: '400'` → no variant (body is the default) or `variant="body"`
- `fontSize: '500'` + medium → `variant="subheading"`
- `fontSize: '600'` + bold → `variant="heading-sm"`
- `fontSize: '700'` + bold → `variant="heading-md"` _(new)_
- `fontSize: '800'` + bold → `variant="heading-lg"` _(renamed)_
- `fontSize: '1000'` + bold → `variant="heading-xl"` _(renamed)_

**Files to update (DefaultTemplate):**

- `SpaceGate.ts`
- `routes/AboutRoute/index.ts`
- `routes/HomeRoute/index.ts`
- `routes/CardsRoute/UsersList.ts`
- `routes/FluxRoute/index.ts`
- `routes/FluxRoute/ChannelList.ts`
- `routes/SignalsRoute/index.ts`
- `routes/SettingsRoute/` (all files)
- `CreateSpaceModal.ts`
- `HeaderLayout/SpaceHeader.ts`
- `SidebarLayout/SpaceSidebar.ts`

**Validate after each file.**

---

### Phase 3: Remove redundant radius overrides

**Why:** Any `r=` prop that matches the component's built-in default is dead weight. Removing it means the component will respond correctly to theme-level radius changes (once Track B lands).

**Component defaults:**

- `we-button`: `r="400"` — remove any `r: '400'` explicitly set on buttons
- `we-badge`: `r="400"` — same
- `we-input`: `r="300"` — remove explicit `r: '300'`
- `we-modal`: `r="600"` — remove explicit `r: '600'`

**Keep:** any `r=` prop that intentionally deviates from the component default (`r="pill"` on a pill badge, `r="full"` on a circular avatar, `r="0"` for a square variant, etc.).

---

### Phase 4: Thin out hardcoded neutral/primary color overrides

**Why:** 88 hardcoded neutral color props mean the template ignores the theme's colour system. Most of these are unnecessary because the theme already provides correct contrast.

**Approach:** Work file by file. For each `color=` or `bg=` prop:

1. **Delete it** if it's setting the theme's natural default (most cases).
2. **Keep it** only if it's intentionally different from the default for a semantic reason.
3. **Replace with `neutral-600`** for genuine "secondary text" use cases.
4. **Replace hex values** (`#ffffff` → `neutral-0`, `#3388ff` → `primary-500`).

Verify visually after each file — stripping color overrides may reveal contrast issues in the theme that need fixing at the theme level, not the template level.

---

### Phase 5: Standardise borders, rings, and spacing edge cases

**Borders:** Standardise all `border: '1px solid neutral-*'` to use a consistent shade. Assess whether `neutral-200` or `neutral-100` is the right default for the dark theme.

**Rings:** Replace all `ring: '0 0 0 2px var(--we-color-neutral-500)'` (and similar) with `ring: '0 0 0 2px var(--we-ring-color)'`. Files: `CreateSpaceModal.ts`, `HeaderLayout/SpaceHeader.ts` (×2), `SidebarLayout/SpaceSidebar.ts`.

**Off-scale spacing:** Replace all `gap: '50'` and `p: '50'` with `'100'` (confirmed: `'50'` is not a valid token).

**Pixel icon sizes:** Replace `size: '60px'` on `we-icon` with the nearest named size token (`xl` or `xxl`).

---

## Track B — Theme System Extension

### Phase 6: Add component-level CSS cascade

This is the structural work that makes per-component theme overrides possible.

**The cascade (highest to lowest priority):**

```
1. Explicit instance prop     r="pill" on a specific element
2. Component theme override   --we-theme-button-radius   (just buttons)
3. Group theme override       --we-theme-control-radius  (all controls)
4. Design token default       --we-radius-400            (primitive default)
```

**CSS var chain in static component styles:**

```css
border-radius: var(--we-button-r, var(--we-theme-button-radius, var(--we-theme-control-radius, var(--we-radius-400))));
```

**Theme variables to introduce:**

| Variable                     | Affects                    | Fallback                 |
| ---------------------------- | -------------------------- | ------------------------ |
| `--we-theme-control-radius`  | buttons, badges, chips     | `--we-radius-400`        |
| `--we-theme-surface-radius`  | modals, cards, dialogs     | `--we-radius-600`        |
| `--we-theme-input-radius`    | inputs, textareas, selects | `--we-radius-300`        |
| `--we-theme-control-spacing` | button/badge padding       | `--we-space-400`         |
| `--we-theme-surface-spacing` | modal/card padding         | `--we-space-900`         |
| `--we-theme-surface-opacity` | modal/overlay bg opacity   | `1`                      |
| `--we-ring-color`            | all focus rings            | `--we-color-primary-500` |

**Files to change:**

- `packages/design-system/3-primitives/src/shared/helpers.ts`:
  - Modify `updateAllCustomVars()` to accept a `rawExplicitProps` argument (see Architecture Decisions above). Only set instance vars (e.g. `--we-button-r`) when the key exists in `rawExplicitProps`.
  - Update `getStaticDSStyles()` to emit fallback chains (`var(--we-button-r, var(--we-theme-button-radius, var(--we-theme-control-radius, var(--we-radius-400))))`) instead of single var references.
  - Apply fallback chains to: radius, padding/spacing, shadow, opacity, ring.
- `packages/schema-system/shared/src/types.ts` — extend `ThemeOverrides` with new fields (see Phase 7).
- `packages/app-framework/src/frameworks/solid/stores/ThemeStore.tsx` — extend `themeToStyle()` to map new `ThemeOverrides` fields to the `--we-theme-*` CSS variables above.

---

### Phase 7: Extend ThemeOverrides type

New fields to add to `ThemeOverrides` in `packages/schema-system/shared/src/types.ts`:

```typescript
// Shape
controlRadius?: RadiusToken | string;    // buttons, badges
surfaceRadius?: RadiusToken | string;    // modals, cards
inputRadius?: RadiusToken | string;      // inputs

// Density
controlSpacing?: SpaceToken | string;    // button/badge padding
surfaceSpacing?: SpaceToken | string;    // modal/card padding

// Elevation
shadowIntensity?: 'flat' | 'subtle' | 'elevated' | 'dramatic';

// Typography
letterSpacing?: LetterSpacingToken;

// Surfaces
surfaceOpacity?: number;   // 0–1, for modal/overlay backgrounds

// Motion
animationSpeed?: 'none' | 'fast' | 'normal' | 'slow';
```

**Note on `fontSizeScale`:** A global font size scale multiplier was considered but is deferred. Scaling all `--we-font-size-*` tokens proportionally requires either recalculating every derived value or wrapping every font-size token in `calc()`, which adds significant complexity. The per-variant approach (where individual text sizes are set via theme) is sufficient for now.

`themeToStyle()` in `packages/schema-system/shared/src/themeStyles.ts` must be extended to translate each new field into the corresponding `--we-theme-*` CSS variable output.

---

### Phase 8: Layout size tokens

Add layout constraint tokens to the token system.

**New file: `packages/design-system/1-tokens/src/layout.ts`:**

```typescript
export type LayoutToken = 'xs' | 'sm' | 'md' | 'lg';

export const layout = {
  xs: '420px', // narrow modals, auth forms
  sm: '640px', // standard modals, forms
  md: '900px', // content columns
  lg: '1200px', // full-width page containers
} satisfies Record<LayoutToken, string>;
```

**Update `packages/design-system/1-tokens/scripts/generate-css.ts`:**

- Import `layout` from the new file
- Add a `generateLayoutCSS()` function emitting `--we-layout-xs`, `--we-layout-sm`, `--we-layout-md`, `--we-layout-lg`
- Call it in the aggregator alongside the existing generators
- Add `layout` to `src/index.ts` exports

**Update DefaultTemplate:** Replace all hardcoded `maxWidth: '1200px'` etc. with `maxWidth: 'var(--we-layout-lg)'`.

---

### Phase 9: Theme panel UI — new sections

Extend `ThemePanel.tsx` with new control sections. Use collapsible sections to avoid overwhelming the panel.

**Section structure:**

**Color** _(existing)_

- Primary / Success / Warning / Danger / Neutral hue sliders
- Saturation sliders (colors, neutrals)
- Lightness baseline
- Mode toggle (light/dark)

**Shape**

- _Preset:_ `sharp` / `default` / `rounded` / `pill` (sets all three group vars at once)
- _Overrides:_ Controls radius (button/badge), Surfaces radius (modal/card), Inputs radius
- Border width (thin / medium / thick)

**Typography**

- Font family _(existing)_
- Letter spacing: `tight` / `normal` / `airy`

**Spacing & Density**

- _Preset:_ `compact` / `comfortable` / `spacious` (sets control + surface spacing together)
- _Overrides:_ Controls padding, Surface padding

**Effects & Motion**

- Shadow intensity: `flat` / `subtle` / `elevated` / `dramatic`
- Surface opacity: slider 0.5–1.0 (for glass/frosted effects)
- Animation speed: `none` / `fast` / `normal` / `slow`

**Layout** _(optional / advanced)_

- Content width preset: `narrow` / `default` / `wide` (maps to `--we-layout-*` tokens)

**Custom CSS** _(existing)_

---

### Phase 10: Theme Author Guide

Before marketplace themes are a real use case, create `packages/design-system/2-themes/THEME_AUTHOR_GUIDE.md`. Also complete the dark theme reference implementation so it actually demonstrates all required variables.

**Guide must cover:**

- **Two authoring paths:** JSON `ThemeOverrides` (primary, structured, panel-configurable) vs. raw CSS (escape hatch for advanced overrides). When to use each.
- **Required vs. optional variables:** Which colour system variables are required for a theme to render correctly; which are optional enhancements.
- **The cascade:** How `--we-theme-*` variables interact with instance-level props and global tokens. Why setting `--we-theme-control-radius: pill` is the right way to make all buttons pill-shaped.
- **Semantic token conventions:** The color role table, spacing scale, radius values — so marketplace themes don't hardcode arbitrary shades.
- **Local testing:** How to apply a theme locally before publishing.
- **Metadata requirements:** Name, icon, description, and screenshot fields expected by the marketplace listing.
- **Common mistakes:** Using `!important` (breaks schema overrides); hardcoding hex values; setting component-instance vars instead of theme-level vars.

**Also:** Extend the `ThemeData` type with `description`, `screenshots`, and `compatibility` fields to support marketplace listings. This is a model-level change in `@we/models`.

---

## Sequencing Summary

```
Phase 1   Token foundations (fontWeight tokens, heading scale, ai-context)  ← unblocks everything
Phase 2   Replace fontSize with variants                                    ← biggest cleanup
Phase 3   Remove redundant radius overrides                                 ← unblocks Phase 6 payoff
Phase 4   Thin out neutral color overrides                                  ← visual verification needed
Phase 5   Borders, rings, spacing edge cases                                ← mechanical cleanup
──────────────────────────────────────────────────────────────────────────
Phase 6   Component-level CSS cascade (helpers.ts)                          ← structural
Phase 7   Extend ThemeOverrides type + themeToStyle()                       ← extends schema
Phase 8   Layout size tokens + generate-css.ts update                       ← new token category
Phase 9   Theme panel UI — new control sections                             ← depends on 6+7
Phase 10  Theme author guide + dark theme reference + ThemeData metadata    ← marketplace readiness
```

Phases 1–5 can proceed independently of 6–10. Phase 9 depends on 6 and 7. Phase 8 is independent and can happen any time after Phase 5. Phase 10 can be written incrementally alongside Track B.

---

## Out of Scope (for now)

- **Negative pixel margins** (`-85px`, `-65px`) — intentional layout offsets; keep as-is pending a structural layout review
- **Text truncation `styles` props** (`text-overflow: ellipsis`) — legitimate CSS-in-JS exceptions, no token equivalent
- **Hardcoded component dimension overrides** (`height: '40px'`, `width: '120px'`) — review per-case when we reach those files; some may be legitimate fixed-size UI chrome
- **`info` hue colour** — possible future addition alongside primary/success/warning/danger/neutral
- **Semantic `border="base"` token** — deferred; requires changes to how the `border` prop resolves values
- **`CollapsibleSidebar` widget raw CSS props** — the widget exposes `itemColor`, `itemBgHover`, `itemBgActive` etc. as raw CSS strings, bypassing the token system entirely. This is a known gap for marketplace templates using the sidebar widget. Tracked as a separate widget refactor.
- **`fontSizeScale` global multiplier** — deferred from Phase 7 due to implementation complexity (see Phase 7 note)
- **Marketplace submission/discovery infrastructure** — separate from this overhaul (see `docs/internal/plans/module-marketplace.md`)
- **Built-in theme migration to JSON** — built-in themes remain as CSS files for now; JSON ThemeOverrides path is for marketplace/custom themes
