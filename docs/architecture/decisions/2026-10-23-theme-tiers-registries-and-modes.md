# A theme is three tiers over three registries, and a person's display needs win over it

**Status:** Accepted — 2026-10-23

**Decision.** A theme says what it says in three tiers, broad to narrow: system settings (colour
families, the palette, type roles, shape, density, elevation, surface images), per-component values
with the same keys the families take, and sanitised CSS for effects nothing else should express. Its
vocabulary is generated from three registries — colour families, theme settings, components — and
the names are `accent` for the main colour, `tone` for a colour family on an element and `variant`
for how a component is drawn. Contrast, text size, density, motion and colour scheme are the
person's, applied over every theme at the one place themes are applied. The model is in
[`theming.md`](../theming.md).

**Why.** A theme is installed from strangers and applied to templates its author never saw, so it has
to name meanings rather than components' internals, and has to be corrected for contrast where it
lands. Settings can be measured and corrected; CSS cannot. The component tier exists because a
designer's spec does differ per component, and the alternative was CSS that breaks when the component
changes — but with the family's own keys, so the vocabulary stays about a dozen words however many
components there are. Registries because every hand-maintained copy of the vocabulary had drifted:
two maps from setting to variable disagreed about a unit, and the agent context described almost
none of it. A person's needs win because somebody who needs more contrast needs it in the space they
are visiting, and a space's theme choosing otherwise would be choosing for them.

**Rejected.**

- _Material's primary, secondary and tertiary._ Three brand colours make every component decide which
  it is, and most designs use one. One accent, re-pointed by `tone`, colours anything in any family
  without a component knowing families exist.
- _A token set per component_ (`button.background`, `card.border`, …), as several design-token
  systems do. Hundreds of names, most never set, each a new way to break legibility. The component
  tier keeps one vocabulary and reads the family's value when the component's is unset.
- _Families only, no component tier._ Leaves every per-component difference to CSS, which opts out of
  the corrections and targets internals.
- _`variant` carrying colour_ (`variant: 'danger'`). Folds two choices into one word, so every
  component needed a variant per family per style. `variant` is style, `tone` is family, and any of
  one combines with any of the other.
- _Modes as themes_ (a "high contrast" theme to switch to). Loses the space's own look the moment
  somebody needs contrast, and makes every theme author responsible for every need.

**Revisit when.** A designer's spec repeatedly needs a per-component value the family keys cannot
express (a height, say), or a second accent turns out to be needed — which is one line in the family
registry, not a new tier.
