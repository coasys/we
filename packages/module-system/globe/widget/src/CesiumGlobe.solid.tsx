/**
 * Cesium Globe Widget
 *
 * A 3D globe with modular layer system.
 * Uses CDN for all Cesium assets (no local bundling required).
 */

import { Cartesian3, Ion, Viewer } from 'cesium';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

export type * from './CesiumGlobe.types';
import type { CesiumLayer, LayerConfig, LayerEventBus, LayerFactory, LayerStore } from '@we/globe-protocol';

import type { CesiumGlobeProps } from './CesiumGlobe.types';

// Configure Cesium CDN
(window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/cesium@1.136.0/Build/Cesium/';

// Load Cesium CSS
if (typeof document !== 'undefined' && !document.querySelector('link[href*="cesium"]')) {
  const cesiumCss = document.createElement('link');
  cesiumCss.rel = 'stylesheet';
  cesiumCss.href = 'https://cdn.jsdelivr.net/npm/cesium@1.136.0/Build/Cesium/Widgets/widgets.css';
  document.head.appendChild(cesiumCss);
}

/**
 * Simple event bus implementation
 */
class SimpleEventBus implements LayerEventBus {
  private emitter = new Map<string, Set<(...args: unknown[]) => void>>();

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.emitter.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(...args));
    }
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.emitter.has(event)) {
      this.emitter.set(event, new Set());
    }
    this.emitter.get(event)!.add(handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    const handlers = this.emitter.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  once(event: string, handler: (...args: unknown[]) => void): void {
    const onceHandler = (...args: unknown[]) => {
      handler(...args);
      this.off(event, onceHandler);
    };
    this.on(event, onceHandler);
  }
}

/**
 * Simple store implementation
 */
class SimpleStore implements LayerStore {
  private store = new Map<string, unknown>();

  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  set<T = unknown>(key: string, value: T): void {
    this.store.set(key, value);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Resolve layer factory - handles both function and string references
 */
function resolveLayerFactory(
  factory: LayerFactory | string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registry: Record<string, LayerFactory<any>>,
): LayerFactory {
  if (typeof factory === 'string') {
    const resolved = registry[factory];
    if (!resolved) {
      throw new Error(
        `Layer factory "${factory}" not found in registry. Available: ${Object.keys(registry).join(', ')}`,
      );
    }
    return resolved;
  }
  return factory;
}

// Extend Viewer type to store our layer tracking
interface ViewerWithLayers extends Viewer {
  _weMountedLayers?: Map<string, { config: LayerConfig; instance: CesiumLayer }>;
  _weMountedBackgroundLayers?: Map<string, { config: LayerConfig; instance: CesiumLayer }>;
  _weLayerEffectRunning?: boolean;
}

export function CesiumGlobe(props: CesiumGlobeProps) {
  let containerRef: HTMLDivElement | undefined;
  let viewer: ViewerWithLayers | undefined;
  let events: SimpleEventBus | undefined;
  let store: SimpleStore | undefined;
  let cleanupFunctions: Map<string, Array<() => void>> | undefined;
  let updateResolution: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  /** The deferred construction frame, so unmounting before it fires can cancel it. */
  let pendingFrame: number | undefined;
  /** Set by cleanup. The frame callback checks it, since cancellation alone is not a guarantee. */
  let disposed = false;

  const [viewerReady, setViewerReady] = createSignal(false);

  // Set Ion token if provided
  if (props.ionAccessToken) {
    Ion.defaultAccessToken = props.ionAccessToken;
  }

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

      // Initialize layer system
      events = new SimpleEventBus();
      store = new SimpleStore();
      cleanupFunctions = new Map<string, Array<() => void>>();
      viewer._weMountedLayers = new Map<string, { config: LayerConfig; instance: CesiumLayer }>();
      viewer._weMountedBackgroundLayers = new Map<string, { config: LayerConfig; instance: CesiumLayer }>();

      // Signal that viewer is ready (triggers layer effect)
      setViewerReady(true);
    });
  });

  // Reactive background layer mounting/unmounting
  createEffect(() => {
    // Track viewer readiness signal
    if (!viewerReady()) {
      return;
    }

    if (!viewer || !events || !store || !cleanupFunctions || !viewer._weMountedBackgroundLayers) {
      return;
    }

    const currentLayers = props.backgroundLayers || [];
    const mountedLayers = viewer._weMountedBackgroundLayers;

    const enabledLayers = currentLayers.filter((config) => config.enabled !== false);

    // Resolve instances upfront to get their names for stable keying
    type ResolvedBgLayer = { config: LayerConfig; instance: CesiumLayer; layerKey: string };
    const enabledResolved: ResolvedBgLayer[] = [];
    for (const config of enabledLayers) {
      try {
        const factory = resolveLayerFactory(config.factory, props.layerFactoryRegistry);
        const instance = factory(config.options);
        enabledResolved.push({ config, instance, layerKey: config.id ?? instance.name });
      } catch (err) {
        console.error(`Error resolving background layer factory:`, err);
      }
    }

    const enabledKeys = new Set(enabledResolved.map((r) => r.layerKey));

    // Unmount layers no longer enabled
    for (const layerKey of Array.from(mountedLayers.keys())) {
      if (!enabledKeys.has(layerKey)) {
        const cleanups = cleanupFunctions!.get(`bg-${layerKey}`);
        if (cleanups) {
          cleanups.forEach((fn) => {
            try {
              fn();
            } catch (err) {
              console.error(`Error cleaning up background layer:`, err);
            }
          });
          cleanupFunctions.delete(`bg-${layerKey}`);
        }
        mountedLayers.delete(layerKey);
      }
    }

    // Mount new layers
    for (const { config, instance, layerKey } of enabledResolved) {
      if (mountedLayers.has(layerKey)) {
        continue;
      }

      const cleanups: Array<() => void> = [];

      mountedLayers.set(layerKey, { config, instance });
      cleanupFunctions!.set(`bg-${layerKey}`, cleanups);

      try {
        const result = instance.onMount?.({
          viewer: viewer!,
          events: events!,
          store: store!,
          options: config.options,
          id: layerKey,
          zIndex: config.zIndex,
          onCleanup: (fn) => cleanups.push(fn),
        });

        if (result instanceof Promise) {
          result.catch((err) => console.error(`Error mounting background layer:`, err));
        }
      } catch (err) {
        console.error(`Error mounting background layer:`, err);
        mountedLayers.delete(layerKey);
        cleanupFunctions.delete(`bg-${layerKey}`);
      }
    }
  });

  // Reactive layer mounting/unmounting
  createEffect(() => {
    // Track viewer readiness signal
    if (!viewerReady()) {
      return;
    }

    if (!viewer || !events || !store || !cleanupFunctions || !viewer._weMountedLayers) {
      return;
    }

    const currentLayers = props.planetLayers || [];
    const mountedLayers = viewer._weMountedLayers;

    // Resolve instances upfront so we can key by config.id ?? instance.name.
    // This lets the same factory be used multiple times with distinct ids.
    type ResolvedLayer = { config: LayerConfig; instance: CesiumLayer; layerKey: string };
    const enabledResolved: ResolvedLayer[] = [];
    for (const config of currentLayers.filter((c) => c.enabled !== false)) {
      try {
        const factory = resolveLayerFactory(config.factory, props.layerFactoryRegistry);
        const instance = factory(config.options);
        enabledResolved.push({ config, instance, layerKey: config.id ?? instance.name });
      } catch (err) {
        console.error(`Error resolving layer factory:`, err);
      }
    }

    const enabledLayerKeys = new Set(enabledResolved.map((r) => r.layerKey));

    // Unmount layers no longer enabled
    for (const layerKey of Array.from(mountedLayers.keys())) {
      if (!enabledLayerKeys.has(layerKey)) {
        const cleanups = cleanupFunctions!.get(layerKey);
        if (cleanups) {
          cleanups.forEach((fn) => {
            try {
              fn();
            } catch (err) {
              console.error(`Error cleaning up layer:`, err);
            }
          });
          cleanupFunctions.delete(layerKey);
        }
        mountedLayers.delete(layerKey);
      }
    }

    // Mount new layers or update already-mounted ones
    for (const { config, instance, layerKey } of enabledResolved) {
      if (mountedLayers.has(layerKey)) {
        // Layer is already mounted — call onUpdate with the new options if supported
        const mounted = mountedLayers.get(layerKey)!;
        if (mounted.instance.onUpdate) {
          mounted.config = config;
          try {
            const result = mounted.instance.onUpdate({
              viewer: viewer!,
              events: events!,
              store: store!,
              options: config.options,
              id: layerKey,
              zIndex: config.zIndex,
              onCleanup: (fn) => cleanupFunctions!.get(layerKey)?.push(fn),
            });
            if (result instanceof Promise) {
              result.catch((err) => console.error(`Error updating layer "${layerKey}":`, err));
            }
          } catch (err) {
            console.error(`Error updating layer "${layerKey}":`, err);
          }
        }
        continue;
      }

      const cleanups: Array<() => void> = [];

      mountedLayers.set(layerKey, { config, instance });
      cleanupFunctions!.set(layerKey, cleanups);

      try {
        const result = instance.onMount?.({
          viewer: viewer!,
          events: events!,
          store: store!,
          options: config.options,
          id: layerKey,
          zIndex: config.zIndex,
          onCleanup: (fn) => cleanups.push(fn),
        });

        if (result instanceof Promise) {
          result.catch((err) => console.error(`Error mounting layer:`, err));
        }
      } catch (err) {
        console.error(`Error mounting layer:`, err);
        mountedLayers.delete(layerKey);
        cleanupFunctions.delete(layerKey);
      }
    }
  });

  // Cleanup on component unmount - MUST happen after layer cleanup
  onCleanup(() => {
    // Before anything else: stop the deferred construction, and tell it so. Cancelling is not on its
    // own sufficient — a frame already dispatched still runs its callback.
    disposed = true;
    if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
    pendingFrame = undefined;

    // First cleanup all layers
    if (cleanupFunctions) {
      for (const cleanups of cleanupFunctions.values()) {
        cleanups.forEach((fn) => {
          try {
            fn();
          } catch (err) {
            console.error('Error cleaning up layer:', err);
          }
        });
      }
      cleanupFunctions.clear();
    }

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
