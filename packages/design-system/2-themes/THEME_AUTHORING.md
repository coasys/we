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
  "accentLightness": 53,
  "surfaceRadius": "12px",
  "roles": { "surfaceRaised": "oklch(from var(--we-role-page) calc(l + 0.08) c h)" }
}
```

## Start with the parameters

`polarity` decides which end of the scale the ramp counts from. `lightnessFloor` and
`lightnessCeiling` are the darkest and lightest lightness the theme uses — together they are also
its _contrast_: a narrow span is a soft theme, a full 0–100 span is a stark one. A ceiling above
100% is legal and means the top of the ramp is compressed against white.

`saturation` and `neutralSaturation` are 0–100, read as a fraction of the chroma that hue can
actually hold. 100 means "as colourful as this hue gets", not a fixed amount — sRGB holds very
different amounts by hue, and normalising is what makes the number mean one thing wherever the hue
slider is.

Hues are **OKLCH angles**, which are not HSL angles: blue is 263, not 220; amber is 90, not 45.

`accentLightness`, `dangerLightness`, `successLightness` and `warningLightness` say how light each
**fill** is, 0–100. They are separate from the ramp on purpose: the surface stack is defined relative
to the page and has to invert with the theme, and a fill must not — a red is red in a light theme and
in a dark one. Each defaults to where its own hue is most itself (violet is a dark colour, gold is a
light one), so they differ from each other, and leaving them alone is usually right.

Reach for one when a fill is the wrong weight rather than the wrong colour. It is the alternative to
pinning the role, and much the better one: a pin opts the fill out of the label and state derivations
below, so "make the delete button brighter" becomes "make the delete button brighter and now nobody
can read it".

## Then pin roles, sparingly

Everything else is a _role_ — `surface`, `textMuted`, `accent`, `dangerText`. Each has a parametric
default, so a theme that pins nothing still recolours completely. Pin one when the relationship the
scale produces is not the one you want.

Five rungs, in descending order of how much a pin survives:

| Form                                                  | Follows                               | Use for                              |
| ----------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| unset                                                 | everything                            | most roles, most of the time         |
| `var(--we-role-page)`                                 | whatever that role follows            | "this theme has no elevation"        |
| `oklch(from var(--we-role-page) calc(l + 0.045) c h)` | the role it names, in both polarities | "one step above the page"            |
| `var(--we-color-primary-700)`                         | the parameters, but not the decisions | a palette, not a meaning — see below |
| `oklch(53% 0.18 266)`                                 | nothing                               | a brand colour that must not move    |

Prefer the highest rung that expresses the intent. A literal is the only form that stops following
the theme entirely, and a theme made of literals is a stylesheet with extra steps.

**A role stated as another role** is the rung to reach for when two things are meant to be the same
thing rather than to be the same colour. `channels` says `surface: var(--we-role-page)` because its
channel list and its page are one sheet; `timeline` says it for both `surface` and `surfaceRaised`
because it has no elevation at all. Written as a number that happens to match, they come apart the
moment the page moves.

**A scale position is the rung most often used wrongly**, so it is worth being exact about what it
does. It is not frozen: it is computed from the hue, the saturation, the floor, the ceiling and the
polarity, so it moves when any of those move and it inverts with the ramp. What it does not follow is
what the theme _decides_. A theme pins roles, not steps — so a `surface` stated as `neutral-100`
cannot hear `channels` setting its surface equal to its page, and in that theme it measures
rgb(7,8,11) against a surface of rgb(26,28,33). The quieter half is that the derivations below all
operate on roles, so a foreground stated as a step is never measured against what is behind it and
never corrected. Use a scale position where the colour is a _palette_ — a category, a chart series —
and a role everywhere it is a meaning.

## What you do not have to get right

Several roles are **derived at apply time** and will overrule a bad default — but only if you leave
them unset:

- **Foregrounds on a fill** (`onAccent`, `onDanger`, `onSuccess`, `onWarning`) are chosen by
  measuring, so a bright accent
  gets a dark label automatically. One per fill rather than a shared `onStatus`, because a single
  label across fills at three different lightnesses is a compromise rather than a choice.
  `onAccentMuted` is the secondary tier of that — `onAccent` at
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

It also cannot **redefine a scale position**, or change the _shape_ of the ramp. The fourteen steps
sit at fixed lightnesses; a theme moves the whole ramp — its ends, its hue, its saturation — and not
the distribution within it. So there is no way to ask for more resolution at the dark end, and the
nearest thing available is a pin, which is the thing pins should be rare for.

That one is a real limit rather than a principle, and it is on the list to fix. The principle
underneath it is: a theme states _parameters_, and roles are expressed over them. Letting a theme
restate a step would move every role expressed over that step, which is editing the layer beneath the
one you are working in.
