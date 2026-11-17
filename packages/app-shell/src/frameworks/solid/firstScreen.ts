/**
 * The host's one first-screen gate, over Solid's signal so an effect that reads `open()` re-runs when
 * it opens. What it is and when it opens: `shared/firstScreen.ts`.
 *
 * One per app, at module scope, because the things that wait on it are spread over stores that do not
 * share a provider: `BootController` holds it, `TemplateLayout` says the screen is drawn, the Feed
 * (through its module deps) says its first page landed, and each deferred read waits on it.
 */
import { createFirstScreen } from '@shared/firstScreen';
import { createSignal } from 'solid-js';

export const firstScreen = createFirstScreen({
  signal: <T>(initial: T) => {
    const [read, write] = createSignal(initial);
    return [read, (next: T) => void write(() => next)];
  },
});
