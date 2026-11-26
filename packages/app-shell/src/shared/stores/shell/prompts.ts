/**
 * The prompts the host raises itself, in host chrome a template cannot restyle: which screen to share
 * when the OS draws no picker, and the confirmation every destructive action a template names asks
 * for. Part of `ShellStore` — see `../ShellStore.ts`.
 */
import { type ScreenSource } from '@shared/platform/types';
import { type ReactivityPort } from '@we/reactivity';

import { describeDestructive, type DestructiveFacts } from '../../destructiveWording';
import { type PendingDestructive, type ShellStore, type ShellStoreDeps } from '../ShellStore';

/** How long the host waits for what a delete takes with it before asking without it. */
const FACTS_WAIT_MS = 500;

export function createShellPrompts(deps: {
  reactivity: ReactivityPort;
  platform: Pick<ShellStoreDeps['platform'], 'screenSources'>;
}) {
  const { reactivity } = deps;
  const { signal, onCleanup } = reactivity;
  /*
    Which screen to share, when the OS will not ask.

    Host chrome for the same reason the consent and install prompts are: the *host* is asking, and it
    is asking on behalf of a `getDisplayMedia` that a page is already awaiting — so the dialog cannot
    belong to whichever surface happened to press the button, and it must exist even where that
    surface has since been unmounted.

    Absent on web and on any desktop whose OS draws its own picker: the platform only offers this
    capability where it is needed, and Electron only *asks* on the branch the system picker did not
    take. So an empty list here is the ordinary state, and the prompt is simply never raised.
  */
  const [pendingScreenSources, setPendingScreenSources] = signal<ScreenSource[]>([]);
  const screens = deps.platform.screenSources;
  if (screens) {
    const stop = screens.onRequest((sources) => setPendingScreenSources(sources));
    onCleanup(stop);
  }

  /**
   * Answer the outstanding request, and clear the prompt.
   *
   * An empty id is a cancellation, which is an answer — the page's `getDisplayMedia` rejects with
   * the same `NotAllowedError` it would get from closing a browser's own picker, and the call
   * module already reads that as 'cancelled' rather than as a fault.
   */
  function chooseScreenSource(sourceId: string): void {
    setPendingScreenSources([]);
    screens?.choose(sourceId);
  }
  const [pendingDestructive, setPendingDestructive] = signal<PendingDestructive | null>(null);
  /** Resolves the promise `requestDestructive` handed back. Null when no question is outstanding. */
  let answerDestructive: ((ok: boolean) => void) | null = null;

  /** Which question is current, so facts arriving for an earlier one are dropped. */
  let destructiveAsk = 0;

  function requestDestructive(path: string, args: unknown[], facts?: Promise<DestructiveFacts>): Promise<boolean> {
    // A second question while one is open answers "no" to the first rather than losing it. Two
    // dialogs cannot both be on screen, and an unanswered promise would hang the first action's
    // `onFinally` forever.
    answerDestructive?.(false);
    const ask = ++destructiveAsk;
    const show = (found?: DestructiveFacts) => {
      if (ask === destructiveAsk && answerDestructive)
        setPendingDestructive({ path, ...describeDestructive(path, args, found) });
    };
    const answer = new Promise<boolean>((resolve) => {
      answerDestructive = resolve;
    });
    /*
      Waits briefly for what the host is finding out, so the question is asked once in its final
      words rather than changing under somebody reading it. Past the wait it is asked without them,
      and reworded if they arrive — a count late is better than a question held back.
    */
    if (!facts) show();
    else {
      let shown = false;
      const timer = setTimeout(() => {
        shown = true;
        show();
      }, FACTS_WAIT_MS);
      void facts.then((found) => {
        clearTimeout(timer);
        if (!shown || found.responses || found.reply) show(found);
      });
    }
    return answer;
  }

  function settleDestructive(ok: boolean): void {
    const answer = answerDestructive;
    answerDestructive = null;
    setPendingDestructive(null);
    answer?.(ok);
  }

  const members: Pick<
    ShellStore,
    | 'pendingScreenSources'
    | 'chooseScreenSource'
    | 'pendingDestructive'
    | 'confirmDestructive'
    | 'cancelDestructive'
    | 'requestDestructive'
  > = {
    pendingScreenSources,
    chooseScreenSource,
    pendingDestructive,
    confirmDestructive: () => settleDestructive(true),
    cancelDestructive: () => settleDestructive(false),
    requestDestructive,
  };
  return { members };
}

export type ShellPrompts = ReturnType<typeof createShellPrompts>;
