/**
 * The shell overlay's router binding, under Solid: mounted as the `root` of its <MemoryRouter>, it
 * fills the overlay's route store (`shared/stores/ShellRouteStore.ts`) from the router's location, as
 * `TemplateLayout` does for the main Router.
 */
import type { ShellRouteStore } from '@shared/stores/ShellRouteStore';
import { useLocation, useNavigate } from '@solidjs/router';
import { createEffect, type JSX, onCleanup, onMount, type ParentProps, untrack } from 'solid-js';

import { useStore } from '../stores/useStore';

/**
 * Mount as the `root` prop of <MemoryRouter>. Calls useNavigate()/useLocation()
 * from inside the router context and wires them into the ShellRouteStore signals.
 */
export function ShellRouterRoot(props: ParentProps<{ store: ShellRouteStore }>): JSX.Element {
  // The overlay's store for the overlay's life: another overlay is another ShellRouterRoot.
  const store = untrack(() => props.store);
  const shell = useStore('shellStore');
  const navigate = useNavigate();
  const location = useLocation();

  /*
    Claimed synchronously, here in setup, rather than inside `onMount`.

    Effects run in creation order and `onMount` is one of them, so the location effect below fires
    first — with the *fresh* router's `/`, since a remounted `MemoryRouter` starts there. Asking
    afterwards therefore returned `/`: the answer had been overwritten by the question. Reading it
    before any effect exists is what makes the restore survive its own bookkeeping.
  */
  const restoreTo = shell.takePendingPath();

  // The overlay's own router, taken back when the overlay closes — see `RouteStore`, which had the
  // same slot and the same missing half.
  onCleanup(store.setNavigateFunction(navigate));
  createEffect(() => {
    store.setCurrentPath(location.pathname);
    // Reported upwards on every move, because this store does not outlive the overlay and the
    // question "where was I" is asked after it has already been destroyed. See `rememberShellPath`.
    shell.rememberShellPath(location.pathname + location.search);
  });
  createEffect(() => store.setSearch(location.search));

  // A control outside the overlay can ask for a page inside it — see `ShellStore.openShellView`.
  // Claimed here rather than by the opener because this is the first moment `navigate` exists, and
  // taken rather than read so a later open with no path does not replay the last one.
  //
  // With nothing pending this returns where the overlay was last standing, which is what makes a
  // remount survivable: `TemplateLayout` hosts this router, so rebuilding the main route table —
  // adding or removing a section, switching template — takes the overlay down and a fresh
  // `MemoryRouter` starts at `/`. Without this you were on a space's settings page and are now on
  // the account page, having asked for neither.
  onMount(() => {
    if (restoreTo && restoreTo !== location.pathname + location.search) navigate(restoreTo, { replace: true });
  });

  return <>{props.children}</>;
}
