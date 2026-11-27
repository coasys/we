/**
 * The shell's overlays and the small surfaces more than one control opens: which shell view is up and
 * where inside it, the create- and join-space dialogs, and the space-settings panel with the tab and
 * record it was opened about. Part of `ShellStore` — see `../ShellStore.ts`.
 */
import { type ReactivityPort } from '@we/reactivity';

import { distinctSignal } from '../../distinctSignal';
import { type ShellStore } from '../ShellStore';

/**
 * The overlay to open at boot: the landing page, unless the URL already points somewhere.
 *
 * Opening it unconditionally meant every refresh covered whatever route was showing, so a deep
 * link never reached its destination — the routing beneath it worked fine and nobody could tell.
 * That also made shared links useless, since the only way to arrive at one is by URL.
 *
 * Anything other than `/` is a destination someone asked for, so the landing page would be in the
 * way rather than a starting point.
 */
function initialShellView(): string | null {
  if (typeof window === 'undefined') return 'landing-page';
  return window.location.pathname === '/' ? 'landing-page' : null;
}

export function createShellViews(deps: { reactivity: ReactivityPort }) {
  const { reactivity } = deps;
  const { untrack } = reactivity;
  const [activeShellView, setActiveShellView] = distinctSignal<string | null>(reactivity, initialShellView());
  const [pendingPath, setPendingPath] = distinctSignal<string | null>(reactivity, null);
  /**
   * Where each shell view was last standing, so it can be put back after a remount.
   *
   * The overlay's `MemoryRouter` — and the store that mirrors it — both live *inside*
   * `TemplateLayout`, which is the main Router's root. So anything that rebuilds the main route
   * table takes the overlay down with it, and a `MemoryRouter` coming back up starts at `/`: you
   * were on a space's settings page and you are now on the account page, having asked for neither.
   *
   * A plain object rather than a signal: nothing renders from it, it is read once on mount, and
   * making it reactive would only invite an effect to depend on it.
   */
  const lastShellPath: Record<string, string> = {};
  const [createSpaceOpen, setCreateSpaceOpen] = distinctSignal(reactivity, false);
  const [joinSpaceOpen, setJoinSpaceOpen] = distinctSignal(reactivity, false);
  const [spaceSettingsOpen, setSpaceSettingsOpen] = distinctSignal(reactivity, false);
  // Where the panel starts, for a caller that knows which setting it is sending somebody to. Not a
  // controlled value — see `spaceSettingsTab`.
  const [spaceSettingsTab, setSpaceSettingsTab] = distinctSignal(reactivity, 'about');
  const [spaceSettingsFocus, setSpaceSettingsFocus] = distinctSignal(reactivity, '');

  /**
   * Scroll to a vocabulary row once it exists. The panel mounts and its rows arrive from queries after
   * the press, so the element is not there yet when it is asked for; it is looked for until it is, for
   * a few seconds, and then given up on — a record that never draws a row has nowhere to scroll to.
   */
  let focusSearch: ReturnType<typeof setTimeout> | undefined;
  function scrollWhenDrawn(id: string, tries = 40): void {
    clearTimeout(focusSearch);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (tries > 0) focusSearch = setTimeout(() => scrollWhenDrawn(id, tries - 1), 100);
  }

  const members: Pick<
    ShellStore,
    | 'activeShellView'
    | 'openShellView'
    | 'closeShellView'
    | 'createSpaceOpen'
    | 'setCreateSpaceOpen'
    | 'joinSpaceOpen'
    | 'setJoinSpaceOpen'
    | 'spaceSettingsOpen'
    | 'spaceSettingsTab'
    | 'spaceSettingsEdge'
    | 'toggleSpaceSettings'
    | 'openSpaceSettings'
    | 'closeSpaceSettings'
    | 'spaceSettingsFocus'
    | 'takePendingPath'
    | 'rememberShellPath'
    | 'scrollToId'
  > = {
    activeShellView,
    openShellView: (id: string, path?: string) => {
      // An explicit path wins; otherwise the view reopens where it was last left, which is what a
      // person expects of somewhere they were half-way through configuring.
      setPendingPath(path ?? lastShellPath[id] ?? null);
      setActiveShellView(id);
    },
    closeShellView: () => setActiveShellView(null),
    createSpaceOpen,
    setCreateSpaceOpen,
    joinSpaceOpen,
    setJoinSpaceOpen,
    spaceSettingsOpen,
    spaceSettingsTab,
    spaceSettingsEdge: () => (spaceSettingsOpen() ? 'right' : null),
    toggleSpaceSettings: () => {
      setSpaceSettingsFocus('');
      setSpaceSettingsOpen(!untrack(spaceSettingsOpen));
    },
    openSpaceSettings: (tab?: string, focus?: string) => {
      // Only a name is a tab. A button wired without `args` hands an action the click, and the About
      // view's pencil did, so the panel was asked to open on a MouseEvent.
      setSpaceSettingsTab(typeof tab === 'string' && tab ? tab : 'about');
      const about = typeof focus === 'string' ? focus : '';
      setSpaceSettingsFocus(about);
      setSpaceSettingsOpen(true);
      if (about) scrollWhenDrawn(`vocab-${about}`);
    },
    closeSpaceSettings: () => {
      setSpaceSettingsFocus('');
      setSpaceSettingsOpen(false);
    },
    spaceSettingsFocus,
    takePendingPath: () => {
      const path = pendingPath();
      setPendingPath(null);
      // Not cleared from `lastShellPath`: a remount asks again with nothing pending, and the answer
      // has to survive to be given.
      return path ?? lastShellPath[activeShellView() ?? ''] ?? null;
    },
    rememberShellPath: (path: string) => {
      const id = activeShellView();
      if (id) lastShellPath[id] = path;
    },
    scrollToId: (id: string) => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  };
  return { members, activeShellView, setActiveShellView };
}

export type ShellViews = ReturnType<typeof createShellViews>;
