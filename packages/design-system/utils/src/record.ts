/**
 * "This box stands for that record" — the design system's marker for a **record-anchored decoration**.
 *
 * ## What it is for
 *
 * A live cursor, a highlight on something an extraction pass touched, a comment pin, "two people are
 * reading this": each of them is a mark that belongs at a record rather than at a coordinate, and each
 * needs the same answer from the DOM — which box is that record, and where is it right now. In a flow
 * layout there is nothing else durable to measure against: a kanban column is wherever the columns
 * before it ended, so a pixel offset means a different place on a screen with a different width, and a
 * DOM path means a different place the moment a template rearranges itself. The card is the one thing
 * two agents are guaranteed to agree about.
 *
 * ## Who sets it
 *
 * `we-draggable` sets it from its own `recordId`, which covers the great majority of cards for free —
 * anything a person can pick up is something a mark can be anchored to, and both are the same id. Any
 * other surface that wants to be anchorable stamps it on the element standing for the record.
 *
 * ## Reading it: the marker may have no box
 *
 * `we-draggable` is `display: contents` by design — a wrapper that existed as a box would take the
 * grid track its card was meant to occupy — so the marker is frequently on an element whose
 * `getBoundingClientRect()` is empty, with the real box one level down. Anything resolving this must
 * fall back to the first child that has a box, which is the same rule `we-sortable` already follows
 * for `data-we-id`. Measuring the marker blindly gives a zero rect, and every fraction computed
 * against it collapses to a corner.
 */
export const RECORD_ATTR = 'data-we-record';
