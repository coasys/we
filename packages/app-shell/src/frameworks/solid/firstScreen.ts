/**
 * The host's one first-screen gate, over the port's Solid signal so an effect that reads `open()` re-runs when
 * it opens. What it is and when it opens: `shared/firstScreen.ts`.
 *
 * One per app, at module scope, because the things that wait on it are spread over stores that do not
 * share a provider: `BootController` holds it, `TemplateLayout` says the screen is drawn, the Feed
 * (through its module deps) says its first page landed, and each deferred read waits on it.
 */
import { createFirstScreen } from '@shared/firstScreen';
import { solidReactivity } from '@we/reactivity-solid';

export const firstScreen = createFirstScreen({ signal: solidReactivity.signal });
