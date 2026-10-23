# Theming

How a theme becomes what is on screen, where it reaches and where it stops, how to extend the
system, and what it deliberately cannot do.

Two other documents cover the rest. [`THEME_AUTHORING.md`](../../packages/design-system/2-themes/THEME_AUTHORING.md)
is how to write a theme. The generated **theming reference** lists every setting with one line on
what it does. It is built from the registries by `themingReference()` in
`packages/design-system/2-themes/src/reference.ts`, and appears in `CLAUDE.md` and in the theme tools
an agent edits with. This page holds no list the reference already holds, so the two cannot disagree.

## The model

A theme is an object of **settings**, not a stylesheet: polarity and a lightness range, a hue,
saturation and fill lightness per colour family, shape and density per family of component, how each
kind of text looks. A theme that sets nothing still produces a complete, legible interface, and one
that sets a single hue recolours all of it.

Three things follow from that, and the rest of this page is about keeping them true:

- **A theme applies to templates it has never seen.** It names roles ("raised surface", "muted
  text"), never components' internals, so a template written after the theme still wears it.
- **A theme is corrected where it lands.** Foregrounds, fills and states are measured against what is
  actually behind them when the theme is applied, and moved until they read.
- **A theme is data from strangers.** It is installed from a marketplace and applied to a community's
  space, so it can fetch nothing and cannot reach past where it was applied.

## Three tiers, broad to narrow

| Tier           | What it says                                                                                                                                                         | Where it lives                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **System**     | colour families and their roles, the palette, type roles, shape and density per family (`control`, `surface`, `input`, `avatar`, `media`), elevation, surface images | top-level settings                                 |
| **Components** | one component, or one variant of it, apart from its family, with the same keys a family takes                                                                        | `components.<name>[.variants.<variant>]`           |
| **CSS**        | effects no setting should express: clip-paths, keyframes, scanlines                                                                                                  | the theme's `css`, against public `::part()` names |

A component reads its own value, then its family's, then its default. The chain, for a button's
radius in the `soft` variant:

```
radius prop on the element
  → --we-theme-button--soft-radius     (components.button.variants.soft.radius)
  → --we-theme-button-radius           (components.button.radius)
  → --we-theme-control-radius          (controlRadius)
  → the button's own default
```

The component keys are the family keys — `radius`, `padding`, `gap`, `borderWidth`, `shadow`,
`type`, `fill`, `text`, `border` — so the vocabulary does not grow per component. `type` names a type
role; `fill`, `text` and `border` name colour roles. `componentChain` and `componentThemeVar` in
`1-tokens/src/componentTheme.ts` build these; `applyComponentTheme` in
`3-primitives/src/shared/helpers.ts` wires them into a primitive.

Reach for the broadest tier that says it. A component override where a family setting would do
leaves the rest of the family behind; CSS where a setting would do opts out of the corrections below
and breaks when the component's internals change.

## Three registries

Everything about the vocabulary is generated from three lists. A change to the vocabulary is a change
to one of them, and the tests named below fail until everything generated from it agrees.

| Registry            | Where                                                                                                           | What it generates                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Colour families** | `COLOR_FAMILIES`, `SEMANTIC_FAMILIES`, `PALETTE_HUES` in `1-tokens/src/families.ts`                             | the ramps, seven roles per family (`familyRoles.ts`), `tone`'s re-pointing (`toneVariables`), the contrast derivation lists, the editor's colour blocks, the graph's categorical scale |
| **Theme settings**  | `THEME_SETTINGS` and `SPECIAL_SETTINGS` in `2-themes/src/themeSettings.ts`                                      | the variables a theme writes, what the editor reads back, the scoping test, the reference                                                                                              |
| **Components**      | `COMPONENT_CASCADE` in `3-primitives/src/shared/helpers.ts`, open to modules through `registerComponentCascade` | which family each component reads, its type role, its surface image, its component-override chain                                                                                      |

## Colour

The semantic families are `accent`, `success`, `warning` and `danger`, with `neutral` for greys.
The palette is ten hues for categories a community names: `red`, `orange`, `yellow`, `lime`,
`green`, `teal`, `cyan`, `blue`, `purple`, `pink`. **Status uses the semantic families; categories
use the palette.** A task state coloured `danger` says something is wrong; one coloured `red` is
just red.

Every family has the same seven roles: `<family>`, `on-<family>`, `<family>-soft`,
`<family>-text`, `<family>-border`, `<family>-hover`, `<family>-active`. Neutral's are built from
the roles that already mean those things for greys.

**A fill is off the ramp; its text, tint and border are on it.** The surface roles (`page`,
`surface`, `surface-raised`, …) are relationships to the page, so they invert with polarity. A fill
is a thing in its own right — a red is red in a light theme and a dark one — so it states its own
lightness and takes only its hue and chroma budget from the theme. `familyRoles.ts` has the long form.

**`tone`** on any element re-points the accent's roles inside it at one family
(`toneVariables`). Components draw their colour from the accent roles alone, so a toned element and
everything in it — buttons, focus rings, selected rows, `shadow: 'glow'` — follow without being told.
`variant` is never colour: it says how a component is drawn.

## How a theme becomes CSS

`applyThemeVars(root, theme)` in `2-themes/src/themeStyles.ts` is the single chokepoint, called for
the document, a space's content and any node carrying a `theme`:

1. **Display preferences** are laid over the theme (`withDisplay`, `display.ts`): which side, more
   contrast, text size, density, motion.
2. **Settings become variables.** `writeThemeSettings` writes each direct setting; the special ones
   (polarity, the palette, type roles, components, surface images, shadows, motion) are expanded in
   `themeParametersToStyle`.
3. **The token CSS works out the ramps and roles** from those inputs — fourteen OKLCH steps per
   family between the theme's floor and ceiling, and every role as an expression over them.
4. **The derivation measures and corrects.** `deriveRoleVars` reads the roles as they resolved on
   this root and, for every role the theme left unset: picks the label on each fill
   (`FILL_LABELS`), moves a fill no label can sit on (`DERIVED_FILLS`), moves muted and coloured
   text until it clears its ground (`LEGIBLE_FOREGROUNDS`), and sets hover and pressed steps away from
   the label. Contrast is measured by WCAG 2 and APCA, and the stricter governs.
5. **Everything is written inline on the root**, including every role's default, so an unpinned role
   resolves against the theme it belongs to rather than an ancestor's.

A role the theme pins is the theme's to keep legible; the derivation does not overrule it.

## Where a theme reaches

| Scope        | Set by                                                        | Reaches                                               | Does not reach                                                                                              |
| ------------ | ------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Document** | the person's own choice                                       | the whole window                                      | —                                                                                                           |
| **Space**    | the space's default theme, or the person's pin for that space | the space's content, inside `[data-we-theme-scope]`   | the sidebar, the module rail, the app's own screens — unless the person lets a space theme the whole window |
| **Node**     | `theme` on a schema node                                      | that node's subtree, on a `display: contents` wrapper | anything outside it                                                                                         |
| **Tone**     | `tone` on an element                                          | the accent roles inside it                            | anything else                                                                                               |

Each scope re-declares the variables the token CSS derives on `:root`
(`THEME_DERIVED_VARIABLES`), so a scoped theme is complete in itself rather than inheriting half its
ramp from the document. `scoping.test.ts` checks that every setting changes something inside a
scoped wrapper.

A space's theme CSS is confined with `@scope` to the space's content. A node theme carries no CSS.

## Modes — the person wins

Five axes, each independent of the others:

| Axis          | Values                 | Follows the system       |
| ------------- | ---------------------- | ------------------------ |
| `colorScheme` | light, dark, system    | `prefers-color-scheme`   |
| `contrast`    | standard, more, system | `prefers-contrast`       |
| `textSize`    | a multiplier           | —                        |
| `density`     | compact, normal, roomy | —                        |
| `motion`      | full, reduced, system  | `prefers-reduced-motion` |

A theme may say how it looks in a mode — its `light` and `dark` sides, its `contrast.more` block — but
**which mode is worn is the person's**, and it applies over every theme, a space's included. Somebody
who needs more contrast or larger text needs it in the space they are visiting as much as at home.

That is enforced at the chokepoint rather than asked of callers: `applyThemeVars` lays the current
preferences over every theme it applies, and `setDisplayPreferences` re-applies every root on screen.
The preferences are stored per agent in `AgentSettings.displayPreferences`.

## Trust

A theme arrives from strangers, so:

- **Nothing fetches.** `sanitiseCss` drops `@import` and every `url()` that is not a `data:` URL, after
  re-serialising through the browser's own parser. A fetch would tell a third party who opened the
  space, from where and when. A theme carries its typefaces in `fontFaces`, as `data:` URLs registered
  through the FontFace API, never written as `@font-face`.
- **Nothing escapes.** A space's CSS is confined with `@scope`; its `@keyframes` are namespaced.
- **Surface images are gradients only**, for the same reason a font is carried.
- **Settings are typed.** A theme on a schema node is validated against the vocabulary
  (`zodSchemas.ts` in `schema-shared`), and every stored theme is read through `parseOverrides`
  (`migrate.ts`), so one written in an older vocabulary still loads.

## Extending the system

**Add a palette hue.** One entry in `PALETTE_HUES` and one in `COLOR_FAMILIES`
(`1-tokens/src/families.ts`). Its ramp, roles, `tone` value, editor block and contrast pairs follow.
The graph's `CATEGORICAL_SCALE` (`graph-system/core/src/style.ts`) is written out, and its test will
say it is missing the hue. Run `--filter @we/tokens test` and `--filter @we/themes test`.

**Add a semantic family.** As above, in `SEMANTIC_FAMILIES`, plus its `<family>Hue`,
`<family>Saturation` and `<family>Lightness` settings in `overrides.ts` and `themeSettings.ts`. Think
twice: a status is a meaning every theme must then design for.

**Add a theme setting.** One field in `ThemeOverrides` (`overrides.ts`) and one entry in
`THEME_SETTINGS` with its variable and a `doc` line — the type requires both — or a name in
`SPECIAL_SETTINGS` plus its expansion in `themeStyles.ts` if it is not one value into one variable.
The zod schema in `schema-shared` (`zodSchemas.ts`) admits it. `scoping.test.ts` then checks that it
reaches a scoped wrapper, and `reference.test.ts` that the reference lists it.

**Add a component to the component tier.** Register its cascade — `COMPONENT_CASCADE` for a
primitive, `registerComponentCascade` from a module — naming its family, its type role and, for a
surface, its surface image. Read colour from the accent roles so `tone` works; read geometry through
`applyComponentTheme`. `componentTier.test.ts` and `themeReach.test.ts` cover the chain.

**Add a display mode.** A field in `DisplayPreferences`, its entry in `DISPLAY_AXES`, its effect in
`withDisplay` (`display.ts`), and a control in the shell's display settings. Prefer an axis the
operating system has a signal for.

## What is not possible, and why

Each of these is a decision, not a gap. Do not build a workaround for one.

- **Exact sizes per control.** Sizes stay on the shared scale so a theme cannot break a layout written
  against it. `controlHeightOffset`, `spacingScale` and `fontScale` move the scale; a component
  override can change a radius, a padding or a border, not a height.
- **Rich text inside a heading.** A heading is one string in one type role. Two weights in one line is
  content, and belongs in the template as two text nodes.
- **`url()` in a theme**, for fonts or pictures. See Trust. Carry the bytes instead.
- **A space's theme on the app's chrome**, unless the person lets it. The chrome is the person's; a
  space choosing for it would let a community restyle somebody's way out of that community.
- **A theme over a person's display needs.** See Modes.
- **A new role or component key from a theme.** The vocabulary is the registries. A word a theme
  needs that they lack is a code change, which is how it reaches every other theme too.
- **Redistributing the ramp.** The fourteen steps sit at fixed lightnesses; a theme moves the ends,
  the hue and the saturation, not the spacing between steps. This one is a real limit rather than a
  principle, and could be lifted.

## Vocabulary

| Concept                         | Name                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The main interactive colour     | `accent` — the family, its roles, its scale `accent-500`, `accentHue`                                               |
| A colour family on an element   | `tone`                                                                                                              |
| How a component is drawn        | `variant`: `solid`, `soft`, `outline`, `ghost`, `bare`; an alert's `edge`                                           |
| A family's roles                | `<family>`, `on-<family>`, `<family>-soft`, `<family>-text`, `<family>-border`, `<family>-hover`, `<family>-active` |
| Kinds of text                   | type roles: `heading`, `body`, `label`, `control`, `badge`, `overline`                                              |
| One component's values          | `components.<name>`, keys as listed above                                                                           |
| A gradient on a kind of surface | `surfaceImages`                                                                                                     |
| Elevation                       | `shadow` (`sm`…`xl`, `glow`); `shadowIntensity`, `glowIntensity`                                                    |
| A person's needs                | display preferences: `colorScheme`, `contrast`, `textSize`, `density`, `motion`                                     |

The decision behind the tiers, registries, modes and names is recorded in
[`decisions/2026-10-23-theme-tiers-registries-and-modes.md`](decisions/2026-10-23-theme-tiers-registries-and-modes.md).
