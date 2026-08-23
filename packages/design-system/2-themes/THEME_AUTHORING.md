# Authoring a theme

A theme in WE is **not a stylesheet**. It is a small object of numbers and names, and everything the
app is painted with follows from it. That is what lets a theme be authored in a browser, shared as
data, installed from a marketplace, and applied to somebody else's template without either party
knowing about the other.

```json
{
  "polarity": "dark",
  "lightnessFloor": "12%",
  "lightnessCeiling": "112%",
  "primaryHue": 263,
  "saturation": 81,
  "neutralSaturation": 32,
  "surfaceRadius": "12px",
  "roles": { "accent": "oklch(53% 0.18 266)" }
}
```

## Start with the four numbers

`polarity` decides which end of the scale the ramp counts from. `lightnessFloor` and
`lightnessCeiling` are the darkest and lightest lightness the theme uses — together they are also
its _contrast_: a narrow span is a soft theme, a full 0–100 span is a stark one. A ceiling above
100% is legal and means the top of the ramp is compressed against white.

`saturation` and `neutralSaturation` are 0–100, read as a fraction of the chroma that hue can
actually hold. 100 means "as colourful as this hue gets", not a fixed amount — sRGB holds very
different amounts by hue, and normalising is what makes the number mean one thing wherever the hue
slider is.

Hues are **OKLCH angles**, which are not HSL angles: blue is 263, not 220; amber is 90, not 45.

## Then pin roles, sparingly

Everything else is a _role_ — `surface`, `textMuted`, `accent`, `dangerText`. Each has a parametric
default, so a theme that pins nothing still recolours completely. Pin one when the relationship the
scale produces is not the one you want.

Four rungs, in descending order of how much a pin survives:

| Form                                                  | Follows                               | Use for                           |
| ----------------------------------------------------- | ------------------------------------- | --------------------------------- |
| unset                                                 | everything                            | most roles, most of the time      |
| `var(--we-color-primary-700)`                         | hue, saturation, polarity             | "the accent, but darker"          |
| `oklch(from var(--we-role-page) calc(l + 0.045) c h)` | the role it names, in both polarities | "one step above the page"         |
| `oklch(53% 0.18 266)`                                 | nothing                               | a brand colour that must not move |

Prefer the highest rung that expresses the intent. A literal is the only form that stops following
the theme, and a theme made of literals is a stylesheet with extra steps.

## What you do not have to get right

Several roles are **derived at apply time** and will overrule a bad default — but only if you leave
them unset:

- **Foregrounds on a fill** (`onAccent`, `onStatus`) are chosen by measuring, so a bright accent
  gets a dark label automatically. `onAccentMuted` is the secondary tier of that — `onAccent` at
  0.8 alpha, so it composites over whatever the fill happens to be and follows the measured choice
  without a second measurement. Pin `onAccent` and it follows the pin.
- **Foregrounds on a surface** (`textMuted`, `textFaint`, `accentText`, and the status texts) keep
  their hue and move their lightness until they clear.
- **Fills** (`accent`, `danger`, `success`, `warning`) move if no label can sit on them at all.
- **Interaction states** (`accentHover`, `dangerActive`, …) are steps from their fill and follow it.
- **The elevation stack** (`surface`, `surfaceRaised`, `surfaceSunken`) is measured from `page`.

Pinning any of these is you overruling the derivation, which is allowed and occasionally right —
`channels` states its own accent because a designed theme should say what its accent _is_. But pin
one and you own it, including in the polarity you were not looking at.

## Two rules that are not obvious

**A filled control must sit away from the middle of its ramp.** At mid-lightness neither a light nor
a dark label reads on it. The derivation handles this if you leave the fill alone; if you pin one,
check it.

**Contrast is measured twice.** WCAG 2 _and_ APCA, with the stricter governing. WCAG 2 is generous
about dark backgrounds — it adds a flat 0.05 to both sides, which dominates the ratio against
near-black — so a dark theme can look fine by that measure and be unreadable. The editor reports
both.

## What a theme cannot do

It cannot invent a role, and it cannot restyle one component in isolation — a theme says what
`surface` means, not what a particular card looks like. That boundary is deliberate: it is what lets
a theme apply to a template it has never seen. Per-component adjustment belongs to the template.
