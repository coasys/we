/**
 * `@we/globe-core`: everything about drawing a globe that is not drawing.
 *
 * Shared by every engine's renderers, so a kind behaves the same on each: which layers are mounted
 * and when they update, and (as the data kinds arrive) reading geometry from rows, resolving style
 * rules, aggregating and diffing. A renderer only turns what this produces into its engine's calls.
 */
export { EventBus } from './events';
export { forwardingHandlers, LayerSet, type LayerSetOptions, optionsEqual } from './layerSet';
