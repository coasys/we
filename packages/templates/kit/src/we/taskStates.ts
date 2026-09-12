/**
 * What a state looks like — the colour of a card in it, and the shape that stands for it.
 *
 * Two surfaces answer this and they had drifted: the workshop's key drew its own chain of fills, and
 * Settings → Vocabulary drew its own chain of icons, so a state renamed in one place kept a
 * different glyph in the other and the key's colours were reachable from nowhere at all. One table
 * here, read by both, and by anything that renders a state next.
 *
 * ## Why these are absolute colours and not roles
 *
 * The fills were `accent-muted`, `success-surface` and `warning-surface` — roles, which is normally
 * the right answer and is the wrong one here. Those roles are *tinted panels inset on a page*: they
 * are steps on a ramp that inverts with the theme's polarity, and they get their separation from a
 * border rather than from the ground. Measured against the built-in presets:
 *
 * ```
 *                                   light L%   dark L%
 * canvas ground (page)                 100       20
 * a plain card  (neutral-200)          84.5      35.7
 * "doing"       (primary-100)          92.5      27.6   ← darker than an uncoloured card
 * "done"        (success-50)           96.0      24.0   ← four points off the ground
 * ```
 *
 * So in a dark theme a finished task nearly merged into the canvas and the coloured states read as
 * *less* present than the uncoloured ones, and in a light theme "done" was four points off white.
 * No choice of step fixes both, because the step that is a pale tint in one polarity is a near-black
 * in the other.
 *
 * A card is not a panel on a page. It is an object on a surface, and a green card should be green in
 * both themes — which is what the workshop's post-it already asserted in a comment and a hex. These
 * are that, generalised: one lightness, a hue per meaning, the same value in every theme. The graph
 * inks a card's label from the lightness of its fill rather than from the theme's, so they stay
 * readable; each sits inside sRGB at its hue, so nothing is gamut-mapped into a different colour.
 *
 * This is the palette exception the conventions name — "a graph fragment colouring nodes by category
 * is choosing from a scale on purpose". A theme should not be able to recolour *finished* into
 * *stuck*, which is exactly what a role would let it do.
 *
 * The **plain card** is the deliberate counterexample and stays a neutral ramp step, in the template
 * that draws it: it is the absence of a colour rather than a colour, so following the theme's
 * polarity is the whole of what it should do.
 */

/**
 * The colour a card takes from its state, where nobody has chosen one.
 *
 * Keyed by `semantic` rather than by slug, because the slug is the community's word and the semantic
 * is the closed fact underneath it — a space that renames "Done" to "Shipped" keeps the green, and
 * one that invents "Parked" gets the dropped-work grey without anybody picking it.
 *
 * `open` has a colour of its own rather than falling through to the plain card, which is what it did
 * until now. Sharing meant a to-do task and a card that is not a task at all — a note, an event —
 * were drawn identically, so the lens that exists to say what state something is in said nothing
 * about the most common state there is. Plain now means *no state*, which is what the key claims.
 */
export const STATE_FILLS: Record<string, string> = {
  /** Not started, nobody on it — tinted just enough to be a colour rather than a default. */
  open: 'oklch(90% 0.012 288)',
  /** Being worked on. */
  active: 'oklch(90% 0.045 250)',
  /** Stuck, waiting on something. Coral rather than red: a blocked card is not an error. */
  blocked: 'oklch(90% 0.048 25)',
  /** Finished. */
  done: 'oklch(90% 0.06 150)',
  /** Dropped — not finished, not outstanding. Flat and a shade darker, so it recedes. */
  cancelled: 'oklch(87% 0.008 288)',
};

/**
 * How an unrecognised semantic is drawn.
 *
 * Every chain over `semantic` in the app ends in the outstanding branch rather than in an error, so
 * a value a peer's older code does not recognise reads as "still to do" — see `SEMANTIC_LABEL` in
 * the vocabulary section for the same rule stated about words.
 */
const FALLBACK = 'open';

/** The chain, written once, over an expression answering a semantic. */
function chain(semantic: string, table: Record<string, string>): string {
  const rest = Object.entries(table)
    .filter(([value]) => value !== FALLBACK)
    .map(([value, answer]) => `${semantic} == '${value}' ? '${answer}' : `)
    .join('');
  return `(${rest}'${table[FALLBACK]}')`;
}

/**
 * The fill for a semantic, as an expression over whatever answers one.
 *
 * Separate from `stateFill` because a *form* has a semantic before it has a state: the new-state and
 * edit-state modals both preview the colour a state would take from the picker beside the semantic
 * select, and neither has a record to read.
 */
export function stateFillFor(semantic: string): string {
  return chain(semantic, STATE_FILLS);
}

/**
 * A state's fill: the colour the community picked for it, else the table above.
 *
 * `state` is an expression naming the state — `'state'` inside a `$each` over
 * `spaceStore.taskStates`, or any other name the caller bound.
 *
 * The community's own colour is used **raw**, as it was picked, wherever it is read. A colour chosen
 * to be a card is not automatically a good foreground, and the day something needs a derivation it
 * can have one — but two colours to keep in step is a worse problem than one that is occasionally
 * pale, and nothing in the app derives anything from it today.
 */
export function stateFill(state: string): string {
  return `(${state}.color ? ${state}.color : ${stateFillFor(`${state}.semantic`)})`;
}

/** The shape a state takes, where the community has not picked an icon for it. */
export const STATE_ICONS: Record<string, string> = {
  open: 'circle',
  active: 'circle-half',
  blocked: 'warning-circle',
  done: 'check-circle',
  cancelled: 'x-circle',
};

/** The glyph for a semantic, for a form that has one before it has a state. */
export function stateIconFor(semantic: string): string {
  return chain(semantic, STATE_ICONS);
}

/** A state's glyph: the community's own where it chose one, else the shape for what it counts as. */
export function stateIcon(state: string): string {
  return `(${state}.icon ? ${state}.icon : ${stateIconFor(`${state}.semantic`)})`;
}
