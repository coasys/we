/**
 * Cartridges: whole apps as data.
 *
 * Each is a shell, its sections, a theme, the kinds of record it is about and the modules it needs —
 * and, for an app that is not WE, its chrome, its name and mark, and its sign-in screen. Everything a
 * host already understands as data, nothing it would have to run. Each is written out as a bundle
 * under `bundles/`, which a seed builds in and a person can install from a file.
 *
 * The field guide and the tool library began as a spike to find where data runs out; Coasys is the
 * first built to ship. Each cartridge's folder holds its own source; see `coasys/README.md` for the
 * layout.
 */
export type { Cartridge } from './cartridge.ts';
export { bundleFileName, cartridgeBundles } from './bundles.ts';
export { shape, toBundle, toFixture } from './cartridge.ts';
export { coasys } from './coasys/index.ts';
export { fieldGuide } from './field-guide/index.ts';
export { toolLibrary } from './tool-library/index.ts';
