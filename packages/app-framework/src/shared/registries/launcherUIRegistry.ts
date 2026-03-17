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

import { getAppSettingsSchema } from '@shared/schemas/defaults/AppSettings.schema';
import { bootScreenSchema } from '@shared/schemas/defaults/BootScreen.schema';
import type { SchemaNode } from '@we/schema-shared';

/**
 * Launcher UI Registry
 *
 * Holds the schemas for launcher shell components.
 * Can be overridden via seed.host.ui configuration.
 */
export const launcherUIRegistry = {
  /** Boot/login screen shown before AD4M is ready */
  bootScreen: bootScreenSchema as SchemaNode,

  /** Custom app settings schema (set via seed) */
  _customAppSettings: undefined as SchemaNode | undefined,

  /** App settings panel (generated based on enableTemplateSwitching or custom from seed) */
  get appSettings(): SchemaNode {
    // If custom schema provided via seed, use that
    if (this._customAppSettings) {
      return this._customAppSettings;
    }
    // Otherwise generate based on template switching mode
    return getAppSettingsSchema(this.enableTemplateSwitching);
  },

  /** Whether template switching is enabled (disabled for embedded apps mode) */
  enableTemplateSwitching: true,
};

export type LauncherUIRegistry = typeof launcherUIRegistry;
