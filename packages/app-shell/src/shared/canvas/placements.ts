/**
 * A card's placement on a canvas, as plain rules: which stored row a write lands on, what a write
 * records to put back, and when a replay still finds what it left.
 *
 * The record store reads the rows and writes through the canvas operations; these are what it decides
 * in between.
 */
import { PLACEMENT_UNSET, resolvePlacement } from '@we/graph-expanders';

/**
 * A stored placement, as the store reads one back.
 *
 * Loose beyond the three fields anything here names, because the interesting use is putting a
 * *whole* placement back: undoing "take these cards off the canvas" has to restore the size, colour,
 * shape and stacking they were wearing, and a type listing those by name would have to be extended
 * every time a placement grows a field — which is precisely the day it would be forgotten and the
 * undo would quietly restore a card stripped of its presentation.
 */
export type PlacementRow = { id: string; node?: string; tier?: string } & Record<string, unknown>;

/** A point on a canvas. */
export interface Spot {
  x: number;
  y: number;
}

/**
 * The placement a canvas draws for one node — the row a write to that card has to land on — and the
 * rows it outranks.
 *
 * Chosen by `resolvePlacement`, the canvas seed's own rule, rather than by `find`. Two people placing
 * the same card before either placement syncs leave two rows, and a writer taking the first while
 * the canvas drew another sent every later drag to a row nobody saw: the card snapped back, for
 * everyone, however often it was moved.
 *
 * The rows it outranks are the write's to delete (`core.placeCard` takes them). They were never
 * drawn, so nothing visible is lost, and the pick is a function of the rows alone — every peer
 * holding the same rows keeps the same one, so two peers tidying at once cannot each delete the
 * other's survivor. Only rows at the survivor's own tier: a placement for another breakpoint is not a
 * duplicate of it.
 */
export function drawnAmong(
  rows: readonly PlacementRow[],
  nodeId: string,
): { drawn?: PlacementRow; duplicates: string[] } {
  const mine = rows.filter((row) => row.node === nodeId);
  const drawn = resolvePlacement(mine);
  if (!drawn) return { duplicates: [] };
  const duplicates = mine
    .filter((row) => row !== drawn && (row.tier ?? '') === (drawn.tier ?? ''))
    .map((row) => row.id);
  return { drawn, duplicates };
}

/** Where a stored placement puts its card; a missing coordinate is 0. */
export const spotOf = (row: Record<string, unknown>): Spot => ({ x: Number(row.x) || 0, y: Number(row.y) || 0 });

/**
 * Two coordinates within a pixel of each other.
 *
 * Exact equality is the wrong test against a value that has been through a float, a JSON encode
 * and a peer: a card that came back as 400.00000000000006 is a card nobody moved, and an undo
 * that refused because of it would be refusing for a reason no person could see.
 */
export const sameSpot = (a: Spot, b: Spot) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;

/**
 * Whether a stored presentation value is the one a replay expects to find.
 *
 * Normalised the same way {@link styleBaseline} records a baseline, because the two have to agree: a
 * field that holds nothing is recorded as the value the canvas seed reads as *absent* — the
 * sentinel for text, `0` for a number — so a redo expecting "it was unset" has to match a row
 * where the field is genuinely missing.
 *
 * Numbers compare with a pixel of tolerance, for the reason `sameSpot` does: a width that came
 * back as 300.00000000000006 is a width nobody changed, and refusing on that is refusing for a
 * reason no person could see.
 */
export function sameStored(held: unknown, want: unknown): boolean {
  const normalised = held === undefined || held === '' ? (typeof want === 'number' ? 0 : PLACEMENT_UNSET) : held;
  if (typeof want === 'number' && typeof normalised === 'number') return Math.abs(want - normalised) < 1;
  // Placement fields hold scalars; anything else compares by its JSON rather than as "[object Object]".
  const text = (value: unknown) =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : JSON.stringify(value);
  return text(normalised) === text(want);
}

/**
 * What every field in a patch held before, read off the row the write is about to land on — the
 * baseline an undo puts back.
 *
 * **All of them, not the first.** A resize writes a width, a height and both coordinates as one
 * act, and a baseline that carried only the width could put back a card of the right size in
 * the wrong place.
 *
 * A field that held nothing goes back as the value the canvas seed reads as *absent*, because
 * undoing "give these cards a colour" has to be able to say "back to no colour of its own" —
 * and an empty string is exactly what the model layer's update skips, so it cannot be stored. For
 * text that is `PLACEMENT_UNSET`; for a number it is `0`, which `placementStyle` drops the same
 * way.
 */
export function styleBaseline(row: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(patch).map((field) => {
      const held = row[field];
      if (held !== undefined && held !== '') return [field, held];
      return [field, typeof patch[field] === 'number' ? 0 : PLACEMENT_UNSET];
    }),
  );
}

/**
 * Whether a row still holds everything a replay expects of it — all or nothing per card, because a
 * resize writes four fields as one act: putting half of it back would leave a card at the old size
 * in the new place.
 */
export const stillHolds = (row: Record<string, unknown>, expect: Record<string, unknown>) =>
  Object.entries(expect).every(([field, want]) => sameStored(row[field], want));

/**
 * What describes a card on a placement, without what identifies the row or records who wrote it when —
 * the fields a card taken off is put back with. A fresh record carries a new id: nothing points at a
 * placement, so there is nothing for that to break.
 */
export function placementFieldsOf(row: PlacementRow): Record<string, unknown> {
  const {
    id: _id,
    node: _node,
    author: _author,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    timestamp: _timestamp,
    ...fields
  } = row;
  return fields;
}

/** The presentation a placement may carry, and the only keys `setCardStyle` will write. */
export const CARD_STYLE_FIELDS = ['width', 'height', 'contentScale', 'rotation', 'z', 'color', 'cardShape'] as const;

/**
 * One presentation field, as a value the placement can hold — or undefined for a field a card does
 * not carry.
 *
 * Accepts an event or a raw value: a `we-slider` hands back `$event.detail`, but a swatch button
 * has no detail to pass and sends the value itself. Reading both means the template says what it
 * means at every call site instead of choosing between an action per control and a wrapper.
 *
 * The empty string becomes `PLACEMENT_UNSET`, because an empty string cannot be *stored*: the
 * model layer's update skips `''` exactly as it skips `undefined`, so "no colour of its own" would be
 * unwritable — a card could be given an override and never have it taken away. A named value the
 * canvas seed drops is the same trick `SpacePreference` uses for its two sentinels.
 */
export function cardStyleValue(field: string, value: unknown): string | number | undefined {
  if (!(CARD_STYLE_FIELDS as readonly string[]).includes(field)) return undefined;
  const raw = value !== null && typeof value === 'object' && 'detail' in value ? value.detail : value;
  if (typeof raw === 'number') return raw;
  return typeof raw === 'string' && raw ? raw : PLACEMENT_UNSET;
}

/**
 * A colour as a template hands one over — a picker's event or the value itself — as a value a style
 * record can hold: the colour, or `PLACEMENT_UNSET` to clear it, since `''` cannot be stored.
 */
export function colorValue(color: unknown): string {
  const raw = color !== null && typeof color === 'object' && 'detail' in color ? color.detail : color;
  return typeof raw === 'string' && raw ? raw : PLACEMENT_UNSET;
}
