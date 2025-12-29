/**
 * Cesium Globe Widget
 *
 * A 3D globe with modular layer system.
 * Uses CDN for all Cesium assets (no local bundling required).
 */

import { Cartesian3, Ion, Viewer } from 'cesium';
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
  _weLayerEffectRunning?: boolean;
}

export function CesiumGlobe(props: CesiumGlobeProps) {
  let containerRef: HTMLDivElement | undefined;
  let viewer: ViewerWithLayers | undefined;
  let events: SimpleEventBus | undefined;
  let store: SimpleStore | undefined;
  let cleanupFunctions: Map<string, Array<() => void>> | undefined;
  let updateResolution: (() => void) | undefined;

  const [viewerReady, setViewerReady] = createSignal(false);

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

      // Signal that viewer is ready (triggers layer effect)
      setViewerReady(true);
    });
  });

  // Cleanup on unmount
  onCleanup(() => {
    if (updateResolution) {
      window.removeEventListener('resize', updateResolution);
    }
    if (viewer) {
      viewer.destroy();
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

  onCleanup(() => viewer?.destroy());

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', 'min-width': '200px', 'min-height': '200px' }} />
  );
}
