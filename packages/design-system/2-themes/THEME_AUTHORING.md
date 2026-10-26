# Authoring a theme

A theme in WE is **not a stylesheet**. It is a small object of settings, and everything the app is
painted with follows from it. That is what lets a theme be authored in a browser, shared as data,
installed from a marketplace, and applied to somebody else's template without either party knowing
about the other.

```json
{
  "themeName": "dark",
  "accentHue": 160,
  "palette": { "lightness": 8 },
  "typeStyles": { "heading": { "weight": 300, "letterSpacing": "-0.01em" } },
  "surfaceRadius": "16px",
  "shadowIntensity": "flat",
  "components": { "button": { "variants": { "soft": { "borderWidth": "1.5px" } } } }
}
```

Work down this page in order and stop when the theme looks right. Each step is narrower than the
one before, and each step you skip is one fewer thing that can go wrong in a template you never saw.

- **How the system works** — tiers, registries, scoping, trust — is
  [`docs/architecture/theming.md`](../../../docs/architecture/theming.md).
- **Every setting, with one line on what it does,** is the generated theming reference
  (`themingReference()` in `src/reference.ts`, printed in the repo's `CLAUDE.md`). This page does not
  repeat that list.

## 1. Start from a preset

`themeName` names the built-in a theme builds on: `light`, `dark`, `black`, `retro`, `cyberpunk`,
`channels`, `timeline`. It brings that preset's settings and its CSS; everything the theme sets is
laid over them. A preset is the cheapest way to get a polarity, a lightness range and a set of
considered role pins at once.

`polarity` decides which end of the ramp the scale counts from. `lightnessFloor` and
`lightnessCeiling` are the darkest and lightest lightness the theme uses — together they are also
its _contrast_: a narrow span is a soft theme, a full 0–100 span is a stark one. A ceiling above 100%
is legal and compresses the top of the ramp against white.

## 2. Set the families

Each colour family — `accent`, `success`, `warning`, `danger` — takes a hue, a saturation and a fill
lightness: `accentHue`, `accentSaturation`, `accentLightness`. `neutralHue` and `neutralSaturation`
tint the greys; top-level `saturation` is what every family starts from.

Hues are **OKLCH angles**, not HSL: blue is 263, not 220; amber is 90, not 45. Saturation is 0–100, a
share of the chroma that hue can actually hold, so 100 means "as colourful as this hue gets" wherever
the hue is.

`<family>Lightness` says how light the **fill** is. It is separate from the ramp on purpose: surfaces
invert with polarity and a fill must not — a red is red in a light theme and a dark one. Each
defaults to where its hue is most itself (violet is dark, gold is light). Reach for it when a fill is
the wrong weight rather than the wrong colour. It is much the better alternative to pinning the role:
a pin opts the fill out of the label and state derivations, so "make the delete button brighter"
becomes "and now nobody can read it".

## 3. Tune the palette

The ten palette hues are the colours a community picks for its categories — a task state, a topic, a
lane. `palette` tunes them as a set, because a palette is designed as one: `saturation` for how vivid,
`lightness` for points lighter (pastel) or deeper, and `hues.<hue>` to set one hue's own angle,
lightness or saturation. In the panel each hue is a swatch: a picked colour is written as those three
numbers, and held within 20° of the colour the hue is named for. Text on a palette fill is corrected for contrast wherever its lightness lands.

## 4. Type roles

`typeStyles` sets how each kind of text looks — `heading`, `body`, `label`, `control`, `badge`,
`overline` — with `family`, `weight`, `letterSpacing`, `lineHeight`, `textTransform` and `color` (a
role name). A role has no defaults: each component keeps what it had for any key left unset, so
setting `heading.weight` changes heading weights and nothing else.

`control` is a control's own words — a button's label, a tab, a menu item. What a field holds, and
its placeholder, is `body`: it is what somebody wrote or chose, so a strong `control` weight makes
buttons emphatic without setting every field in bold. A field's label is `label`.

`fontFamily`, `headingFontFamily`, `letterSpacing` and `lineHeight` at the top level are the broad
settings the roles fall back to. A face nobody has installed goes in `fontFaces`, as a `data:` URL —
see `retro/vt323.ts`. A theme never fetches a font.

## 5. Shape, density, elevation and surfaces

Shape and density go by family of component: `controlRadius`, `surfaceRadius`, `inputRadius`,
`avatarRadius`; `controlPaddingX`, `controlGap`, `surfacePadding`, `surfaceGap`, `inputPadding`;
`borderWidth`, `focusRingWidth`. `spacingScale` and `controlHeightOffset` move the whole scale.

`shadowIntensity` sets how strong shadows are and which one a surface rests at; `glowIntensity` how
bright `shadow: 'glow'` is. Shadows are built from the `shadowColor` role, so a coloured shadow is one
pin.

`surfaceImages` lays a gradient over every surface of a kind — `page`, `chrome`, `surface`,
`surfaceRaised`, `surfaceSunken`. Gradients only. `page` and `chrome` stay put as content scrolls;
`surfaceOpacity` and `surfaceBlur` make surfaces glass.

## 6. Pin roles, sparingly

Everything else is a _role_ — `surface`, `textMuted`, `accent`, `dangerText`. Each has a parametric
default, so a theme that pins nothing still recolours completely. Pin one when the relationship the
scale produces is not the one you want.

| Form                                                  | Follows                               | Use for                              |
| ----------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| unset                                                 | everything                            | most roles, most of the time         |
| `var(--we-role-page)`                                 | whatever that role follows            | "this theme has no elevation"        |
| `oklch(from var(--we-role-page) calc(l + 0.045) c h)` | the role it names, in both polarities | "one step above the page"            |
| `var(--we-color-accent-700)`                          | the parameters, but not the decisions | a palette, not a meaning — see below |
| `oklch(53% 0.18 266)`                                 | nothing                               | a brand colour that must not move    |

A role stated as `''` is not pinned — by the theme or by its base preset — which is how a theme takes
back a role its preset pins. Picking a family's colour in the panel does this for the fill and its
label, so the colour is the one picked and the label is chosen against it.

Prefer the highest rung that expresses the intent. A literal is the only form that stops following
the theme entirely, and a theme made of literals is a stylesheet with extra steps.

**A role stated as another role** is right when two things are meant to be the same thing rather than
the same colour. `channels` says `surface: var(--we-role-page)` because its channel list and its page
are one sheet. Written as a number that happens to match, they come apart the moment the page moves.

**A scale position is the rung most often used wrongly.** It moves with the hue, saturation, range
and polarity, but not with what the theme _decides_ — a `surface` stated as `neutral-100` cannot hear
the theme setting its surface equal to its page. And a foreground stated as a step is never measured
against what is behind it, so it is never corrected. Use a step for a palette; a role for a meaning.

### What you do not have to get right

These are **derived when the theme is applied**, and will overrule a bad default — but only if you
leave them unset:

- **Labels on fills** (`onAccent`, `onDanger`, and every family's) are chosen by measuring, so a
  bright fill gets a dark label. `onAccentMuted` follows `onAccent` at 0.8 alpha.
- **Text on surfaces** (`textMuted`, `textFaint`, every `<family>Text`) keeps its hue and moves its
  lightness until it clears.
- **Fills** move if no label can sit on them at all.
- **Hover and pressed states** are steps from their fill, away from its label.
- **The elevation stack** (`surface`, `surfaceRaised`, `surfaceSunken`) is measured from `page`.

Pin one of these and you own it, including in the polarity you were not looking at.

**Two rules that are not obvious.** A filled control must sit away from the middle of its ramp — at
mid-lightness neither a light nor a dark label reads. And contrast is measured twice, WCAG 2 _and_
APCA, with the stricter governing: WCAG 2 is generous about dark backgrounds, so a dark theme can pass
it and be unreadable.

## 7. Tune the modes

A theme can carry both sides of itself, so an app ships one theme rather than a pair. Write the base
as one side and add a `light` or `dark` block holding only what differs — usually `polarity`, the
range, and the role pins that only hold there. In the theme panel this is the **Sides** control:
Light or Dark turns the theme, Both adds the other side, and with both every control edits the side
chosen under it while the app previews that side.

```ts
{
  polarity: 'dark', accentHue: 160, lightnessFloor: '16%', lightnessCeiling: '104%',
  roles: { page: 'oklch(18.5% 0.04 278)' },
  light: { polarity: 'light', lightnessFloor: '0%', lightnessCeiling: '100%', roles: { page: 'oklch(98% 0.01 278)' } },
}
```

`contrast.more` is the same kind of block, laid over the general more-contrast rule when somebody asks
for more contrast — for a theme whose colours need saying differently rather than merely firmer.

Which side is worn, and whether contrast is raised, text enlarged, density changed or motion reduced,
is **the person's choice and wins over the theme**. Design for every mode; do not try to prevent one.

## 8. Override a component

When one component should differ from its family, set it under `components`, by the name it
registers (`button`, `menu-item`, `card`), with the family's own keys: `radius`, `padding`, `gap`,
`borderWidth`, `shadow`, `type`, `fill`, `text`, `border`. A variant goes one level down:

```json
{
  "components": {
    "badge": { "type": "overline", "radius": "pill" },
    "button": { "variants": { "outline": { "borderWidth": "1.5px" } } }
  }
}
```

An explicit prop on an element still wins over all of this.

## 9. Only then, CSS

The last tier, for effects no setting should express — a clip-path, keyframes, scanlines. A theme's
`css` is sanitised before it is applied: `@import` and every `url()` that is not a `data:` URL are
removed, `@keyframes` are namespaced, and a space's theme is confined to the space's content.

- **Select by theme:** `[data-we-theme='name']`, never `html[data-we-theme='name']` — a scoped theme
  sets the attribute on a wrapper, not on `<html>`.
- **Target public parts only:** `we-button::part(base)`. `PUBLIC_PARTS` in
  `3-primitives/src/parts.ts` is the list, and it is versioned as API; anything else can change under
  you.
- **Read colours from roles:** `var(--we-role-accent-border)`, not a hex, so the CSS follows the
  theme's settings and a `tone`.
- **Never `!important` on a custom property.** A node's `theme` and a person's display preferences
  are applied inline, and `!important` in a stylesheet defeats them.

## Built-in themes

A built-in theme is a preset in `src/presets.ts` (`THEME_PRESETS`) and, when it needs effects, a
stylesheet in `src/<name>/index.css` imported by `src/index.css`. List it in `themeRegistry` in
`packages/app-shell/src/shared/registries/themeRegistry.ts` so the pickers offer it, and rebuild
with `pnpm --filter @we/themes build`.

**Pin roles in the preset, not in the CSS.** Everything reads the preset — including a space's theme
scoped to its content — while a `[data-we-theme]` rule only fires where that attribute is set. And
every role's default is written inline when a theme is applied, which outranks an attribute selector,
so a role declared only in CSS is overwritten by its own default. `builtInThemes.sanitise.test.ts`
holds the two in agreement where a preset states a role in both.

`roles` is the one setting that **merges** with a preset's rather than replacing it, so a theme can
pin one role on top of `channels` without discarding the dozen that make it `channels`.

## Worked examples

**A quiet theme.** Narrow range, low saturation, no elevation, soft type:

```json
{
  "themeName": "light",
  "lightnessFloor": "8%",
  "lightnessCeiling": "96%",
  "saturation": 40,
  "neutralSaturation": 12,
  "palette": { "saturation": 45, "lightness": 6 },
  "shadowIntensity": "flat",
  "roles": { "surfaceRaised": "var(--we-role-surface)" },
  "typeStyles": { "heading": { "weight": 500 }, "overline": { "letterSpacing": "wide" } }
}
```

**A high-contrast theme.** Full range, heavier strokes, and a `contrast.more` block for the
colours that need it said differently:

```json
{
  "themeName": "black",
  "lightnessFloor": "0%",
  "lightnessCeiling": "100%",
  "borderWidth": "2px",
  "focusRingWidth": "3px",
  "typeStyles": { "body": { "weight": 500 }, "control": { "weight": 700 } },
  "contrast": { "more": { "roles": { "border": "var(--we-role-text)" } } }
}
```

**A glowing theme.** The accent as light: a glow on cards and dots, gradients on the page, a display
face carried in the theme:

```json
{
  "themeName": "dark",
  "accentHue": 300,
  "glowIntensity": "strong",
  "shadowIntensity": "flat",
  "surfaceImages": {
    "page": "radial-gradient(60% 50% at 15% 10%, oklch(70% 0.15 300 / 0.25), transparent), radial-gradient(50% 40% at 90% 80%, oklch(75% 0.12 220 / 0.2), transparent)"
  },
  "typeStyles": { "heading": { "family": "'Bricolage', var(--we-font-family)", "weight": 300 } },
  "components": { "card": { "shadow": "glow" } },
  "fontFaces": [{ "family": "Bricolage", "src": "data:font/woff2;base64,…" }]
}
```

## What a theme cannot do

It cannot fetch anything, reach the app's chrome from a space unless the person lets it, set an exact
size per control, override a person's display needs, or invent a role or a component key. Each is a
decision; the reasons and what to do instead are under "What is not possible" in
[`docs/architecture/theming.md`](../../../docs/architecture/theming.md).
