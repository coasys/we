/**
 * The layer protocol, re-exported as this package's public contract surface.
 *
 * **This is the import a layer author should use** — including third-party layers, which need not
 * live in this monorepo at all (the globe resolves layers through a `LayerKinds` record of `LayerKind`s
 * the app injects, so an external layer is just a package exporting a factory).
 *
 * The types are defined in `@we/globe-protocol` — the contract half of `globe-system/`, which this
 * package is the implementations half of. A layer author may depend on either: the protocol alone
 * to write a layer, or this package to also get WE's first-party layers. Neither names the renderer
 * — `CesiumGlobe` (in `@we/widgets`) is just another implementer of the same contract.
 */

export type {
  CesiumRendererContext,
  GlobeEngine,
  LayerConfig,
  LayerEventBus,
  LayerKind,
  LayerKinds,
  LayerRenderer,
  LayerRenderers,
  RendererContext,
  RendererFactory,
} from '@we/globe-protocol';
