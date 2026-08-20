/**
 * WE's template and theme editing surface.
 *
 * Embeddable: the editor reaches its host entirely through {@link EditorHost}, so an application
 * supplies template and theme access from whatever it already has. WE forwards its stores; another
 * application forwards its own state. Nothing here imports a backend, a store, or WE's shell.
 *
 * The AI panel is a separate entry (`@we/editor/ai`) so a deployment without an API key never
 * bundles a prompt.
 */
// The public component surface is exactly what the app shell lazy-loads
// (`import('@we/editor').then((m) => m.X)` in componentRegistry/TemplateLayout —
// dynamic imports, so a grep for static imports will NOT find these consumers;
// trimming them broke the toolbar once already). Everything else (CodePanel,
// InspectorPanel, ThemePanel, …) is internal to these four and stays unexported.
export { EditingBar } from './components/EditingBar';
export { EditorOverlay } from './components/EditorOverlay';
export { TemplateCard } from './components/TemplateCard';
/*
  The four panels, exported one at a time now that each is a *dock*.

  They used to be internal to `RightPanelContainer`, which owned a rail per panel, their widths, their
  open/close animation and their position at the right edge — a second panel system beside the shell's,
  and the reason panels from the two kept landing on top of each other: two arbiters, each reading a
  custom property the other published, each correct on its own.

  The shell places them now, as it places a call stage or a notes panel. What is left in this package
  is what only it can know — what goes *inside* each panel.
*/
export { CodePanel } from './components/CodePanel';
export { InspectorPanel } from './components/InspectorPanel';
export { ThemePanel } from './components/ThemePanel';

export { mountTemplateEditor, type MountOptions } from './mount';
export { EditorSurfaceProvider, type EditorSurface, type SurfacePositioning, useEditorSurface } from './surface';
export * from './host';
