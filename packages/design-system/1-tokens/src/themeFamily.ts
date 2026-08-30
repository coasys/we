/**
 * THEME FAMILIES — the shape and density groups, and the names a call site knows them by.
 *
 * ## What a family is, and why there are only five
 *
 * A colour **role** is a value somebody picks per element: this text is muted, that panel is
 * sunken. There are 42 of them and any element may name any one, which is why `ROLE_NAMES` is
 * derived from the whole `role` object and a template can say `bg="surface-sunken"` the day a role
 * is added.
 *
 * Shape and density are not like that. They are decisions about *kinds of component* — buttons are
 * rounded like this, sheets like that — so the theme holds four of them, and a primitive inherits
 * its family automatically through `COMPONENT_CASCADE`: `we-button` reads
 * `--we-theme-control-radius` because it is registered as a control, and nobody ever names it.
 * That path covers every primitive and needs no vocabulary at all.
 *
 * This table is for what the cascade cannot reach. A layer-4 Solid component (`Card`,
 * `EditableImage`) and a raw element have no cascade entry, so the **caller** is the only thing
 * that knows which family the box belongs to and has to say so.
 *
 * ## Why it is a table rather than three hand-written maps
 *
 * Because the hand-written version drifted, exactly once per axis. `avatar` and `media` were added
 * when `EditableImage` needed them and `surface` when a cover image did; `control` and `input` were
 * never named at all, and padding and gap were never nameable, so `Card` sat there spelling all
 * three of its group values out as raw `var()` strings — the same string the radius name replaced,
 * twice more. A name that does not exist fails silently: `r: 'surface'` resolved to
 * `var(--we-radius-surface)`, a variable nothing declares, so it painted nothing and said nothing.
 *
 * One table, and the resolver maps, the value types and the generated docs all derive from it. A
 * family added here is nameable everywhere in the same commit, and `themeFamily.test.ts` fails if a
 * theme grows a radius or gap group this does not cover.
 *
 * ## Why the matrix is sparse
 *
 * Every gap below is a constraint, not an omission — see `axes` on each entry:
 *
 * - **No `control` padding.** `--we-theme-control-padding-x` is horizontal only, and a control's
 *   vertical size comes from its height, per size. `p: 'control'` would put a horizontal value on
 *   all four sides, and there is no size in the question to answer it with.
 * - **No `input` padding.** `--we-theme-input-padding` is deliberately a full shorthand (textarea
 *   is in that family and has no fixed height to supply the vertical). Padding is assembled here
 *   as four values joined into one declaration, so a shorthand landing in one slot invalidates the
 *   whole thing.
 * - **No `input`, `avatar` or `media` gap.** Those families have no gap variable to read.
 *
 * The rule the first two share: a family earns a padding name only if its theme value is a single
 * length. That is a real constraint on the theme key, not a preference — `surfacePadding` has been
 * single-valued since `Card` first read it as `p`.
 */

/** One axis of one family: the theme variable, and what it resolves to when no theme sets it. */
export interface ThemeFamilyAxis {
  /** The theme's own variable — what a theme writes, and what `COMPONENT_CASCADE` reads. */
  var: string;
  /**
   * The value when no theme has spoken.
   *
   * Taken from what the family's own components already fall back to, so a raw element named into a
   * family matches the real thing in a theme that sets nothing: `control` is `we-button` at `md`,
   * `surface` is `Card`, `input` is the wrapper defaults the pickers share.
   */
  fallback: string;
}

export const themeFamily = {
  /** Buttons, badges, tags — anything that is pressed. */
  control: {
    radius: { var: '--we-theme-control-radius', fallback: 'var(--we-radius-400)' },
    gap: { var: '--we-theme-control-gap', fallback: 'var(--we-space-300)' },
  },

  /** Cards, modals, drawers, alerts — anything that is a sheet, and anything inset inside one. */
  surface: {
    radius: { var: '--we-theme-surface-radius', fallback: 'var(--we-radius-400)' },
    padding: { var: '--we-theme-surface-padding', fallback: 'var(--we-space-500)' },
    gap: { var: '--we-theme-surface-gap', fallback: 'var(--we-space-400)' },
  },

  /** Inputs, selects, textareas, and the pickers built on them. */
  input: {
    radius: { var: '--we-theme-input-radius', fallback: 'var(--we-radius-300)' },
  },

  /**
   * Avatars, and anything else square by construction.
   *
   * Its own family rather than a corner of `surface` because it is the only box here guaranteed
   * square, which is what makes a *percentage* radius safe — `50%` resolves per axis, so it is a
   * circle on a square box and an ellipse on anything else. Sharing with `surface` would mean a
   * theme that rounds its avatars turns every 16:9 video into an ellipse.
   */
  avatar: {
    radius: { var: '--we-theme-avatar-radius', fallback: '50%' },
  },

  /**
   * A full-bleed banner: the space header's cover, the profile page's.
   *
   * The `surface` family's variable with a **square** fallback, which is the entire difference
   * between the two names and the reason both exist. A banner spanning an edge is square until a
   * theme rounds it; a box *inset inside* a sheet takes the sheet's own rounding, because square
   * corners inside a rounded container read as a mistake rather than as a choice. A theme setting
   * `surfaceRadius` moves both together, which is right — they are one family, seen twice.
   */
  media: {
    radius: { var: '--we-theme-surface-radius', fallback: '0px' },
  },
} as const satisfies Record<string, Partial<Record<'radius' | 'padding' | 'gap', ThemeFamilyAxis>>>;

export type ThemeFamily = keyof typeof themeFamily;

/** The families offering a given axis — what makes the sparse matrix above a compile-time fact. */
type FamiliesWith<Axis extends string> = {
  [K in ThemeFamily]: Axis extends keyof (typeof themeFamily)[K] ? K : never;
}[ThemeFamily];

/** Names valid on `r` / `rt` / `rtl` / … */
export type SemanticRadius = FamiliesWith<'radius'>;

/** Names valid on `p` / `px` / `pt` / … — NOT on `m` or an offset, which read no family. */
export type SemanticPadding = FamiliesWith<'padding'>;

/** Names valid on `gap`. */
export type SemanticGap = FamiliesWith<'gap'>;

/** Every family name that is valid on some spacing prop. */
export type SemanticSpace = SemanticPadding | SemanticGap;

/**
 * `{ name: 'var(--theme-var, fallback)' }` for one axis — the form a resolver substitutes.
 *
 * Built here rather than in the resolver so the chain is written once and the two cannot disagree
 * about what a family means.
 */
export function semanticValues(axis: 'radius' | 'padding' | 'gap'): Record<string, string> {
  return Object.fromEntries(
    Object.entries(themeFamily)
      .filter(([, axes]) => axis in axes)
      .map(([name, axes]) => {
        const { var: themeVar, fallback } = (axes as Record<string, ThemeFamilyAxis>)[axis]!;
        return [name, `var(${themeVar}, ${fallback})`];
      }),
  );
}
