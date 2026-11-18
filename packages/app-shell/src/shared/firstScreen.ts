/**
 * # The first screen
 *
 * Work the opening screen does not need waits until that screen has drawn.
 *
 * Opening an existing space at cold boot used to put everything on the wire at once: the Feed's first
 * page, and beside it the sidebar's calls, the workflow list, the extraction panel's reads (hundreds
 * of kilobytes of schema and staged suggestions), the members and their profiles, presence, the call
 * policy, the model status, the hosting balance, the file-storage language and the sharing templates.
 * One executor answers them in turn, so the page the reader opened for came back behind all of it.
 *
 * This is the one gate that work waits on. It is **not** a scheduler and has no queue: each thing that
 * waits reads {@link FirstScreen.open} in the effect that starts it, or awaits
 * {@link FirstScreen.whenOpen} before its first request, and so starts the same way it always did —
 * only later. That is why a deferred thing stays correct: it reads the state as it is when it starts,
 * not as it was when it was asked for.
 *
 * ## When it opens
 *
 * - **Never held** — open from the start. A host that does not boot through `BootController`, and
 *   every test that does not call {@link FirstScreen.hold}, waits on nothing.
 * - **Held, then the Feed's first page lands.** The Feed says {@link FirstScreen.waiting} as its first
 *   read leaves and {@link FirstScreen.answered} when that read has landed or failed. A failure opens
 *   it too: the reader is looking at an error, not waiting for a page. So does the Feed no longer
 *   waiting — taken down before its page landed, or in a space with no collection to read — since a
 *   waiter that no longer waits must not hold the rest of the app.
 * - **Held, then the host has drawn the first screen with nothing on it waiting.** A space whose
 *   opening view is not the Feed does not wait for one. {@link FirstScreen.drawn} looks again after
 *   the current turn, so a part that mounts in the same pass as the route still counts.
 * - **The ceiling.** A first page that never answers must not hold the rest of the app for ever, so
 *   one timer, set at {@link FirstScreen.hold}, opens it regardless. It is the only timer here.
 *
 * It holds once. A space switch later does not close it again: by then the rest is already up, and
 * holding it back a second time would take the sidebar away from under the reader.
 */
export interface FirstScreen {
  /** Whether work the first screen does not need may start. Reactive when built over a signal. */
  open(): boolean;
  /** Resolves once {@link open} is true — at once when it already is. */
  whenOpen(): Promise<void>;
  /** At cold boot, before the first space is drawn: hold that work until the first screen is up. */
  hold(): void;
  /** Something on the first screen is reading what the reader opened it for — the Feed's first page. */
  waiting(): void;
  /** That read has landed, or failed. */
  answered(): void;
  /** The host has drawn the first screen. Opens it unless something said it is {@link waiting}. */
  drawn(): void;
}

export interface FirstScreenDeps {
  signal: <T>(initial: T) => [() => T, (next: T) => void];
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  /** How long a first page may take before the rest starts anyway. */
  ceilingMs?: number;
}

/**
 * Long enough for a slow first page on a cold executor, short enough that a page that never comes
 * still lets the sidebar fill in while the reader is looking at the spinner.
 */
export const FIRST_SCREEN_CEILING_MS = 8000;

export function createFirstScreen(deps: FirstScreenDeps): FirstScreen {
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const [open, setOpen] = deps.signal(true);
  let held = false;
  let opened = false;
  let waitingOn = false;
  let ceiling: unknown = null;
  let resolveOpen: (() => void) | null = null;
  let opening: Promise<void> | null = null;

  function release(): void {
    if (!held || opened) return;
    opened = true;
    if (ceiling !== null) clearTimer(ceiling);
    ceiling = null;
    setOpen(true);
    resolveOpen?.();
    resolveOpen = null;
  }

  return {
    open,
    whenOpen() {
      if (!held || opened) return Promise.resolve();
      opening ??= new Promise<void>((resolve) => (resolveOpen = resolve));
      return opening;
    },
    hold() {
      if (held) return;
      held = true;
      setOpen(false);
      ceiling = setTimer(release, deps.ceilingMs ?? FIRST_SCREEN_CEILING_MS);
    },
    waiting() {
      if (held && !opened) waitingOn = true;
    },
    answered() {
      release();
    },
    drawn() {
      if (!held || opened) return;
      // After this turn, so a part mounted in the same pass as the route has had its say.
      void Promise.resolve().then(() => {
        if (!waitingOn) release();
      });
    },
  };
}

/**
 * Whether what is on screen is the first screen, drawn: a template is up and, where the address names
 * a space, that space is the one on screen with its collection known (`spaceStore.rootLoaded`).
 *
 * The space is checked, not only `rootLoaded`: before any space is chosen there is no collection to
 * wait for, so `rootLoaded` is already true, and the boot screen's template counted as the first
 * screen — the held work started a second before the Feed did and sat beside its first read. An
 * address naming no space (home, settings) is drawn with its template.
 */
export function firstScreenDrawn(screen: {
  templateId: string | undefined;
  rootLoaded: boolean;
  segments: readonly string[];
  /** Whether the space on screen is the one the address names — `datasetAddressedBy`. */
  addresses: (segment: string) => boolean;
}): boolean {
  if (!screen.templateId || !screen.rootLoaded) return false;
  const [section, addressed] = screen.segments;
  return section !== 'space' || screen.addresses(addressed ?? '');
}
