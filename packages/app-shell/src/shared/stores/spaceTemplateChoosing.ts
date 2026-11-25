/**
 * A space arrived in with no template put up for it yet.
 *
 * Opening a space after a reboot, its templates — or the app's own one for spaces — may not have
 * been read yet, and the template on screen is then the one before: the landing page's, or another
 * space's. The space's address was drawn in it, so the landing page's content (the spaces, as cards)
 * flashed up before the space's own template arrived. Only the first time: after that the templates
 * are held, and the switch happens in the same breath as the arrival.
 *
 * So the template store says when it arrives without having put anything up (`start`), and the host
 * shows that it is loading for as long as that names the space on screen. Raised by the arrival
 * rather than derived from "not yet settled", which is true for a moment on *every* switch — a space
 * whose template is held and found must not show anything else for a frame. Lowered when a template
 * is put up or choosing ends (`done`), and after a while regardless, so a template that never arrives
 * cannot hold the space behind a spinner.
 *
 * Its own module, with its input passed in, so it is tested against real signals rather than through
 * the session stack the template store sits on — as `spaceRecordWait.ts` is.
 */
import type { ReactivityPort } from '@we/reactivity';

export const CHOOSING_GIVE_UP_MS = 10_000;

export function createSpaceTemplateChoosing(deps: {
  reactivity: Pick<ReactivityPort, 'signal' | 'untrack'>;
  currentId: () => string | null;
}) {
  const { signal, untrack } = deps.reactivity;
  const [choosingFor, writeChoosingFor] = signal<string | null>(null);
  /*
    Compared first: `done` is called on every template put up, nearly always with nothing waiting,
    and whether an equal write wakes the readers of `choosing` is not something the port promises.
  */
  const setChoosingFor = (id: string | null) => {
    if (untrack(choosingFor) !== id) writeChoosingFor(id);
  };
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  return {
    /** Arrived in this space with nothing put up for it. */
    start(id: string) {
      setChoosingFor(id);
      if (giveUp !== undefined) clearTimeout(giveUp);
      giveUp = setTimeout(() => {
        if (untrack(choosingFor) === id) setChoosingFor(null);
      }, CHOOSING_GIVE_UP_MS);
    },
    /** A template was put up, or choosing for this space ended — `id` absent for any space. */
    done(id?: string) {
      if (id === undefined || untrack(choosingFor) === id) setChoosingFor(null);
    },
    /** Whether the space on screen is still waiting for its template — reactive. */
    choosing() {
      const id = deps.currentId();
      return !!id && choosingFor() === id;
    },
  };
}
