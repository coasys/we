/**
 * Waiting for a space's own record before deciding which template it shows.
 *
 * Its default template lives on its `Space` record, which reaches a new member by sync, after the
 * join itself has finished — seconds later on a peer-to-peer space. The template store decided once,
 * on arrival, and found nothing: the agent's own default stood in, the space was marked settled, and
 * the section guard took a link into the space's own template (the Workshop's `/canvas?call=…`) for
 * a section it does not have and rewrote it to `/about`. When the record arrived nothing asked
 * again, so the space stayed in the wrong template until a reload.
 *
 * So a space whose record is missing stays pending, and the choice is made again the moment the
 * record — and the template it names — are here. Pending has a limit, because a dataset that is not
 * a WE space never gets a record, and the guard must not wait on it for ever. Past the limit the
 * space is settled with what is on screen, and the record still applies its template if it turns up.
 *
 * Its own module, with its inputs passed in, so the reactive behaviour is tested against real
 * signals and effects rather than through the whole session stack the template store sits on.
 */
import { createEffect, createSignal, onCleanup, untrack } from 'solid-js';

export const SPACE_RECORD_PATIENCE_MS = 30_000;

export interface SpaceRecordWaitDeps {
  /** The dataset on screen, read reactively. */
  currentId: () => string | null;
  /** That dataset's `Space` record as this agent holds it — reactive — or undefined until it syncs. */
  spaceOf: () => { defaultTemplateId?: string } | undefined;
  /** Whether a template by this id is loaded — reactive, since a space's own template syncs too. */
  hasTemplate: (id: string) => boolean;
  /** Choose the space's template again, now that its record is here. */
  choose: () => Promise<void>;
  /** Mark the space's template question answered. */
  settle: (datasetId: string) => void;
  patienceMs?: number;
}

/**
 * Start waiting with `wait(datasetId)`; `waiting()` is the dataset waited on, or null. Must be called
 * inside a reactive owner.
 */
export function createSpaceRecordWait(deps: SpaceRecordWaitDeps): {
  wait: (datasetId: string) => void;
  waiting: () => string | null;
} {
  const [waiting, setWaiting] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => timer && clearTimeout(timer));

  createEffect(() => {
    const id = waiting();
    if (!id) return;
    if (deps.currentId() !== id) {
      // Left before the record arrived. The next space's own decision is its own.
      setWaiting(null);
      return;
    }
    const space = deps.spaceOf();
    if (!space) return;
    const named = space.defaultTemplateId;
    if (named && !deps.hasTemplate(named)) return;
    setWaiting(null);
    void untrack(deps.choose).finally(() => {
      if (untrack(deps.currentId) === id) deps.settle(id);
    });
  });

  return {
    waiting,
    wait(datasetId) {
      setWaiting(datasetId);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (untrack(waiting) === datasetId) deps.settle(datasetId);
      }, deps.patienceMs ?? SPACE_RECORD_PATIENCE_MS);
    },
  };
}
