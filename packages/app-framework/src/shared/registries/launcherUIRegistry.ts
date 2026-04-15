/**
 * Launcher UI Registry
 *
 * Central registry for launcher shell UI components (boot screen, app settings, etc.)
 * These wrap the main content (either embedded apps or native WE templates).
 *
 * Can be customized via seed file (seed.host.ui) for white-labeling.
 *
 * Initialization Flow:
 * 1. Module loads → default schemas registered
 * 2. PlatformProvider mounts → calls initializeIntegrations(adapter)
 * 3. Seed file loaded → custom UI schemas override defaults (if provided)
 * 4. TemplateProvider reads registry → builds app layout
 */

import { aiChatSidebar } from '@shared/schemas/shell/AiChatSidebar.schema';
import { bootScreen } from '@shared/schemas/shell/BootScreen.schema';
import { sidebar } from '@shared/schemas/shell/Sidebar.schema';
import type { SchemaNode } from '@we/schema-shared';

/**
 * Launcher UI Registry
 *
 * Holds the schemas for launcher shell components.
 * Can be overridden via seed.host.ui configuration.
 */
export const launcherUIRegistry = {
  /** Boot/login screen shown before AD4M is ready */
  bootScreen,

  /** AI chat sidebar panel */
  aiChatSidebar,

  /** Custom app shell schema (set via seed) */
  _customShell: undefined as SchemaNode | undefined,

  /** App shell (generated based on enableTemplateSwitching or custom from seed) */
  get shell(): SchemaNode {
    // If custom schema provided via seed, use that
    if (this._customShell) {
      return this._customShell;
    }
    // Otherwise generate based on template switching mode
    return sidebar;
    // return getAppSettingsSchema(this.enableTemplateSwitching);
  },

  /** Whether template switching is enabled (disabled for embedded apps mode) */
  enableTemplateSwitching: true,
};

export type LauncherUIRegistry = typeof launcherUIRegistry;
