/**
 * The space on screen: its record as last shown, and which of the records shown came from the live
 * read. Part of `SpaceStore` — see `../SpaceStore.ts`.
 *
 * Held apart from the navigation part, which follows the record live and fills this, because most of
 * the other parts need only to read it — the roles, the modules, the task states — and the writes
 * part needs to show a change on it. Navigation in turn reads what a default save is still painting
 * from the writes part, so with the record held there the two would need each other. Held here, the
 * writes and the readers are built before navigation and each takes only this.
 */
import type { Space } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';

import { updatingSignal } from '../../distinctSignal';
import { isSpaceSelf, withFields } from '../../spaceSync';
import type { AppDataset } from '../DatasetStore';

export function createSpaceOnScreen(reactivity: ReactivityPort) {
  const [currentSpace, setCurrentSpace, updateCurrentSpace] = updatingSignal<Space | null>(reactivity, null);

  /**
   * Space records exactly as the live read delivered them — not a copy made for an optimistic write.
   * The task states read the state order off a pushed record (the read includes it) rather than
   * reading the record again; a copy may predate a reorder.
   */
  const pushedSpaces = new WeakSet<Space>();

  /** Show a record the live read delivered, or nothing. Navigation's, which follows the read. */
  function showPushed(space: Space | null): void {
    if (space) pushedSpaces.add(space);
    setCurrentSpace(space);
  }

  /**
   * Show fields on the space on screen, when it is that dataset's own record — a switch moves the
   * dataset ahead of the record, so the record shown may still be the space being left's.
   */
  function showOnScreen(ds: AppDataset, fields: Partial<Space>): void {
    updateCurrentSpace((prev) => (prev && isSpaceSelf(prev, ds) ? withFields(prev, fields) : prev));
  }

  /** Whether a record is one the live read delivered, rather than a copy made for a write. */
  const pushedOnScreen = (space: Space): boolean => pushedSpaces.has(space);

  return { currentSpace, showPushed, showOnScreen, pushedOnScreen };
}

export type SpaceOnScreen = ReturnType<typeof createSpaceOnScreen>;
