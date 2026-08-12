import { useDatasetStore, useRouteStore, useSessionStore, useShellStore, useThemeStore } from '@we/app-shell/solid';
import { createEffect } from 'solid-js';

/**
 * Puts the app on the fixture's space and route, once the boot has finished.
 *
 * ## Why this is not just a URL
 *
 * `buildRoutes` mounts a template's routes at the **router root**, so the Discord-shaped template
 * owns `/channel/:channelId` outright. But `spaceStore.navigateToSpace` builds
 * `/space/<id>/<view>`, and *that* shape only resolves because the default template happens to
 * declare a `/space/:spaceId` route. No showcase template declares one, so none of them can be
 * deep-linked: `/space/x/channel/y` falls through to the catch-all, and `/channel/y` renders the
 * right route against the wrong (unselected) dataset. Neither URL alone can express "this space,
 * that route".
 *
 * That is a real inconsistency in the app and worth fixing there — a template mounted at the root
 * cannot coexist with a space prefix the shell adds on its behalf. It is not this branch's to fix,
 * so the preview host states both halves explicitly instead: select the dataset, then navigate.
 *
 * Doing it in a component rather than in the connector is what makes it possible at all — stores
 * only exist inside `StoreProvider`, which is why `src/index.tsx` composes the root from
 * `StoreProvider` + `TemplateProvider` rather than using the packaged `<App/>`.
 */
export function PreviewBootstrap(props: { datasetId: string; route: string }) {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();
  const routeStore = useRouteStore();
  const shellStore = useShellStore();
  const themeStore = useThemeStore();

  let done = false;

  createEffect(() => {
    // `bootState` rather than a timer: datasets are loaded and spaces are read by the time it says
    // ready, and anything earlier races the very work it depends on.
    if (done || session.bootState() !== 'ready') return;
    if (!datasetStore.datasetsLoaded()) return;
    done = true;

    void (async () => {
      await datasetStore.switchDataset(props.datasetId);
      routeStore.navigate(props.route);
      // The shell deliberately boots onto the landing-page overlay, which sits *over* the template.
      // Correct for the real app — a first-run user should meet the pitch, not an empty space — and
      // wrong for a host whose entire job is photographing what is underneath it.
      shellStore.closeShellView();
      // A space's theme covers only the space's own content by default, which is right for the app —
      // your chrome should not restyle itself every time you visit somebody's community. It is wrong
      // for a host whose whole output is a photograph of one template: shell chrome in the *agent's*
      // theme puts a second design in the frame, and the palette sampled off that frame then averages
      // two themes together.
      themeStore.setThemeScopeGlobal(true);
    })();
  });

  return null;
}
