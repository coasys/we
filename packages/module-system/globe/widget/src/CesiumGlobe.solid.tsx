/**
 * Cesium Globe Widget
 *
 * A 3D globe with modular layer system.
 * Cesium's runtime files are served by the host app — see `CESIUM_BASE_URL` below.
 */

import { Cartesian3, type ImageryLayer, VERSION, Viewer } from 'cesium';
import { createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';

export type * from './CesiumGlobe.types';
import { EventBus, LayerSet } from '@we/globe-core';
import type { CesiumRendererContext, LayerKind } from '@we/globe-protocol';

import type {} from './cesium-env';
import type { CesiumGlobeProps, ImageryChoice } from './CesiumGlobe.types';
import { baseImagery, detailImagery } from './imagery';

/**
 * Where Cesium's workers, wasm, widget CSS and textures are served from.
 *
 * From the app's own origin wherever the host builds with `cesiumAssets()` from
 * `@we/globe-widget/vite`, which every WE app does: that is what lets the globe draw offline, and
 * what keeps a CDN out of the content security policy. A host without the plugin falls back to
 * jsDelivr, at the installed engine's own version — a hand-typed one once drifted eight releases
 * behind the package.
 */
const CESIUM_BASE_URL =
  import.meta.env.WE_CESIUM_BASE_URL ?? `https://cdn.jsdelivr.net/npm/cesium@${VERSION}/Build/Cesium/`;

(window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;

// Load Cesium CSS
if (typeof document !== 'undefined' && !document.querySelector('link[href*="cesium"]')) {
  const cesiumCss = document.createElement('link');
  cesiumCss.rel = 'stylesheet';
  cesiumCss.href = `${CESIUM_BASE_URL}Widgets/widgets.css`;
  document.head.appendChild(cesiumCss);
}

export function CesiumGlobe(props: CesiumGlobeProps) {
  let containerRef: HTMLDivElement | undefined;
  let viewer: Viewer | undefined;
  /** The planet layers and the background layers: two lists, each kept in step by a layer set. */
  let planet: LayerSet<CesiumRendererContext> | undefined;
  let background: LayerSet<CesiumRendererContext> | undefined;
  let updateResolution: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  /** The deferred construction frame, so unmounting before it fires can cancel it. */
  let pendingFrame: number | undefined;
  /** Set by cleanup. The frame callback checks it, since cancellation alone is not a guarantee. */
  let disposed = false;

  const [viewerReady, setViewerReady] = createSignal(false);

  onMount(() => {
    if (!containerRef) return;

    // Wait for next frame to ensure DOM is ready
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = undefined;
      // Unmounted between this frame being asked for and it arriving. Without this check the
      // cleanup below finds `viewer === undefined` — it runs synchronously, before the frame — and
      // does nothing, while this callback goes on to build a `Viewer` on a detached container,
      // plus a resize listener, a ResizeObserver and a postUpdate handler that nothing then holds.
      // Browsers cap live WebGL contexts at around sixteen, so a handful of mount/unmount cycles is
      // enough to lose the globe entirely.
      if (disposed || !containerRef) return;

      // Create Cesium viewer with minimal UI
      viewer = new Viewer(containerRef, {
        // Never Cesium's default, which is ion imagery behind a demo token that expires. The detail
        // imagery effect below adds the layer above this one. See `imagery.ts`.
        baseLayer: baseImagery(),
        timeline: false,
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        sceneModePicker: false,
        homeButton: false,
        infoBox: false,
        selectionIndicator: false,
        navigationHelpButton: false,
        requestRenderMode: false, // Continuous rendering
        maximumRenderTimeChange: Infinity, // Don't skip frames
      });

      // Set high resolution for crisp rendering on high-DPI displays
      viewer.resolutionScale = window.devicePixelRatio;

      // Disable depth testing against terrain to prevent clipping of space objects
      viewer.scene.globe.depthTestAgainstTerrain = false;

      // Set far plane and lock it from auto-adjustment
      const FAR_PLANE_DISTANCE = 4e11; // 400 billion meters
      viewer.scene.camera.frustum.far = FAR_PLANE_DISTANCE;

      // Prevent Cesium from dynamically adjusting the far plane
      const maintainFarPlane = () => {
        if (viewer && viewer.scene.camera.frustum.far < FAR_PLANE_DISTANCE) {
          viewer.scene.camera.frustum.far = FAR_PLANE_DISTANCE;
        }
      };
      viewer.scene.postUpdate.addEventListener(maintainFarPlane);

      // Keep consistent lighting and hide moon
      viewer.scene.globe.enableLighting = false;
      if (viewer.scene.moon) {
        viewer.scene.moon.show = false;
      }

      // Remove Cesium's default skybox and sun (we'll use our custom ones via backgroundLayers)
      viewer.scene.skyBox = undefined;
      if (viewer.scene.sun) {
        viewer.scene.sun.show = false;
      }

      // Update resolution scale when window resizes or device pixel ratio changes
      updateResolution = () => {
        if (viewer) {
          viewer.resolutionScale = window.devicePixelRatio;
        }
      };
      window.addEventListener('resize', updateResolution);

      // Force Cesium to re-measure its canvas whenever the container is resized
      // or becomes visible again (e.g. parent transitions from display:none → display:block)
      resizeObserver = new ResizeObserver(() => {
        if (viewer && !viewer.isDestroyed()) {
          viewer.resize();
        }
      });
      resizeObserver.observe(containerRef);

      // Set initial camera (global view)
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(0, 20, 20000000),
      });

      // The layer system: one bus for both lists, and a layer set per list. See `LayerSet`.
      const events = new EventBus();
      const ready = viewer;
      const layers = () =>
        new LayerSet<CesiumRendererContext>({
          engine: 'cesium',
          kinds: () => props.layerKinds,
          context: (shared) => ({ ...shared, viewer: ready }),
          events,
          available: (kind) => !needsMissingIon(kind),
        });
      planet = layers();
      background = layers();

      // Signal that viewer is ready (triggers layer effect)
      setViewerReady(true);
    });
  });

  /**
   * The imagery choice as a value, not as whatever the host reads to produce it. The host resolves it
   * through the module settings, which re-emit whenever the space or the agent's settings do; read
   * directly, every re-emission rebuilt the imagery and the surface flashed blue while the new tiles
   * loaded. Compared by content, since the host builds a new object each time.
   */
  const suppliedImagery = createMemo<ImageryChoice | undefined>(() => props.imagery, undefined, {
    equals: (a, b) => a?.provider === b?.provider && a?.key === b?.key,
  });

  /**
   * A key its provider has refused: expired (a release's demo token lives about two months), revoked,
   * over quota, or unreachable offline. Held so the globe can carry on without it, and cleared when the
   * network comes back, since an offline refusal says nothing about the key.
   */
  const [refusedKey, setRefusedKey] = createSignal<string>();

  /** The imagery in use: the one supplied, unless its provider has refused the key. */
  const imageryChoice = createMemo<ImageryChoice | undefined>(
    () => {
      const choice = suppliedImagery();
      return choice && choice.key !== refusedKey() ? choice : undefined;
    },
    undefined,
    { equals: (a, b) => a?.provider === b?.provider && a?.key === b?.key },
  );

  /** For layers that need an ion account, whatever imagery is drawn. */
  const ionToken = createMemo(() => props.ionAccessToken || undefined);

  /**
   * Bumped when the browser reports the network is back. Cesium never asks again for a tile that
   * failed, so a globe opened offline would otherwise keep Natural Earth II for good.
   */
  const [onlineEpoch, setOnlineEpoch] = createSignal(0);
  const onOnline = () => {
    setRefusedKey(undefined);
    setOnlineEpoch((n) => n + 1);
  };
  window.addEventListener('online', onOnline);
  onCleanup(() => window.removeEventListener('online', onOnline));

  /** The layers above Natural Earth II that this globe added, so it replaces exactly those. */
  let detail: ImageryLayer[] = [];

  // Detail imagery: replaced when the choice of imagery or its key changes, and when the network
  // comes back. Natural Earth II stays underneath throughout, so a replacement never shows bare blue.
  createEffect(() => {
    onlineEpoch();
    const choice = imageryChoice();
    if (!viewerReady() || !viewer) return;
    const imagery = viewer.imageryLayers;
    // Refused, the key is set aside and this runs again without it: NASA's imagery, not nothing.
    const next = detailImagery(choice, () => setRefusedKey(choice?.key));
    // Directly above the base, in order, beneath any imagery a WE layer has added.
    next.forEach((layer, index) => imagery.add(layer, 1 + index));
    for (const layer of detail) imagery.remove(layer, true);
    detail = next;
  });

  /**
   * A layer that needs an ion account is left out when there is no token, rather than mounted to
   * fail. Absent, as a kind with no renderer is: nothing errors and nothing is drawn.
   */
  const needsMissingIon = (kind: LayerKind) => !!kind.requires?.ionAccount && !ionToken();

  // Each list is kept in step with the template's, and only a layer whose own options changed hears
  // about it. Reading the token here makes a layer that needs ion appear or go with it.
  createEffect(() => {
    if (!viewerReady()) return;
    ionToken();
    background?.sync(props.backgroundLayers);
  });
  createEffect(() => {
    if (!viewerReady()) return;
    ionToken();
    planet?.sync(props.planetLayers);
  });

  // Cleanup on component unmount - MUST happen after layer cleanup
  onCleanup(() => {
    // Before anything else: stop the deferred construction, and tell it so. Cancelling is not on its
    // own sufficient — a frame already dispatched still runs its callback.
    disposed = true;
    if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
    pendingFrame = undefined;

    // First every layer, while the viewer they drew into still exists.
    planet?.dispose();
    background?.dispose();

    // Disconnect container resize observer
    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    // Then remove resize listener
    if (updateResolution) {
      window.removeEventListener('resize', updateResolution);
    }

    // Finally destroy viewer. `isDestroyed` because a layer cleanup above can destroy it first, and
    // Cesium throws on a second `destroy()` rather than ignoring it.
    if (viewer && !viewer.isDestroyed()) {
      viewer.destroy();
    }
    viewer = undefined;
  });

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', 'min-width': '200px', 'min-height': '200px' }} />
  );
}
