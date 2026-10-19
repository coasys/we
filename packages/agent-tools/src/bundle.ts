/**
 * The entry for `dist/agent-tools.bundle.js` — one ESM file with everything inlined, the
 * catalogue and the reference included, for a host that loads WE's tools as a single file rather
 * than installing packages. It runs anywhere a modern JS runtime does: it needs no DOM, no Node
 * and no network, and CI runs it under Deno to keep it that way.
 *
 * Only what a host calls is exported. The catalogue it validates against is the one this build was
 * made with, so the file is a statement about one WE build.
 */
export type { AgentTool, Toolset } from './core/toolset';
export type { TemplateEdit, TemplateToolsetOptions } from './templates/templateToolset';
export { createTemplateToolset } from './templates/templateToolset';
