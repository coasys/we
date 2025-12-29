/**
 * Cesium Globe Widget
 *
 * A 3D globe with modular layer system.
 * Uses CDN for all Cesium assets (no local bundling required).
 */

import { Cartesian3, Color, Ion, PointPrimitive, PointPrimitiveCollection, SkyBox, Viewer } from 'cesium';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

import type { CesiumLayer, LayerConfig, LayerEventBus, LayerFactory, LayerStore } from './types';

// Layer factory registry - populated by importing packages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const layerFactoryRegistry: Record<string, LayerFactory<any>> = {};

export interface CesiumGlobeProps {
  /**
   * Cesium Ion access token. Get one free at https://ion.cesium.com/
   * If not provided, uses Cesium's default demo token (limited quota)
   */
  ionAccessToken?: string;
  /** Layer configurations to add to the globe */
  layers?: LayerConfig[];
  /** Background layer configurations (skybox, stars, etc.) */
  backgroundLayers?: LayerConfig[];
  /** @deprecated Use backgroundLayers instead. Show custom skybox (default: true) */
  showSkybox?: boolean;
  /** @deprecated Use backgroundLayers instead. Show procedural star field (default: true) */
  showStars?: boolean;
}

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
function resolveLayerFactory(factory: LayerFactory | string): LayerFactory {
  if (typeof factory === 'string') {
    const resolved = layerFactoryRegistry[factory];
    if (!resolved) {
      throw new Error(
        `Layer factory "${factory}" not found in registry. Available: ${Object.keys(layerFactoryRegistry).join(', ')}`,
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
  let starCollection: PointPrimitiveCollection | undefined;

  const [viewerReady, setViewerReady] = createSignal(false);

  // Debug: Log props on every render
  console.log('[CesiumGlobe] Component render/update:', {
    showSkybox: props.showSkybox,
    showStars: props.showStars,
    showSkyboxType: typeof props.showSkybox,
    showStarsType: typeof props.showStars,
  });

  // Set Ion token if provided
  if (props.ionAccessToken) {
    Ion.defaultAccessToken = props.ionAccessToken;
  }

  onMount(() => {
    if (!containerRef) return;

    // Wait for next frame to ensure DOM is ready
    requestAnimationFrame(() => {
      if (!containerRef) return;

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
      });

      // Set high resolution for crisp rendering on high-DPI displays
      viewer.resolutionScale = window.devicePixelRatio;

      // Keep consistent lighting and hide moon
      viewer.scene.globe.enableLighting = false;
      if (viewer.scene.moon) {
        viewer.scene.moon.show = false;
      }

      // Update resolution scale when window resizes or device pixel ratio changes
      updateResolution = () => {
        if (viewer) {
          viewer.resolutionScale = window.devicePixelRatio;
        }
      };
      window.addEventListener('resize', updateResolution);

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

    // Get enabled layers (tracking reactive dependencies)
    const enabledLayers = currentLayers.filter((config) => {
      const enabled = config.enabled;
      return typeof enabled === 'function' ? (enabled as () => boolean)() !== false : enabled !== false;
    });

    const enabledFactoryNames = new Set(enabledLayers.map((c) => String(c.factory)));

    // Unmount layers no longer enabled
    for (const factoryName of Array.from(mountedLayers.keys())) {
      if (!enabledFactoryNames.has(factoryName)) {
        // Call cleanup functions
        const cleanups = cleanupFunctions!.get(`bg-${factoryName}`);
        if (cleanups) {
          cleanups.forEach((fn) => {
            try {
              fn();
            } catch (err) {
              console.error(`Error cleaning up background layer:`, err);
            }
          });
          cleanupFunctions.delete(`bg-${factoryName}`);
        }

        mountedLayers.delete(factoryName);
      }
    }

    // Mount new layers
    for (const config of enabledLayers) {
      const factoryName = String(config.factory);

      if (mountedLayers.has(factoryName)) {
        continue;
      }

      const factory = resolveLayerFactory(config.factory);
      const instance = factory(config.options);
      const cleanups: Array<() => void> = [];

      mountedLayers.set(factoryName, { config, instance });
      cleanupFunctions!.set(`bg-${factoryName}`, cleanups);

      try {
        const result = instance.onMount?.({
          viewer: viewer!,
          events: events!,
          store: store!,
          options: config.options,
          onCleanup: (fn) => cleanups.push(fn),
        });

        if (result instanceof Promise) {
          result.catch((err) => console.error(`Error mounting background layer:`, err));
        }
      } catch (err) {
        console.error(`Error mounting background layer:`, err);
        mountedLayers.delete(factoryName);
        cleanupFunctions.delete(`bg-${factoryName}`);
      }
    }
  });

  // DEPRECATED: Reactive skybox control (use backgroundLayers instead)
  createEffect(() => {
    // Skip if using new backgroundLayers prop
    if (props.backgroundLayers && props.backgroundLayers.length > 0) return;

    // ACCESS REACTIVE DEPENDENCIES FIRST before any early returns!
    // Props from stores come as accessor functions that we need to call
    let showSkyboxValue: boolean | undefined;
    try {
      // Try calling as function first (if it's from a store)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      showSkyboxValue = (props.showSkybox as any)?.();
    } catch {
      // If it fails, use direct value
      showSkyboxValue = props.showSkybox;
    }
    const showSkybox = showSkyboxValue !== false; // Default to true

    console.log('[CesiumGlobe] Skybox effect triggered (DEPRECATED):', { showSkyboxValue, showSkybox });

    // NOW check if viewer is ready (after accessing reactive deps)
    if (!viewer || !viewerReady()) return;

    if (showSkybox) {
      // Create or replace skybox
      if (viewer.scene.skyBox) {
        viewer.scene.skyBox.show = true;
        console.log('[CesiumGlobe] Skybox shown');
      } else {
        viewer.scene.skyBox = new SkyBox({
          sources: {
            positiveX: '/skybox/px.jpg',
            negativeX: '/skybox/nx.jpg',
            positiveY: '/skybox/py.jpg',
            negativeY: '/skybox/ny.jpg',
            positiveZ: '/skybox/pz.jpg',
            negativeZ: '/skybox/nz.jpg',
          },
        });
        console.log('[CesiumGlobe] Skybox created');
      }
    } else {
      // Hide skybox by setting show to false
      if (viewer.scene.skyBox) {
        viewer.scene.skyBox.show = false;
        console.log('[CesiumGlobe] Skybox hidden');
      }
    }
  });

  // DEPRECATED: Reactive procedural stars control (use backgroundLayers instead)
  createEffect(() => {
    // Skip if using new backgroundLayers prop
    if (props.backgroundLayers && props.backgroundLayers.length > 0) return;

    // ACCESS REACTIVE DEPENDENCIES FIRST before any early returns!
    let showStarsValue: boolean | undefined;
    try {
      // Try calling as function first (if it's from a store)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      showStarsValue = (props.showStars as any)?.();
    } catch {
      // If it fails, use direct value
      showStarsValue = props.showStars;
    }
    const showStars = showStarsValue !== false; // Default to true

    console.log('[CesiumGlobe] Stars effect triggered (DEPRECATED):', { showStarsValue, showStars });

    // NOW check if viewer is ready (after accessing reactive deps)
    if (!viewer || !viewerReady()) return;

    if (showStars && !starCollection) {
      // Create stars
      const starCount = 5000;
      starCollection = viewer.scene.primitives.add(new PointPrimitiveCollection());

      // Generate stars at varying distances for parallax effect
      for (let i = 0; i < starCount; i++) {
        // Random position on sphere
        const theta = Math.random() * Math.PI * 2; // Longitude
        const phi = Math.acos(2 * Math.random() - 1); // Latitude (uniform distribution)

        // Vary distance for parallax effect (closer stars move faster)
        // Distance range: 50M km to 500M km
        const distance = 50000000 + Math.random() * 450000000;

        const x = distance * Math.sin(phi) * Math.cos(theta);
        const y = distance * Math.sin(phi) * Math.sin(theta);
        const z = distance * Math.cos(phi);

        // Vary star brightness and size for realism
        const brightness = 0.3 + Math.random() * 0.7;
        const size = 1 + Math.random() * 2;

        starCollection?.add({
          position: new Cartesian3(x, y, z),
          color: Color.WHITE.withAlpha(brightness),
          pixelSize: size,
        });
      }
    }

    // Update visibility if collection exists
    if (starCollection) {
      starCollection.show = showStars;
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

    const currentLayers = props.layers || [];
    const mountedLayers = viewer._weMountedLayers;

    // Get enabled layers (tracking reactive dependencies)
    const enabledLayers = currentLayers.filter((config) => {
      const enabled = config.enabled;
      return typeof enabled === 'function' ? (enabled as () => boolean)() !== false : enabled !== false;
    });

    const enabledFactoryNames = new Set(enabledLayers.map((c) => String(c.factory)));

    // Unmount layers no longer enabled
    for (const factoryName of Array.from(mountedLayers.keys())) {
      if (!enabledFactoryNames.has(factoryName)) {
        // Call cleanup functions
        const cleanups = cleanupFunctions!.get(factoryName);
        if (cleanups) {
          cleanups.forEach((fn) => {
            try {
              fn();
            } catch (err) {
              console.error(`Error cleaning up layer:`, err);
            }
          });
          cleanupFunctions.delete(factoryName);
        }

        mountedLayers.delete(factoryName);
      }
    }

    // Mount new layers
    for (const config of enabledLayers) {
      const factoryName = String(config.factory);

      if (mountedLayers.has(factoryName)) {
        continue;
      }

      const factory = resolveLayerFactory(config.factory);
      const instance = factory(config.options);
      const cleanups: Array<() => void> = [];

      mountedLayers.set(factoryName, { config, instance });
      cleanupFunctions!.set(factoryName, cleanups);

      try {
        const result = instance.onMount?.({
          viewer: viewer!,
          events: events!,
          store: store!,
          options: config.options,
          onCleanup: (fn) => cleanups.push(fn),
        });

        if (result instanceof Promise) {
          result.catch((err) => console.error(`Error mounting layer:`, err));
        }
      } catch (err) {
        console.error(`Error mounting layer:`, err);
        mountedLayers.delete(factoryName);
        cleanupFunctions.delete(factoryName);
      }
    }
  });

  // Cleanup on component unmount - MUST happen after layer cleanup
  onCleanup(() => {
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

    // Clean up star collection
    if (starCollection && viewer) {
      viewer.scene.primitives.remove(starCollection);
      starCollection = undefined;
    }

    // Then remove resize listener
    if (updateResolution) {
      window.removeEventListener('resize', updateResolution);
    }

    // Finally destroy viewer
    if (viewer) {
      viewer.destroy();
    }
  });

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', 'min-width': '200px', 'min-height': '200px' }} />
  );
}
