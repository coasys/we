export { RenderSchema } from './SchemaRenderer';

/*
  The measuring half of a surface, for hosts.

  A host's own surfaces are existing elements — the template's scroll container, a dock panel's
  content region — that already carry a background, a theme attribute and a ref. They attach these
  pieces to what they have rather than mounting a `$surface` node, which would add a layout box and
  put the scroll container in the wrong place.
*/
export { createSurface } from './createSurface';
export type { Surface, SurfaceState } from './createSurface';

export { updateSchema } from './schemaUpdater';
export type { SchemaUpdateResult } from './schemaUpdater';

export type { ComponentRegistry, RenderProps, RendererOutput, SchemaNode, ThemeOverrides } from './types';

export { VisualEditorProvider, useVisualEditor } from './VisualEditorContext';
export type { VisualEditorContextValue } from './VisualEditorContext';
