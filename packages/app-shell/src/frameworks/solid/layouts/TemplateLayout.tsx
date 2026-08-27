/**
 * TemplateLayout
 *
 * Root layout component for the main <Router>. Mounted as `root={TemplateLayout}`
 * on the Router so it has access to useNavigate()/useLocation() from SolidJS Router.
 *
 * Responsibilities:
 * - Wire navigate + location into routeStore (same pattern as RouteStoreProvider)
 * - Render the content viewport (offset from shell sidebar, AI panel)
 * - Render the active template (visibility-hidden when an app is active)
 * - Render the shell overlay (profile, settings, etc.) above the template
 *
 * Persistent app iframes (e.g. Flux) are NOT rendered here — this component is
 * remounted whenever the active template changes (see the keyed <Show> around
 * <Router> in TemplateProvider), which would tear down and reload any embedded
 * app mid-use. They're rendered by PersistentAppFrames instead, mounted once
 * alongside the shell chrome in TemplateProvider, outside the keyed Router.
 *
 * The shell overlay uses ShellRouteStoreProvider + <MemoryRouter> so shell schema
 * $routes outlets work with a real router context, without touching the browser URL.
 */
import { registerHostChromeReserve } from '@shared/registries/dockRegistry';
import { buildTemplateBag, CHROME_TIER } from '@shared/registries/templateSurface';
import { isValidThemeKey } from '@shared/registries/themeRegistry';
import { TemplateBoundary } from '@solid/components/TemplateBoundary';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import { ShellRouterRoot, ShellRouteStoreProvider, useShellRouteStore } from '@solid/stores/ShellRouteStore';
import { THEME_SCOPE_ATTRIBUTE } from '@solid/stores/ThemeStore';
import type { Stores } from '@solid/types';
import { MemoryRouter, Route, useLocation, useNavigate } from '@solidjs/router';
import { Column } from '@we/components/solid';
import { panelResizing } from '@we/editor/runtime';
import { applyThemeVars, clearThemeVars, parseOverrides, surfaceStyles } from '@we/schema-shared';
import { lazy } from 'solid-js';

const EditorOverlay = lazy(() => import('@we/editor').then((m) => ({ default: m.EditorOverlay })));
import { createSurface, RenderSchema } from '@we/schema-solid';
import type { ParentProps } from 'solid-js';
import { createEffect, createMemo, onCleanup, Show } from 'solid-js';

import { buildRoutes } from '../utils/buildRoutes';
import { resolveShellView, type ShellViewEntry } from './shellViews';

// Width of the collapsed shell sidebar — also set as --we-sidebar-width on :root.
export const SHELL_SIDEBAR_WIDTH = '80px';

// Right-edge offset of the content viewport — shrinks it to make room for the editor's rails and
// panels, and for any docked module. Shared with PersistentAppFrames so the persistent app iframes
// (rendered outside the template Router) line up with the same viewport the template content
// occupies.
export function computeRightOffset(stores: Stores): string {
  /*
    Just the docks now.

    The editor's own term used to be added here, because its panels positioned themselves and the
    shell had to be told how much of the edge they had taken. They are docks themselves now, so they
    are already in this sum — and the second term would have counted them twice.
  */
  const offset = stores.shellStore.contentInset().right;
  return offset ? `${offset}px` : '0px';
}

/**
 * The other three edges, from docked module panels alone.
 *
 * Separate from `computeRightOffset` because that one is also the editor's, and the editor only
 * ever grows from the right. Kept as CSS strings for the same reason: these feed DS props, and an
 * offset of zero should read as `'0px'` rather than as an omitted prop that inherits something.
 *
 * The left offset composes with the shell sidebar rather than replacing it — a left dock opens
 * *beside* the sidebar, not over it, so its width adds to the sidebar's.
 */
export function computeLeftOffset(stores: Stores): string {
  const dock = stores.shellStore.contentInset().left;
  const sidebar = `var(--we-sidebar-width, ${SHELL_SIDEBAR_WIDTH})`;
  return dock ? `calc(${sidebar} + ${dock}px)` : sidebar;
}

export function computeTopOffset(stores: Stores): string {
  return `${stores.shellStore.contentInset().top}px`;
}

export function computeBottomOffset(stores: Stores): string {
  return `${stores.shellStore.contentInset().bottom}px`;
}

// ---------------------------------------------------------------------------
// Shell overlay inner — rendered inside ShellRouteStoreProvider + MemoryRouter
// ---------------------------------------------------------------------------

function ShellOverlayInner({
  stores,
  chromeStores,
  view,
}: {
  /** The host's own handle. A view's store factory is host code and reads wiring through it. */
  stores: Stores;
  /** What the overlay's schema renders against — chrome tier, because these views are chrome. */
  chromeStores: Stores;
  view: ShellViewEntry;
}) {
  const shellRouteStore = useShellRouteStore();
  // The overlay is its own surface: it is a sibling of the template's box, not inside it, so a
  // settings page adapts to the overlay's width rather than to whatever the space behind it is.
  const overlaySurface = createSurface();
  // Shell views name themes too — the schema-tests page demonstrates a scoped `cyberpunk` section —
  // and they are mounted on demand, so the template's own pass never sees them.
  stores.themeStore.requestNamedThemes(view.schema);
  // Built from the raw stores (the schema-tests view reaches for `testDataset` and `backendPorts`,
  // both host wiring), then merged into the *chrome* bag, which is what actually gets rendered.
  const { $schema: reactiveSchema, ...storeEntries } = view.stores?.(stores, shellRouteStore) ?? {};
  /*
    The overlay's router, put through the same bag as everything else it renders against.

    Substituting the raw store here would hand the schema untagged accessors, and `walkPath` calls
    only tagged ones — so `currentPath`, `segments` and `params` would all read as absent, silently.
    That is not cosmetic: `/spaces/:uuid` in Settings filters the spaces list on
    `routeStore.segments.1`, so an untagged read empties the filter and the page draws nothing at
    all. The bag also drops `setCurrentPath`/`setNavigateFunction`, which are ShellRouterRoot's to
    call and no schema's.
  */
  const shellRouteBag = buildTemplateBag({ routeStore: shellRouteStore }, { grants: CHROME_TIER }).routeStore;
  const shellStores: Stores = { ...chromeStores, routeStore: shellRouteBag, ...(storeEntries as Partial<Stores>) };
  const schema = reactiveSchema ?? view.schema;

  return (
    <MemoryRouter
      root={(props) => (
        <ShellRouterRoot>
          {/*
            `height: 100%`, because this surface is the one host site that adds a box.

            The other three attach to an element that was already there and already sized. This one
            sits between the overlay's scroll container and the view's root node, and every shell
            view's root sizes itself with `minHeight: '100%'` — so the box has to pass a *definite*
            height through or that percentage has nothing to resolve against.

            Left at `auto` it resolved differently per engine: Chrome resolves a percentage through
            an auto-height ancestor and looked correct, Firefox follows CSS2.1 and treats it as
            indefinite, so profile and settings collapsed to their content height and the space
            template showed through underneath. `min-height: 100%` here does *not* fix it — the box
            is still auto-height, so the child's percentage is still indefinite. Measured in Chrome
            150 and Firefox 152.

            `height` rather than `min-height` costs nothing when the view is taller than the
            viewport: overflow is visible, so a long settings page still overflows this box and
            scrolls the overlay above it.
          */}
          <div
            {...overlaySurface.outerAttrs}
            style={{ ...surfaceStyles(), height: '100%' }}
            ref={overlaySurface.outerRef}
          >
            <div {...overlaySurface.tierAttrs} ref={overlaySurface.tierRef} />
            <RenderSchema
              node={schema}
              stores={shellStores}
              registry={registry}
              context={{ surface: overlaySurface.surface }}
              children={props.children}
            />
          </div>
        </ShellRouterRoot>
      )}
    >
      {buildRoutes(shellStores, schema.routes ?? [])}
      <Route path="*" component={() => null} />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// TemplateLayout — mounted as root prop of the main <Router>
// ---------------------------------------------------------------------------

export function TemplateLayout(
  props: ParentProps & {
    /** The space template's bag. This layout renders that template. */
    stores: Stores;
    /** The chrome bag, for the shell overlays this layout also mounts. */
    chromeStores: Stores;
    /** The host's own handle, for this layout's own wiring and layout arithmetic. */
    hostStores: Stores;
  },
) {
  // `stores` is the *template* bag and is used for exactly one thing: rendering the template.
  // Everything else here — route wiring, panel geometry, theme resolution — is host work and reads
  // `host`, which still has the members a bag deliberately withholds.
  const stores = props.hostStores;
  const templateStores = props.stores;

  // Wire useNavigate/useLocation (available here because we're inside <Router>) into routeStore
  const navigate = useNavigate();
  const location = useLocation();
  /*
    What the shell template is painting over the content, so floating panels clear it.

    Registered from here rather than published by the template, because a template is data and has
    no store to publish from. The host reads the declaration and folds it into the same sum a
    module's `chromeReserve` lands in — see `moduleChrome` in ShellStore.

    Keyed on the template, and withdrawn on unmount: a shell that stops declaring a bar must stop
    reserving the band, or every panel keeps dodging chrome that is not there any more.
  */
  createEffect(() => {
    registerHostChromeReserve('template', stores.templateStore.currentTemplate?.meta?.chromeReserve);
  });
  onCleanup(() => registerHostChromeReserve('template', undefined));

  createEffect(() => stores.routeStore.setNavigateFunction(() => navigate));
  createEffect(() => stores.routeStore.setCurrentPath(location.pathname));

  // Exit template editing when a shell view (settings, profile, marketplace) opens.
  createEffect(() => {
    if (stores.shellStore.activeShellView()) stores.editorStore.exitTemplateEditing();
  });

  // Scoped space theme — applied to the template content area only.
  // activeTemplateTheme() returns the editing theme (when editing in scoped mode) or the
  // space theme, and null in global mode (template inherits from documentElement).
  /*
    The scoped theme is *applied*, not merely declared.

    This used to spread `themeParametersToStyle(overrides)` into the wrapper's style, which writes the theme's
    parameters and stops there — no chroma ceilings, no legible fills, no chosen labels, no state
    directions, no corrected foregrounds. Every one of those is a measurement, and measuring needs a
    real element, so none of them could happen from a style object.

    The effect was that scoping a theme changed how the template looked. In global mode the template
    inherits documentElement, which has been through the whole pipeline; scoped, it got the raw
    parametric values — muted text at Lc 45 instead of 60, and a chroma ceiling falling back to a
    flat 0.18 for every hue. Toggling the scope switch was supposed to move the *chrome* and instead
    restyled the content, which is how it was noticed.

    Applying to the wrapper element runs the identical derivation the root gets. The one thing that
    cannot come from here is the inherited text colour, which is why `color` stays below.
  */
  let scopeEl: HTMLElement | undefined;
  let lastScopedThemeId: string | null = null;

  /*
    The template's own surface.

    This element already is the boundary — it carries THEME_SCOPE_ATTRIBUTE precisely because it
    marks where the edge of the template content is — so it becomes the container too rather than
    gaining a wrapper. That matters beyond tidiness: it is also the scroll container, and a box
    between it and the fixed viewport would have to reproduce the scrolling to keep the background
    covering the whole overflow area.

    Declared by the host and not left to templates on purpose. A container query with no container
    resolves to false *silently*, so a template's `mdUpProps` would render its base value, look
    entirely correct, and never adapt.
  */
  const templateSurface = createSurface();

  createEffect(() => {
    const td = stores.themeStore.activeTemplateTheme();
    if (!scopeEl) return;
    /*
      Hold what is on screen while the answer is still coming.

      A pinned personal theme is referenced by an id whose record loads asynchronously, so for a
      moment `activeTemplateTheme()` is a *fallback* rather than the theme asked for. Painting it
      here is what produced the white flash between the boot screen and the pinned theme — the token
      CSS's `:root` defaults are the light theme, so the fallback is about as visible as a wrong
      answer can be. Doing nothing leaves the template inheriting the document, which is already
      wearing something sensible.
    */
    if (stores.themeStore.templateThemePending()) return;
    if (!td) {
      // Global mode: the wrapper must go back to *inheriting* the document theme. Writing a default
      // palette here instead would cut it off from the root — see `clearThemeVars`.
      clearThemeVars(scopeEl);
      lastScopedThemeId = null;
      return;
    }
    const overrides = parseOverrides(td.overrides);
    if (isValidThemeKey(td.id) && !overrides.themeName) overrides.themeName = td.id;
    // Editing keeps the id and changes parameters; switching changes the id. Only the second
    // cross-fades — the same distinction the document root makes, and for the same reason.
    const isSwitch = td.id !== lastScopedThemeId;
    lastScopedThemeId = td.id;
    applyThemeVars(scopeEl, overrides, { crossFade: isSwitch });
  });

  const spaceThemeStyle = createMemo((): Record<string, string> => {
    const td = stores.themeStore.activeTemplateTheme();
    if (!td) return {};
    return {
      /**
       * Re-resolve the inherited text colour against this wrapper's own tokens.
       *
       * The global stylesheet sets `color: var(--we-role-text)` on `html, body, #root`. A custom
       * property is substituted where the declaration lives, so that resolves against
       * documentElement — the *personal* theme in scoped mode — and then inherits down as a
       * finished colour. Re-declaring the token on this wrapper does not re-run that substitution,
       * so a light space under a dark personal theme rendered light surfaces with white text on
       * anything that did not set its own colour.
       *
       * It must name the same thing the global rule does, which is now the role rather than a scale
       * position — otherwise a space theme pinning `text` would be overridden here by the scale,
       * for every element that inherits rather than setting its own colour, which is most of them.
       *
       * `background-color` needs no equivalent: it does not inherit, so the wrapper's own surfaces
       * paint from the tokens it declares.
       */
      color: 'var(--we-role-text)',
    };
  });

  const spaceThemeName = createMemo(() => {
    const td = stores.themeStore.activeTemplateTheme();
    if (!td) return undefined;
    const overrides = parseOverrides(td.overrides);
    return (overrides.themeName as string | undefined) ?? (isValidThemeKey(td.id) ? td.id : undefined);
  });

  const rightOffset = () => computeRightOffset(stores);
  const leftOffset = () => computeLeftOffset(stores);
  const topOffset = () => computeTopOffset(stores);
  const bottomOffset = () => computeBottomOffset(stores);

  return (
    <>
      {/* Content viewport — offset from the shell sidebar, the editor panels, and any docked module.
          Sized by its four offsets rather than by `height: 100vh`, so a dock on the top or bottom
          edge takes room from it the same way one on the left or right does. */}
      <Column
        position="fixed"
        top={topOffset()}
        bottom={bottomOffset()}
        left={leftOffset()}
        right={rightOffset()}
        // Suspended during either kind of drag, so the viewport edge tracks the cursor exactly rather
        // than lagging a third of a second behind it.
        transition={
          panelResizing() || stores.shellStore.dockResizing()
            ? 'none'
            : 'top 300ms ease, right 300ms ease, bottom 300ms ease, left 300ms ease'
        }
      >
        {/*
          Main template content, and the scoped space theme.

          These are one element on purpose. The theme used to live on a `display: contents` div
          inside this one, which declares the space's CSS vars but generates no box — so it could
          never paint, and the scroll container had no background at all. Everything the template's
          own content did not cover fell through to the canvas, which `html, body, #root` paints
          from documentElement's tokens: the *shell* theme. Scrolling past a template that sized
          itself to the viewport showed exactly that.

          A scrolling element's background covers its whole scrollable overflow area rather than
          just the visible box, so painting here — from vars declared here — means no template can
          leak the shell's background however it handles its own height. Overlays are siblings, so
          they correctly stay on the shell theme.
        */}
        <Column
          display="block"
          position="absolute"
          top="0"
          left="0"
          width="100%"
          height="100%"
          zIndex={1}
          visibility={stores.appStore.activeAppId() ? 'hidden' : 'visible'}
          pointerEvents={stores.appStore.activeAppId() ? 'none' : 'auto'}
          overflow="auto"
          scrollbarGutter="stable"
          // The surface a template is painted on, so it is the `page` role rather than the scale
          // position that happened to look right in the two themes that existed. It carries
          // `data-we-theme` on the same element, which is what makes the difference visible: a
          // space theme pinning `page` restyled everything it owned and left this — its own
          // backing — a shade off, showing as a frame around a template that did not fill the
          // viewport. Defaults to `neutral-50`, exactly what was here.
          bg="page"
          data-we-theme={spaceThemeName()}
          // The boundary a scoped theme's CSS is confined to — see THEME_SCOPE_ATTRIBUTE. Always
          // present, not conditional on there being a scoped theme: it marks where the edge of the
          // template content is, which is true whether or not anything is currently scoped to it.
          {...{ [THEME_SCOPE_ATTRIBUTE]: '' }}
          // …and the boundary a template's *size* is measured against, which is the same edge.
          {...templateSurface.outerAttrs}
          // The element a scoped theme is applied to — see the effect above.
          ref={(el: HTMLElement) => {
            scopeEl = el;
            templateSurface.outerRef(el);
          }}
          styles={{ ...spaceThemeStyle(), ...surfaceStyles() }}
        >
          {/*
            The boundary that matters most, and note what is *outside* it: the sidebar, the shell
            overlays and the template switcher. A template that throws becomes a panel with a
            message in it, and the app is still an app — the user can switch template, leave the
            space, or open settings. Without this, Solid unmounts the whole tree on any uncaught
            throw, so somebody else's template blanked the window and took the way out with it.
          */}
          {/*
            Where the tier lands. Zero-size and out of flow, because an element cannot query itself
            and this is something inside that can. CSS decides which tier this surface is at and
            writes it here; the store reads the answer back, so `$surface.tier` and the children's
            `*UpProps` are the same decision rather than two that agree most of the time.
          */}
          <div {...templateSurface.tierAttrs} ref={templateSurface.tierRef} />
          <TemplateBoundary
            what="this space's template"
            action={
              <we-button
                variant="ghost"
                onClick={() => props.hostStores.shellStore.openShellView('settings', '/appearance')}
              >
                Choose another template
              </we-button>
            }
          >
            <Show when={stores.templateStore.currentTemplate.id || 'empty'} keyed>
              <RenderSchema
                node={stores.templateStore.currentTemplate}
                stores={templateStores}
                registry={registry}
                context={{ surface: templateSurface.surface }}
                children={props.children}
              />
            </Show>
          </TemplateBoundary>
        </Column>

        {/* Code / visual editor overlay — sits above template (z:5), below shell (z:11).
            Fetched with the rest of the editing surface, so a session that never edits never
            downloads it. */}
        <EditorOverlay />

        {/* Shell overlay rendered above the template */}
        <Show when={stores.shellStore.activeShellView()} keyed>
          {(shellViewId) => {
            // `null` means this build has no such view — an unknown id, or the schema-test harness
            // in a production build. Otherwise an accessor: already filled for the ordinary views,
            // and filled a frame later for one whose chunk is being fetched. See `resolveShellView`.
            const view = resolveShellView(shellViewId);
            if (!view) return null;
            return (
              <Column
                display="block"
                position="absolute"
                top="0"
                left="0"
                width="100%"
                height="100%"
                zIndex={11}
                overflow="auto"
                // Reserve the scrollbar gutter permanently. Without this, any shell view whose
                // content crosses the viewport height gains and loses its scrollbar as content
                // changes, and every reflow shifts the whole page horizontally. Most visible in the
                // benchmark runner, which swaps between routes of wildly different heights, but it
                // affects any shell view with variable-length content.
                scrollbarGutter="stable"
              >
                {/* A fault in settings or the marketplace must not take the space behind it down. */}
                <TemplateBoundary
                  what={shellViewId}
                  action={
                    <we-button variant="ghost" onClick={() => stores.shellStore.closeShellView()}>
                      Close
                    </we-button>
                  }
                >
                  {/* The overlay's box is painted while the chunk arrives, so a lazy view opens
                      onto the surface it is about to fill rather than onto the template behind it. */}
                  <Show when={view()}>
                    {(entry) => (
                      <ShellRouteStoreProvider>
                        <ShellOverlayInner stores={stores} chromeStores={props.chromeStores} view={entry()} />
                      </ShellRouteStoreProvider>
                    )}
                  </Show>
                </TemplateBoundary>
              </Column>
            );
          }}
        </Show>
      </Column>
    </>
  );
}
