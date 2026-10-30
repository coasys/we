/**
 * Messages: what a line of conversation is, and how one is drawn.
 *
 * A library rather than a module. The call transcript (`@we/module-transcribe`) and the Feed
 * (`@we/module-feed`) both write and draw messages, and a module may not depend on a module — so
 * what they share is here, imported by both at build time, the way the globe family shares its
 * packages. Nothing here is a capability; each module keeps its own actions and passes their store's
 * name to the line it draws.
 */
export { messageLine } from './messageLine.ts';
export { CORRECTED, SPOKEN, sourceAfterEdit, TYPED } from './source.ts';
export { lineContent, repliesInclude, threadLines, threadLinesFunction } from './thread.ts';
