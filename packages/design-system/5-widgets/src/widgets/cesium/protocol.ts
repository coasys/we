/**
 * The Cesium **layer protocol** — the contract a layer implements, independent of any widget.
 *
 * Kept apart from `CesiumGlobe.types.ts` because these serve a different audience. `CesiumGlobeProps`
 * is for someone *placing the globe*; everything here is for someone *writing a layer*, which is a
 * separate act and increasingly a third-party one. Mixing them left a layer author reading a file and
 * working out which half applied to them.
 *
 * Layer authors should import these from `@we/cesium-layers`, which re-exports them as its public
 * contract surface — that keeps an external layer from naming `@we/widgets` at all. The types live
 * here rather than in a package of their own deliberately: they are ~130 lines of pure interfaces
 * with no logic and no tests, which is Pattern B in `docs/architecture/package-conventions.md`
 * (colocate; a separate package is for shared code with real substance). They also erase entirely at
 * build time — `@we/widgets` is a `peerDependency` of `@we/cesium-layers` and every import of it is
 * `import type` — so no consumer carries runtime weight for them.
 */
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
 * Shared key-value store for layer state.
 *
 * Note this is a plain scratchpad for layer-to-layer state, **not** a WE store — the globe widget
 * touches no app state, which is what keeps it a design-system widget rather than a feature module.
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
  /**
   * Stacking / rendering order for this layer (from `LayerConfig.zIndex`).
   * Higher values should appear visually above lower values.
   * Layers that need 3-D elevation (e.g. point markers) use this to compute an
   * altitude offset so that picking and depth-sorting work correctly.
   */
  zIndex?: number;
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
  /**
   * Stacking / rendering order. Higher values render on top of lower values.
   * Passed through to `LayerContext.zIndex` so each layer can translate the
   * priority into whatever Cesium mechanism it needs (elevation offset,
   * primitive ordering, depth-test bypasses, etc.).
   */
  zIndex?: number;
}
