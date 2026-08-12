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
// The components are internal: consumers mount the editor through mountTemplateEditor
// and talk to it through the EditorHost port. (Seven component exports sat here with no
// consumer anywhere — an accidental public API this package never meant to promise.)
export { mountTemplateEditor, type MountOptions } from './mount';
export { EditorSurfaceProvider, type EditorSurface, type SurfacePositioning, useEditorSurface } from './surface';
export * from './host';
