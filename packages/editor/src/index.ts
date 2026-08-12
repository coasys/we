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
export { DesignToolbar } from './components/DesignToolbar';
export { EditorOverlay } from './components/EditorOverlay';
export { RightPanelContainer } from './components/RightPanelContainer';
export { TemplateCard } from './components/TemplateCard';

export { mountTemplateEditor, type MountOptions } from './mount';
export { EditorSurfaceProvider, type EditorSurface, type SurfacePositioning, useEditorSurface } from './surface';
export * from './host';
