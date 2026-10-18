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
 * So a space whose record is missing stays pending, and the choice is made the moment the record —
 * and the template it names — are here. The host shows "Loading space data…" for as long as
 * `waiting()` names the space on screen, so it stays named until the choice has been *applied*:
 * released before, the router remounted with whatever template was current, and the agent's default
 * flashed up for the moment the choice took.
 *
 * A record also arrives in pieces — the `Space` first, its `defaultTemplateId` a moment later — and
 * a space need not name a default at all, so a record naming none is given a short grace for one to
 * arrive. Without it, a new member was shown the agent's default for a second and then the space's.
 *
 * Pending has a limit, because a dataset that is not a WE space never gets a record and the guard
 * must not wait on it for ever. Past the limit the space is settled and the loading is over; a
 * record that turns up later is the template store's to follow, as any change to a settled space's
 * default is.
 *
 * Its own module, with its inputs passed in, so the reactive behaviour is tested against real
 * signals and effects rather than through the whole session stack the template store sits on.
 */
import { createEffect, createSignal, onCleanup, untrack } from 'solid-js';

export const SPACE_RECORD_PATIENCE_MS = 30_000;
export const NO_DEFAULT_GRACE_MS = 3_000;

export interface SpaceRecordWaitDeps {
  /** The dataset on screen, read reactively. */
  currentId: () => string | null;
  /** That dataset's `Space` record as this agent holds it — reactive — or undefined until it syncs. */
  spaceOf: () => { defaultTemplateId?: string } | undefined;
  /** Whether a template by this id is loaded — reactive, since a space's own template syncs too. */
  hasTemplate: (id: string) => boolean;
  /** Choose the space's template, now that its record is here. Resolves once it is applied. */
  choose: () => Promise<void>;
  /** Mark the space's template question answered. */
  settle: (datasetId: string) => void;
  patienceMs?: number;
  /** How long a record naming no default waits for one to arrive. */
  noDefaultGraceMs?: number;
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
  const [graceOver, setGraceOver] = createSignal(false);
  let patience: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let choosing = false;

  const stop = () => {
    if (patience) clearTimeout(patience);
    if (grace) clearTimeout(grace);
    patience = grace = undefined;
    setWaiting(null);
  };
  onCleanup(stop);

  createEffect(() => {
    const id = waiting();
    if (!id || choosing) return;
    if (deps.currentId() !== id) {
      // Left before the record arrived. The next space's own decision is its own.
      stop();
      return;
    }
    const space = deps.spaceOf();
    if (!space) return;
    const named = space.defaultTemplateId;
    if (!named && !graceOver()) {
      grace ??= setTimeout(() => setGraceOver(true), deps.noDefaultGraceMs ?? NO_DEFAULT_GRACE_MS);
      return;
    }
    if (named && !deps.hasTemplate(named)) return;
    choosing = true;
    void untrack(deps.choose).finally(() => {
      choosing = false;
      if (untrack(waiting) !== id) return;
      stop();
      if (untrack(deps.currentId) === id) deps.settle(id);
    });
  });

  return {
    waiting,
    wait(datasetId) {
      stop();
      setGraceOver(false);
      setWaiting(datasetId);
      patience = setTimeout(() => {
        if (untrack(waiting) !== datasetId) return;
        stop();
        deps.settle(datasetId);
      }, deps.patienceMs ?? SPACE_RECORD_PATIENCE_MS);
    },
  };
}
