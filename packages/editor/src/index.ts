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
export { CodePanel } from './components/CodePanel';
export { CodeViewer } from './components/CodeViewer';
export { ConditionEditor } from './components/ConditionEditor';
export { ContentEditor } from './components/ContentEditor';
export { DesignToolbar } from './components/DesignToolbar';
export { EditorOverlay } from './components/EditorOverlay';
export { InspectorPanel } from './components/InspectorPanel';
export { PublishToMarketplaceModal } from './components/PublishToMarketplaceModal';
export {
  panelResizing,
  RAIL_STRIP_WIDTH,
  RightPanelContainer,
  TEMPLATE_RAILS_WIDTH,
  THEME_RAIL_WIDTH,
  TOTAL_RAIL_WIDTH,
} from './components/RightPanelContainer';
export { TemplateCard } from './components/TemplateCard';
export { ThemePanel } from './components/ThemePanel';

export { mountTemplateEditor, type MountOptions } from './mount';
export * from './host';
