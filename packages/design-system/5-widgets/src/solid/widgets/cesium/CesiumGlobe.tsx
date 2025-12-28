/**
 * Cesium Globe Widget
 *
 * A 3D globe with modular layer system.
 * Uses CDN for all Cesium assets (no local bundling required).
 */

import { Viewer, Cartesian3, Ion, Cartographic, Math as CesiumMath, Color } from 'cesium';
import { onMount, onCleanup, type Accessor } from 'solid-js';
import type {
  CesiumLayer,
  LayerConfig,
  LayerContext,
  LayerEventBus,
  LayerStore,
  CameraState,
  LayerFactory,
} from './types';

// Layer factory registry - populated by importing packages
export const layerFactoryRegistry: Record<string, LayerFactory> = {};

// Legacy types (for backward compatibility)
interface UserLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color?: string;
}

export interface CesiumGlobeProps {
  /** @deprecated Use layers prop instead */
  locations?: UserLocation[] | string | (() => UserLocation[] | string);
  /**
   * Cesium Ion access token. Get one free at https://ion.cesium.com/
   * If not provided, uses Cesium's default demo token (limited quota)
   */
  ionAccessToken?: string;
  /** Layer configurations to add to the globe */
  layers?: LayerConfig[];
}

// Configure Cesium CDN
(window as any).CESIUM_BASE_URL = 'https://cdn.jsdelivr.net/npm/cesium@1.136.0/Build/Cesium/';

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
  private emitter = new Map<string, Set<(...args: any[]) => void>>();

  emit(event: string, ...args: any[]): void {
    const handlers = this.emitter.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(...args));
    }
  }

  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.emitter.has(event)) {
      this.emitter.set(event, new Set());
    }
    this.emitter.get(event)!.add(handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    const handlers = this.emitter.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  once(event: string, handler: (...args: any[]) => void): void {
    const onceHandler = (...args: any[]) => {
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
  private store = new Map<string, any>();

  get<T = any>(key: string): T | undefined {
    return this.store.get(key);
  }

  set<T = any>(key: string, value: T): void {
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
 * Topologically sort layers by dependencies
 */
function sortLayersByDependencies(layers: CesiumLayer[]): CesiumLayer[] {
  const sorted: CesiumLayer[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const layerMap = new Map(layers.map((l) => [l.name, l]));

  function visit(layer: CesiumLayer) {
    if (visited.has(layer.name)) return;
    if (visiting.has(layer.name)) {
      throw new Error(`Circular dependency detected: ${layer.name}`);
    }

    visiting.add(layer.name);

    if (layer.dependencies) {
      for (const dep of layer.dependencies) {
        const depLayer = layerMap.get(dep);
        if (!depLayer) {
          throw new Error(`Layer ${layer.name} depends on ${dep} which is not loaded`);
        }
        visit(depLayer);
      }
    }

    visiting.delete(layer.name);
    visited.add(layer.name);
    sorted.push(layer);
  }

  layers.forEach(visit);
  return sorted;
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

export function CesiumGlobe(props: CesiumGlobeProps) {
  let containerRef: HTMLDivElement | undefined;
  let viewer: Viewer | undefined;

  // Set Ion token if provided
  if (props.ionAccessToken) {
    Ion.defaultAccessToken = props.ionAccessToken;
  }

  // Legacy location parsing (for backward compatibility)
  const getLocations = (): UserLocation[] => {
    if (!props.locations) return [];
    const locs = typeof props.locations === 'function' ? props.locations() : props.locations;
    if (typeof locs === 'string') {
      try {
        return JSON.parse(locs);
      } catch {
        return [];
      }
    }
    return Array.isArray(locs) ? locs : [];
  };

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

      // Set initial camera (global view)
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(0, 20, 20000000),
      });

      // Initialize layer system
      const events = new SimpleEventBus();
      const store = new SimpleStore();
      const layerApis = new Map<string, any>();
      const cleanupFunctions = new Map<string, Array<() => void>>();

      // Mount layers
      if (props.layers && props.layers.length > 0) {
        const layerInstances = props.layers
          .filter((config) => config.enabled !== false)
          .map((config) => {
            const factory = resolveLayerFactory(config.factory);
            return factory(config.options);
          });

        // Sort by dependencies
        const sortedLayers = sortLayersByDependencies(layerInstances);

        // Mount each layer
        sortedLayers.forEach((layer) => {
          const cleanups: Array<() => void> = [];
          cleanupFunctions.set(layer.name, cleanups);

          const context: LayerContext = {
            viewer: viewer!,
            events,
            store,
            options: props.layers?.find((c) => {
              const factory = resolveLayerFactory(c.factory);
              return factory({}).name === layer.name;
            })?.options,
            onCleanup: (fn) => cleanups.push(fn),
            getLayer: (name) => layerApis.get(name),
          };

          // Execute onMount
          try {
            const result = layer.onMount?.(context);
            if (result instanceof Promise) {
              result.catch((err) => console.error(`Error mounting layer ${layer.name}:`, err));
            }

            // Store API if provided
            if (layer.api) {
              layerApis.set(layer.name, layer.api);
            }
          } catch (err) {
            console.error(`Error mounting layer ${layer.name}:`, err);
          }
        });

        // Set up camera change listener
        const cameraChangedHandler = () => {
          if (!viewer) return;

          const cameraPosition = viewer.camera.positionCartographic;
          const cameraState: CameraState = {
            position: {
              longitude: CesiumMath.toDegrees(cameraPosition.longitude),
              latitude: CesiumMath.toDegrees(cameraPosition.latitude),
              height: cameraPosition.height,
            },
            heading: viewer.camera.heading,
            pitch: viewer.camera.pitch,
            roll: viewer.camera.roll,
          };

          sortedLayers.forEach((layer) => {
            if (layer.onCameraChange) {
              const context: LayerContext = {
                viewer: viewer!,
                events,
                store,
                options: props.layers?.find((c) => {
                  const factory = resolveLayerFactory(c.factory);
                  return factory({}).name === layer.name;
                })?.options,
                onCleanup: (fn) => cleanupFunctions.get(layer.name)?.push(fn) || [],
                getLayer: (name) => layerApis.get(name),
              };
              layer.onCameraChange(context, cameraState);
            }
          });
        };

        viewer.camera.changed.addEventListener(cameraChangedHandler);

        // Cleanup function for layers
        onCleanup(() => {
          sortedLayers.reverse().forEach((layer) => {
            // Call onUnmount
            try {
              const context: LayerContext = {
                viewer: viewer!,
                events,
                store,
                options: props.layers?.find((c) => {
                  const factory = resolveLayerFactory(c.factory);
                  return factory({}).name === layer.name;
                })?.options,
                onCleanup: () => {}, // No-op for unmount
                getLayer: (name) => layerApis.get(name),
              };
              layer.onUnmount?.(context);
            } catch (err) {
              console.error(`Error unmounting layer ${layer.name}:`, err);
            }

            // Call cleanup functions
            const cleanups = cleanupFunctions.get(layer.name);
            if (cleanups) {
              cleanups.forEach((fn) => {
                try {
                  fn();
                } catch (err) {
                  console.error(`Error in cleanup for layer ${layer.name}:`, err);
                }
              });
            }
          });

          viewer?.camera.changed.removeEventListener(cameraChangedHandler);
        });
      }

      // Legacy location markers (for backward compatibility)
      if (props.locations) {
        const locations = getLocations();
        locations.forEach((loc) => {
          viewer?.entities.add({
            position: Cartesian3.fromDegrees(loc.longitude, loc.latitude),
            point: {
              pixelSize: 15,
              color: loc.color ? Color.fromCssColorString(loc.color) : Color.CYAN,
              outlineColor: Color.WHITE,
              outlineWidth: 2,
            },
            label: {
              text: loc.name,
              font: '14px sans-serif',
              fillColor: Color.WHITE,
              outlineColor: Color.BLACK,
              outlineWidth: 2,
              style: 0, // FILL_AND_OUTLINE
              pixelOffset: new Cartesian3(0, 20, 0),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        });
      }
    });
  });

  onCleanup(() => viewer?.destroy());

  return <div ref={containerRef} style={{ width: '100%', height: '100%', 'min-height': '400px' }} />;
}
