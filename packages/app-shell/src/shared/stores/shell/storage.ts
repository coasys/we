/**
 * Where the shell keeps the reader's arrangement on this device — placements, stacking, saved
 * layouts, home lanes, panel instances — and the reading of values stored by older versions.
 * Part of `ShellStore`; the reasoning for each key is beside it.
 */
import { type FloatPlacement } from '@shared/dockGeometry';
import { type PanelInstance } from '@shared/registries/panelInstances';

/**
 * Where panels are remembered, and why it is localStorage rather than the URL.
 *
 * Position and size are preferences about somebody's own window: sending a link should not impose
 * where the sender happened to park their video. The same reasoning `$localState`'s `persist` tier
 * carries, applied to state the host owns rather than a template.
 *
 * A read that fails is not worth a broken boot — a corrupt or foreign value simply means nobody has
 * moved anything yet, and every panel falls back to its module's bid.
 */
export const PLACEMENTS_KEY = 'we-local:shell.dockPlacements';

/**
 * Drop a stored `thickness`, which no longer means anything.
 *
 * It was one number for both axes, so a width solved for a side edge became a height on a top one,
 * and — until `fitPlacement` learned to decline — it could hold a value larger than any screen. Both
 * are fixed at the writing end, and neither fix reaches a number already in someone's browser: the
 * field is persisted, invisible while the panel floats, and applied the instant it docks again.
 *
 * Dropped rather than migrated onto an axis, because the two things a migration would have to know
 * are exactly the two that made it wrong. Which axis it was solved for is not recorded, and whether
 * the value is sane cannot be told from the number — the case that prompted this was 2378px, well
 * inside a 4K region and absurd on any edge. Falling back to the card is the documented behaviour and
 * the one people expect: a panel dragged to an edge keeps the width it had and gains the height.
 *
 * Costs a deliberately-resized dock its width, once. The field is a week old, one drag restores it,
 * and the alternative is carrying a number nothing can validate for as long as the browser keeps it.
 */
export function stripLegacyThickness(placements: Record<string, FloatPlacement>): Record<string, FloatPlacement> {
  return Object.fromEntries(
    Object.entries(placements).map(([id, placement]) => {
      if (!placement || typeof placement !== 'object' || !('thickness' in placement)) return [id, placement];
      const { thickness: _legacy, ...rest } = placement as FloatPlacement & { thickness?: number };
      return [id, rest];
    }),
  );
}

/**
 * Move a displacing panel's stored `order` onto `band`, which is what it always meant there.
 *
 * Before lanes, one number answered both of an edge's questions and `displace` chose which: a
 * displacing panel's `order` was *how far inboard*, a floating one's was *where along the edge*. Only
 * the first of those moved — `order` still means the second, everywhere — so a stored arrangement has
 * to be re-read in the coordinate that now owns it.
 *
 * Read as `order`, a strip somebody had arranged would come back as one lane of panels sharing the
 * edge's height: two full-height sidebars becoming two half-height ones, on next launch, with nothing
 * on screen explaining it. Migrated rather than dropped because unlike the legacy `thickness` this is
 * unambiguous — the number is a position, the flag beside it says which axis it was a position on,
 * and both are in the same record.
 *
 * Floating placements are untouched: their `order` already means what it still means.
 */
export function bandLegacyOrder(placements: Record<string, FloatPlacement>): Record<string, FloatPlacement> {
  return Object.fromEntries(
    Object.entries(placements).map(([id, placement]) => {
      if (!placement || typeof placement !== 'object') return [id, placement];
      if (!placement.displace || placement.band !== undefined || placement.order === undefined) return [id, placement];
      // `order: 0` afterwards, not absent: it is alone in the lane it just named, and leaving it
      // absent would sort it after any lane-mate it later gains.
      return [id, { ...placement, band: placement.order, order: 0 }];
    }),
  );
}

export function loadPlacements(): Record<string, FloatPlacement> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PLACEMENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, FloatPlacement>) : {};
    return parsed && typeof parsed === 'object' ? bandLegacyOrder(stripLegacyThickness(parsed)) : {};
  } catch {
    return {};
  }
}

/**
 * The write, deferred to the end of the frame.
 *
 * ## Why it cannot be synchronous
 *
 * `writePlacement` runs on every `pointermove` of a drag or a resize, which is once per frame — and
 * each call serialised the whole placement map and wrote it to localStorage. `setItem` is
 * synchronous and hits the disk, so a drag was doing blocking I/O at 60Hz, at the exact moment the
 * app is trying to track a cursor. Nothing about it needs to be immediate: the value being persisted
 * is where a panel *ended up*, and every frame but the last is a position nobody asked to keep.
 *
 * A microtask rather than a debounce, so a single write is still on disk before the next turn of the
 * event loop and nothing has to reason about how long the tail is. Coalescing means a drag of 300
 * frames writes once when it settles.
 */
export let pendingPlacements: Record<string, FloatPlacement> | null = null;

export function flushPlacements(): void {
  const placements = pendingPlacements;
  pendingPlacements = null;
  if (!placements || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PLACEMENTS_KEY, JSON.stringify(placements));
  } catch {
    // A full or disabled store costs the user their layout next boot, and nothing else.
  }
}

/**
 * How recently each panel was touched, by placement key — the whole of z-order.
 *
 * Beside the placements rather than inside them, because it is not a placement: a placement says
 * *where*, and `layoutPinned` reads the existence of one as "somebody moved this away from what the
 * template asked for". A click is not that. Held in a map of its own, raising a panel pins nothing.
 *
 * Persisted, so a reload keeps the stacking — and, once seats can hold several panels, which tab
 * was showing. Written straight through rather than coalesced: a click is one write, not a drag.
 */
export const ACTIVATION_KEY = 'we-local:shell.dockActivation';

export function loadActivation(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVATION_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function saveActivation(activation: Record<string, number>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ACTIVATION_KEY, JSON.stringify(activation));
  } catch {
    // Lost stacking order on next boot, and nothing else.
  }
}

/**
 * Named arrangements, by template scope and then by name — see `saveLayout`.
 *
 * A layout is a snapshot of everything the three-rung chain holds for one interface: its panels'
 * placements, which tab of each seat was showing, and which panels were closed. Keyed under the
 * scope the placements themselves are keyed under, so "Recording" for the Workshop is not offered
 * while the Timeline is on screen.
 */
export const LAYOUTS_KEY = 'we-local:shell.dockLayouts';

export interface SavedLayout {
  placements: Record<string, FloatPlacement>;
  activation: Record<string, number>;
  closed: Record<string, boolean>;
  /** Home lanes' widths and folds. Absent in a layout saved before lanes could be resized. */
  lanes?: Record<string, LaneState>;
}

/**
 * A home lane as the reader has left it: dragged to a width, or folded away. Keyed like placements,
 * `<template scope>::<lane>`, so one template's sidebar width is not another's.
 */
export interface LaneState {
  width?: number;
  collapsed?: boolean;
}

export const LANES_KEY = 'we-local:shell.lanes';

/** Every interface's open panel instances, by interface — see `PanelInstance`. */
export const INSTANCES_KEY = 'we-local:shell.panelInstances';

/*
 * Instances are kept under the agent's DID: an app-scope chat carries a perspective id, and a
 * logout that does not reload hands the screen to the next agent — unkeyed, they would see the
 * last one's. `load`/`save` take the DID; it is provided once the session knows who is signed in.
 */
export function loadInstances(did: string): Record<string, Record<string, PanelInstance>> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(INSTANCES_KEY) ?? '{}') as unknown;
    const perAgent =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, Record<string, Record<string, PanelInstance>>>)
        : {};
    const mine = perAgent[did];
    return mine && typeof mine === 'object' && !Array.isArray(mine) ? mine : {};
  } catch {
    return {};
  }
}

export function saveInstances(did: string, all: Record<string, Record<string, PanelInstance>>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const parsed = JSON.parse(localStorage.getItem(INSTANCES_KEY) ?? '{}') as unknown;
    const perAgent =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
    if (Object.keys(all).length) perAgent[did] = all;
    else delete perAgent[did];
    localStorage.setItem(INSTANCES_KEY, JSON.stringify(perAgent));
  } catch {
    // The instances open now stay open; a reload starts without them.
  }
}

export function loadLanes(): Record<string, LaneState> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(LANES_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, LaneState>) : {};
  } catch {
    return {};
  }
}

export function saveLanes(lanes: Record<string, LaneState>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LANES_KEY, JSON.stringify(lanes));
  } catch {
    // A lane back at its template's width on next boot, and nothing else.
  }
}

export type SavedLayouts = Record<string, Record<string, SavedLayout>>;

export function loadLayouts(): SavedLayouts {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(LAYOUTS_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as SavedLayouts) : {};
  } catch {
    return {};
  }
}

export function saveLayouts(layouts: SavedLayouts): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
  } catch {
    // Lost named layouts on next boot, and nothing else.
  }
}

export function savePlacements(placements: Record<string, FloatPlacement>): void {
  const first = pendingPlacements === null;
  pendingPlacements = placements;
  if (first) queueMicrotask(flushPlacements);
}
