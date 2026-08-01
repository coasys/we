/**
 * The layer protocol, re-exported as this package's public contract surface.
 *
 * **This is the import a layer author should use** — including third-party layers, which need not
 * live in this monorepo at all (the globe resolves layers through a `Record<string, LayerFactory>`
 * the app injects, so an external layer is just a package exporting a factory). Importing from here
 * rather than `@we/widgets` means an external layer never names the renderer package.
 *
 * The types are defined in `@we/widgets` (`widgets/cesium/protocol.ts`) and only re-exported here:
 * ~130 lines of pure interfaces with no logic and no tests is Pattern B in
 * `docs/architecture/package-conventions.md` — colocate; a separate package is for shared code with
 * real substance. `@we/widgets` is a `peerDependency` and every import of it is `import type`, so
 * this costs nothing at runtime.
 */

export type {
  CesiumLayer,
  LayerFactory,
  LayerConfig,
  LayerContext,
  LayerEventBus,
  LayerStore,
  LayerMetadata,
  CameraState,
} from '@we/widgets/solid';
