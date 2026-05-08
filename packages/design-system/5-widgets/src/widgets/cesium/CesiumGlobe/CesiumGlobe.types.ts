import type { Viewer } from 'cesium';

/**
 * Camera state information passed to layers on camera changes
 */
export interface CameraState {
  /** Camera position in world coordinates */
  position: {
    longitude: number;
    latitude: number;
    height: number;
  };
  /** Camera heading (rotation around up axis) in radians */
  heading: number;
  /** Camera pitch (rotation around right axis) in radians */
  pitch: number;
  /** Camera roll (rotation around direction) in radians */
  roll: number;
}

/**
 * Event bus for inter-layer communication
 */
export interface LayerEventBus {
  /** Emit an event to all listeners */
  emit(event: string, ...args: unknown[]): void;
  /** Listen to an event */
  on(event: string, handler: (...args: unknown[]) => void): void;
  /** Remove event listener */
  off(event: string, handler: (...args: unknown[]) => void): void;
  /** Listen to an event once */
  once(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Shared key-value store for layer state
 */
export interface LayerStore {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
}

/**
 * Context provided to each layer during its lifecycle
 */
export interface LayerContext<TOptions = unknown> {
  /** The Cesium viewer instance */
  viewer: Viewer;
  /** Event bus for communication between layers and app */
  events: LayerEventBus;
  /** Shared store for layer state */
  store: LayerStore;
  /** Layer-specific options/configuration */
  options?: TOptions;
  /**
   * Stable identity for this layer instance — sourced from `LayerConfig.id`.
   * Use for namespacing entity IDs, log messages, etc.
   * Falls back to the layer's own `name` if no `id` was provided in the config.
   */
  id: string;
  /** Register cleanup function to be called when layer unmounts */
  onCleanup: (cleanup: () => void) => void;
}

/**
 * Metadata about layer requirements and capabilities
 */
export interface LayerMetadata {
  /** Whether this layer requires a Cesium Ion account */
  requiresIonAccount?: boolean;
  /** Specific Ion asset IDs required by this layer */
  requiresIonAssets?: number[];
  /** Human-readable description of the layer */
  description?: string;
}

/**
 * Core layer protocol interface
 */
export interface CesiumLayer<TOptions = unknown> {
  /** Unique layer name */
  name: string;

  /** Metadata about layer requirements and capabilities */
  metadata?: LayerMetadata;

  /** Optional dependencies (layer names that must be loaded first) */
  dependencies?: string[];

  /** Called when layer is added to the viewer */
  onMount?: (context: LayerContext<TOptions>) => void | Promise<void>;

  /** Called when layer is removed from the viewer */
  onUnmount?: (context: LayerContext<TOptions>) => void | Promise<void>;

  /** Called when layer options are updated */
  onUpdate?: (context: LayerContext<TOptions>) => void | Promise<void>;

  /** Called when camera position/orientation changes */
  onCameraChange?: (context: LayerContext<TOptions>, camera: CameraState) => void;

  /** Optional API exposed to other layers */
  api?: unknown;
}

/**
 * Factory function type for creating layer instances
 */
export type LayerFactory<TOptions = unknown> = (options?: TOptions) => CesiumLayer<TOptions>;

/**
 * Layer configuration that can be passed to CesiumGlobe
 */
export interface LayerConfig<TOptions = unknown> {
  /** Layer factory function or string name (resolved via registry) */
  factory: LayerFactory<TOptions> | string;
  /**
   * Stable identity for this layer instance.
   * Required when the same factory is used more than once (e.g. two pointLocationsLayer
   * entries). Used as the mount-map key and passed into LayerContext so factories can
   * namespace their Cesium entity IDs without needing a separate option.
   * Defaults to the layer instance's own `name` when omitted.
   */
  id?: string;
  /** Layer options */
  options?: TOptions;
  /** Whether layer is initially enabled */
  enabled?: boolean;
}

/**
 * @ai 3D globe widget using CesiumJS with a modular layer system.
 * Layers are injected via factory functions (planet surface + background).
 * Requires a layer factory registry mapping string names to factory functions.
 * Not schema-renderable — used directly in application code.
 */
export interface CesiumGlobeProps {
  /**
   * Cesium Ion access token. Get one free at https://ion.cesium.com/
   * If not provided, uses Cesium's default demo token (limited quota)
   */
  ionAccessToken?: string;
  /** Planet surface layer configurations (locations, outlines, hexagons, etc.) */
  planetLayers?: LayerConfig[];
  /** Background/space layer configurations (skybox, stars, etc.) */
  backgroundLayers?: LayerConfig[];
  /** Layer factory registry - injected from app */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  layerFactoryRegistry: Record<string, LayerFactory<any>>;
}
