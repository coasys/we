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
import { createSignal } from 'solid-js';

export const CHOOSING_GIVE_UP_MS = 10_000;

export function createSpaceTemplateChoosing(deps: { currentId: () => string | null }) {
  const [choosingFor, setChoosingFor] = createSignal<string | null>(null);
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  return {
    /** Arrived in this space with nothing put up for it. */
    start(id: string) {
      setChoosingFor(id);
      if (giveUp !== undefined) clearTimeout(giveUp);
      giveUp = setTimeout(() => {
        if (choosingFor() === id) setChoosingFor(null);
      }, CHOOSING_GIVE_UP_MS);
    },
    /** A template was put up, or choosing for this space ended — `id` absent for any space. */
    done(id?: string) {
      if (id === undefined || choosingFor() === id) setChoosingFor(null);
    },
    /** Whether the space on screen is still waiting for its template — reactive. */
    choosing() {
      const id = deps.currentId();
      return !!id && choosingFor() === id;
    },
  };
}
