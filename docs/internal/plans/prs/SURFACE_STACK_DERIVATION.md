# The surface stack: make the step a knob, and stop two mechanisms disagreeing

## The question this came from

Changing `page` moves `surface`, `surface-raised` and `surface-sunken` with it, because all three are
derived from it. Is that the right design, given somebody adapting a theme makes one change and
watches four things move?

Mostly yes — and the two things that are actually wrong are not the derivation.

## What is already right, and should not be undone

`role.ts` derives the stack as OKLCH lightness offsets from `page`:

```ts
surface:       'oklch(from var(--we-role-page) calc(l + 0.025) c h)',
surfaceRaised: 'oklch(from var(--we-role-page) calc(l + 0.04)  c h)',
surfaceSunken: 'oklch(from var(--we-role-page) calc(l - 0.035) c h)',
```

Three things follow from that and all three are worth keeping:

- **The stack cannot invert.** Before derivation the four were independent scale positions, and
  flipping polarity inverted the ramp: `page` (neutral-50) came out lighter than `surface`
  (neutral-0), cards sank below the page they sat on, wells floated above both. The failure is not
  loud — as `surfacesForPolarity`'s note puts it, it does not look broken, it looks flat, so what
  somebody concludes is that the theme is poor rather than upside down.
- **The step is perceptually equal everywhere.** OKLCH lightness is a brightness; the HSL offset it
  replaced was a coordinate, so the same five points was 3.6 L\* near black and 6.3 L\* mid-range.
- **A tinted page gives a tinted stack for free**, since the relative form inherits `c` and `h`.

**The escape hatch exists too**, and is per role: a theme pins `roles.surface` and derivation stops
for that one. `channels` pins surface to the page (its design is that the channel list and the page
are one sheet, separated by borders), `timeline` pins both surfaces to a white page, and `black`
pins because at the sRGB floor a step this size rounds to the same 8-bit value. The theme panel
labels the state — a derived role reads **"follows page"** (`roleTierLabel`) — and offers "back to
the parametric default" on anything pinned.

So "both modes" is already the design. What is missing is everything between them.

## Problem 1 — the step is not a knob

The only two positions are _the house step_ and _a pinned absolute colour_. There is no way to say
"the same relationship, further apart".

So a theme author who wants more separation between the page and its cards has to pin absolute
values, and in doing so gives up tint inheritance, the taper, polarity correctness and any future
improvement to the defaults. That is a bad trade forced by a missing number, and it is a fair guess
that most pins in the wild are reaching for exactly this.

**Fix.** Put the three offsets behind theme variables, defaulting to today's values:

```ts
surface: 'oklch(from var(--we-role-page) calc(l + var(--we-theme-surface-step, 0.025)) c h)',
```

`--we-theme-*` is an established convention — twenty-odd members already, `control-height-offset`,
`badge-padding-x`, `focus-ring-width` — so this needs no new mechanism, only new members.

Cost: the variables, the `ThemeOverrides` fields, editor controls, a `THEME_SCHEMA_VERSION` bump and
a migration. Contained, and no visual change at the defaults.

## Problem 2 — two mechanisms describe the stack, and they disagree

`role.ts` reads as the source of truth and documents a deliberate taper: `surface` is a step above the
page, `surface-raised` only `+0.015` above that, because "the first level has to establish that there
is a stack at all, the second only has to sit above one".

`DARK_SURFACES` in `themeStyles.ts` pins its own figures, for any theme that has been through a
polarity change. They said 4 and 9 points where the defaults said 4.5 and 6 — the taper inverted, the
second step wider than the first, which is the shape `surfaceRaised`'s own note records as the bug it
replaced. Three of the four were brought into agreement while tuning the stack, and the state now is:

| role            | pinned | derived from a page of 10 |
| --------------- | ------ | ------------------------- |
| `page`          | 10     | —                         |
| `chrome`        | 7      | 7                         |
| `surface`       | 12.5   | 12.5                      |
| `surfaceRaised` | 14     | 14                        |
| `surfaceSunken` | 8      | 6.5                       |

So one row is left. It is the same fault in miniature, and it is left deliberately rather than fixed
halfway: moving a well is not part of moving a card, and the fix that makes this class of drift
impossible is problem 1 rather than another round of hand-matched numbers.

What the remaining row costs is worth stating, because it is what the whole problem costs: somebody
reading `role.ts` to understand where a well sits learns something untrue of any theme that has been
flipped, and a theme author tuning that step once it is a knob (problem 1) would find it ignored
there.

**Fix.** Once the steps are variables, `DARK_SURFACES` can shrink toward pinning `page` and `chrome`
alone — a dark theme needs its ground put at a sensible floor, which the scale inversion will not do
for it, and nothing more. The rest derives, with the same knobs a light theme has, and there is no
second set of figures left to keep in step by hand.

**This is the expensive half.** Deriving the dark stack changes how every dark built-in looks, which
means re-running `contrast.test.ts` across all five and re-fitting numbers where a pairing drops
below its threshold. `dark`'s own parameters were least-squares fitted against what the theme used to
render; the same care is owed here. Budget the work in colour judgement, not in code.

## Problem 3 — no step is signed by polarity

Every offset points the same way in both polarities. `surface` is lighter in light _and_ dark;
`surface-sunken` is darker in both. So "a step in from the polarity's extreme" — lighter in dark,
darker in light — is not expressible at all, and needs a pin to say it.

That is what forced the `chrome` role (shipped separately) to carry a `DARK_SURFACES` entry for a
relationship that is one idea. With steps as variables, direction can be one too, and roles of this
shape stop needing a second mechanism to exist.

## Order

1. Steps as variables, defaults unchanged. No visual change; unblocks the rest.
2. Editor controls, `ThemeOverrides` fields, schema-version migration.
3. Shrink `DARK_SURFACES` to `page`; re-verify contrast across the five built-ins and re-fit.
4. Signed steps, and fold `chrome`'s pin back into a derivation.

1 and 2 are safe and worth doing on their own. 3 is the one that needs an eye on five themes in two
polarities, and should not be bundled with anything else.

## What not to do

Do not replace derivation with independent values. Independent colours are more predictable per
change and far more likely to be wrong _as a set_ — that is the bug `surfaces.test.ts` and
`surfacesForPolarity` exist to prevent, and it shipped once already.
