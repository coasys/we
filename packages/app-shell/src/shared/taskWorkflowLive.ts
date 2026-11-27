/**
 * The space's task workflow as the board draws it — the latest snapshot of its runs, and the rules its
 * states ask for. `null` where the space asks for no agreement.
 *
 * A module singleton rather than a member of `spaceStore`, for `boardOptimism`'s reason: it is wiring
 * between the store that watches the workflow and the host function that draws the board, and neither
 * useful to a template nor something a template should be able to name. A template reads what the
 * board makes of it — `arrangedBoard(…).workflow` — which is the reading, not the raw runs.
 */
import type { ReactivityPort } from '@we/reactivity';

import type { TaskWorkflowView } from './taskWorkflow';

export type TaskWorkflowLive = ReturnType<typeof createTaskWorkflowLive>;

/** One app's workflow on screen. The app keeps one (`frameworks/solid/hostState.ts`). */
export function createTaskWorkflowLive(signal: ReactivityPort['signal']) {
  const [view, setView] = signal<TaskWorkflowView | null>(null);
  return {
    /** The workflow on screen, or `null`. Reactive: reading it makes the caller redraw when it changes. */
    view,
    /** What `SpaceStore` calls when a snapshot arrives, the rules change, or the space does. */
    set: (next: TaskWorkflowView | null) => void setView(next),
  };
}
