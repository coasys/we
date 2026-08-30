/**
 * WE's own shell surfaces, authored as templates.
 *
 * Sidebar, settings, profile, boot screen, marketplace, about — the chrome around a space, expressed
 * in the same schema language a community uses for its own pages. That is deliberate and load-bearing:
 * a deployment white-labels the boot screen by replacing a node, not by forking the shell, and the
 * schema system stays honest because WE's own UI is its heaviest consumer.
 */
export { accountSettings, removeAccountModal } from './AccountSettings.schema';
export { bootScreen } from './BootScreen.schema';
export { consentPrompt, consentSecret } from './ConsentPrompt.schema';
export { destructivePrompt } from './DestructivePrompt.schema';
export { installPrompt } from './InstallPrompt.schema';
export { namePrompt } from './NamePrompt.schema';
export { landingPageTemplate } from './about';
export { marketplaceTemplate } from './marketplace';
export { CHROME_RAIL_WIDTH, chromeRail } from './ChromeRail.schema';
export { templatePicker, themePicker } from './DesignControls';
export { profileTemplate } from './Profile.schema';
export { aiSection } from './AiSettings.schema';
export { languagesLocalState, languagesSection } from './LanguageSettings.schema';
export {
  connectedApps,
  mcpServer,
  networkLocalState,
  peerNetwork,
  runtimeError,
  trustedAgents,
} from './RuntimeSettings.schema';
export { settingsTemplate } from './Settings.schema';
export { sidebar } from './Sidebar.schema';
export { templateEditor } from './TemplateEditor.schema';
export { createSpaceModal, createSpaceModalMount } from './CreateSpaceModal.ts';
export { spaceSettingsPanel } from './spaces/SpaceSettingsPanel.schema';
