/**
 * Cartridges: whole apps as data, built by hand.
 *
 * A spike. Each is a shell, its sections, a theme, the kinds of record it is about and the modules it
 * needs — everything a host already understands as data, nothing it would have to run. They exist to
 * find out where data runs out before any install flow is designed: see
 * `notes/we/October-2026/cartridges-plan.md`.
 */
export type { Cartridge } from './cartridge.ts';
export { shape, toFixture } from './cartridge.ts';
export { fieldGuide } from './field-guide/index.ts';
export { toolLibrary } from './tool-library/index.ts';
