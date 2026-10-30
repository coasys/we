/**
 * The colour a kind of record is drawn in — one rule for the canvas's cards, the chooser that makes
 * them and the record form, wherever a template draws kinds.
 *
 * ## The community's, else the kind's own hue
 *
 * A space can colour a kind (`Space.typeStyles`, a `TypeStyle` row per kind — the workshop's key
 * sets them). Where it has not, the kind's own hue is drawn: `recordStore.kinds[].hue`, a palette
 * hue WE chose for each of its own kinds and one taken from the name for any other, so a
 * community's newest model is coloured the moment it exists.
 *
 * ## Palette hues, so the theme decides how they look
 *
 * Kinds are categories, and categories are what a theme's palette is for (status takes the semantic
 * families). A hue is drawn through the theme's roles for it: a card in `<hue>-soft`, the tint the
 * theme tunes for a coloured panel, and a glyph in `<hue>-text`. So a pastel theme draws pastel
 * cards and a dark one keeps them readable, which the hex table these replaced did not.
 *
 * A colour the community chose is drawn as chosen when it is not a palette name — a `var(…)` from
 * the picker's token grid, a hex from its custom tab — since it was picked as the thing itself.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { PALETTE_HUES } from '@we/tokens';

/**
 * The space's colours by kind, as a query. Declare it on whatever reads the expressions below; a
 * route's locals do not reach a panel, and reset at a `$routes` outlet.
 *
 * `when`, because an unresolved anchor is pruned rather than refused and pruning widens: without it
 * the first frame would ask for every `TypeStyle` in the dataset.
 */
export const KIND_STYLES_QUERY = {
  entity: 'TypeStyle',
  scope: { anchor: 'Space', via: 'typeStyles', anchorId: { $: 'spaceStore.currentSpace.id' } },
  limit: 50,
  when: { $: 'spaceStore.currentSpace.id' },
};

/** The palette's hues as a list literal, for `in`. */
const PALETTE = `[${PALETTE_HUES.map((hue) => `'${hue}'`).join(', ')}]`;

/** The colour the community chose for a kind, if any. `kind` is an expression naming it. Reads `local.typeStyles`. */
export function kindChosen(kind: string): string {
  return `find(local.typeStyles, { nodeType: ${kind} }).color`;
}

/** A kind's own hue, before anybody chooses. */
function kindHue(kind: string): string {
  return `find(recordStore.kinds, { value: ${kind} }).hue`;
}

/** The kind's colour as stored: the community's, else its own hue — a palette name, or CSS as chosen. */
export function kindColour(kind: string): string {
  return `(${kindChosen(kind)} ? ${kindChosen(kind)} : ${kindHue(kind)})`;
}

/** A colour through one of its hue's roles when it is a palette name, else `other`. */
const through = (colour: string, role: string, other: string) =>
  `((${colour}) in ${PALETTE} ? (${colour}) + '-${role}' : ${other})`;

/** What a card of the kind is filled with: its hue's tint, or the colour as chosen. */
export function kindCardFill(kind: string): string {
  return through(kindColour(kind), 'soft', kindColour(kind));
}

/** A glyph standing for the kind — in a chooser, a form's header: its hue's text colour, or the colour as chosen. */
export function kindGlyph(kind: string): string {
  const colour = kindColour(kind);
  return through(colour, 'text', `(${colour} ? ${colour} : 'text')`);
}

/** The disc behind that glyph: its hue's tint, or the raised surface a chosen colour sits on. */
export function kindDisc(kind: string): string {
  return through(kindColour(kind), 'soft', "'surface-raised'");
}

/**
 * A graph's colour rule for every kind, for a `nodeStyle` list — after the card's base rule, before
 * a card's own colour (`PLACED_CARD_STYLE`) and the suggestion styles, which must win over it.
 */
export const KIND_CARD_RULES: SchemaProp = {
  $: `recordStore.kinds.map(k, { when: { type: k.value }, style: { color: ${kindCardFill('k.value')} } })`,
};

/** A node's `$queries`, with the space's colours by kind beside whatever else it declares. */
export function withKindStyles(node: SchemaNode): SchemaNode {
  return { ...node, $queries: { ...(node.$queries ?? {}), typeStyles: KIND_STYLES_QUERY } };
}
