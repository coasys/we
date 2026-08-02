/**
 * WE's own shell surfaces, authored as templates.
 *
 * Sidebar, settings, profile, boot screen, marketplace, about — the chrome around a space, expressed
 * in the same schema language a community uses for its own pages. That is deliberate and load-bearing:
 * a deployment white-labels the boot screen by replacing a node, not by forking the shell, and the
 * schema system stays honest because WE's own UI is its heaviest consumer.
 */
export { bootScreen } from './BootScreen.schema';
export { landingPageTemplate } from './about';
export { marketplaceTemplate } from './marketplace';
export { MODULE_RAIL_WIDTH, moduleRail } from './ModuleRail.schema';
export { profileTemplate } from './Profile.schema';
export { settingsTemplate } from './Settings.schema';
export { sidebar } from './Sidebar.schema';
export { templateEditor } from './TemplateEditor.schema';
export { createSpaceModal } from './CreateSpaceModal.ts';
