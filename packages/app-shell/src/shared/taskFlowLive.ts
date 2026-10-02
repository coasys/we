/**
 * The space's task flow as the board draws it — the latest snapshot of its runs, and the rules its
 * states ask for. `null` where the space asks for no agreement.
 *
 * A module singleton rather than a member of `spaceStore`, for `boardOptimism`'s reason: it is wiring
 * between the store that watches the flow and the host function that draws the board, and neither
 * useful to a template nor something a template should be able to name. A template reads what the
 * board makes of it — `arrangedBoard(…).flow` — which is the reading, not the raw runs.
 */
import { createSignal } from 'solid-js';

import type { TaskFlowView } from './taskFlow';

const [view, setView] = createSignal<TaskFlowView | null>(null);

export const taskFlowLive = {
  /** The flow on screen, or `null`. Reactive: reading it makes the caller redraw when it changes. */
  view,
  /** What `SpaceStore` calls when a snapshot arrives, the rules change, or the space does. */
  set: (next: TaskFlowView | null) => void setView(next),
};
