/**
 * The globe's **layer protocol**: what a layer kind is, and what its renderers receive.
 *
 * A layer kind is split in two. What it **means** (its id, its slot, its options) is the same on any
 * engine, and is all a template ever names. How it is **drawn** is a renderer per engine, which is the
 * only place an engine's API appears. A layer instance in a template never names an engine; the globe
 * that draws it does, and a kind with no renderer for that engine is absent rather than broken.
 *
 * Kept apart from the widget because writing a layer and placing a globe are separate jobs, done by
 * different people. Pure types: nothing here runs, and every import of Cesium is `import type`.
 */
import type { Viewer } from 'cesium';

/** The engines a globe can draw with. MapLibre joins Cesium in the next stage of this work. */
export type GlobeEngine = 'cesium';

/** Event bus shared by the layers on one globe, for layer-to-layer coordination. */
export interface LayerEventBus {
  emit(event: string, ...args: unknown[]): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  once(event: string, handler: (...args: unknown[]) => void): void;
}

/** What every renderer receives, whatever its engine. */
export interface RendererContext {
  /** This layer instance's key: its config `id`, or the kind's id when the template gave none. */
  id: string;
  /** Stacking order among planet layers; each kind interprets it for its own drawing. */
  zIndex?: number;
  events: LayerEventBus;
  /** Register something to undo when the layer unmounts. Everything a renderer adds goes here. */
  onCleanup(cleanup: () => void): void;
}

/** A Cesium renderer's context: the shared one, and the viewer. */
export interface CesiumRendererContext extends RendererContext {
  viewer: Viewer;
}

/** What a renderer hands back once mounted. */
export interface LayerRenderer<TOptions> {
  /**
   * Called when this layer's own options change, and only then. A renderer without `update` is
   * unmounted and mounted again with the new options instead, which is correct and slower.
   */
  update?(options: TOptions): void | Promise<void>;
}

/** Mounts one layer instance on one engine. May finish asynchronously (a fetch, a texture). */
export type RendererFactory<TOptions, TContext extends RendererContext> = (
  context: TContext,
  options: TOptions,
) => LayerRenderer<TOptions> | void | Promise<LayerRenderer<TOptions> | void>;

/** The renderers a kind has, by engine. */
export interface LayerRenderers<TOptions> {
  cesium?: RendererFactory<TOptions, CesiumRendererContext>;
}

/** A layer kind: what a template's `factory` names. */
export interface LayerKind<TOptions = unknown> {
  /** The name templates write in `factory`. */
  id: string;
  /** Which list it belongs in: `planetLayers` (on the earth) or `backgroundLayers` (the space around it). */
  slot: 'planet' | 'background';
  /** One line for authors; the catalogue carries the fuller account. */
  description: string;
  /** What the deployment or person must supply for it to draw. Without it the kind is absent. */
  requires?: { ionAccount?: boolean };
  renderers: LayerRenderers<TOptions>;
}

/** One layer instance as a template writes it. */
export interface LayerConfig<TOptions = unknown> {
  /** The kind, by id. */
  factory: string;
  /**
   * This instance's identity. Required when one kind appears twice in a list; without it the two
   * share the kind's id as their key and only one is drawn.
   */
  id?: string;
  options?: TOptions;
  /** Whether it is drawn. Usually an expression bound to a toggle. */
  enabled?: boolean;
  /** Stacking order among planet layers, passed to the renderer as `context.zIndex`. */
  zIndex?: number;
}

/** A globe's kinds, by id: what `factory` resolves against. */
export type LayerKinds = Record<string, LayerKind<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
