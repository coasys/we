/**
 * Integration Initialization
 *
 * Loads seed file and generates launcher template at application startup.
 *
 * The seed file (we-seed.json) defines:
 * - Project metadata (name, version, description, author)
 * - Host configuration (theme customization, UI overrides)
 * - Embedded applications and their configuration
 *
 * Based on the number of apps in the seed:
 * - Single app: Generates full-screen launcher at root route (/)
 * - Multiple apps: Generates sidebar navigation with app routing
 */

import weSeedFile from '../../../../we-seed.json';
import type { WeSeedFile } from '../types/seed';
import { generateLauncherFromSeed, validateSeedForLauncher } from './integrationComposer';
import type { PlatformAdapter } from './platform/types';
import { launcherUIRegistry } from './registries/launcherUIRegistry';
// import { templateRegistry } from './registries/templateRegistry';

/**
 * Initialize integrations from seed file
 *
 * This function:
 * 1. Loads seed via static import (synchronous, type-safe)
 * 2. Validates seed structure
 * 3. Applies launcher UI customizations (boot screen, settings, etc.)
 * 4. Generates launcher template using platform-aware URL resolution
 * 5. Registers launcher in template registry
 * 6. Configures template switching based on app mode
 *
 * Called from app initialization (e.g., App.tsx) after platform adapter is available
 *
 * @param platformAdapter - Platform adapter for URL resolution
 */
export function initializeIntegrations(platformAdapter: PlatformAdapter): void {
  try {
    // Load seed from workspace (static import for synchronous access)
    const seed = weSeedFile as WeSeedFile;

    // Validate seed can generate a launcher
    const validation = validateSeedForLauncher(seed);
    if (!validation.valid) {
      console.error('❌ Invalid seed file:', validation.errors);
      return;
    }

    // Apply launcher UI customizations from seed
    if (seed.host?.ui) {
      const { bootScreen, appSettings, enableTemplateSwitching } = seed.host.ui;

      if (bootScreen) {
        launcherUIRegistry.bootScreen = bootScreen;
        console.log('  ✓ Custom boot screen loaded from seed');
      }

      // Determine template switching mode first
      if (enableTemplateSwitching !== undefined) {
        launcherUIRegistry.enableTemplateSwitching = enableTemplateSwitching;
      } else {
        // Auto-detect: disable template switching if we have embedded apps
        launcherUIRegistry.enableTemplateSwitching = seed.apps.length === 0;
      }

      // Apply custom app settings if provided (overrides auto-generation)
      if (appSettings) {
        // Store the custom schema directly - it will be used instead of auto-generated one
        launcherUIRegistry._customShell = appSettings;
        console.log('  ✓ Custom app settings loaded from seed');
      }
    } else {
      // Auto-detect: disable template switching if we have embedded apps
      launcherUIRegistry.enableTemplateSwitching = seed.apps.length === 0;
    }

    // Generate launcher template with platform-aware URL resolution
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const launcher = generateLauncherFromSeed(seed, platformAdapter);

    // Replace placeholder launcher in template registry
    // templateRegistry.launcher = launcher;

    const mode = seed.apps.length > 0 ? 'Embedded Apps' : 'Native WE App';
    const templateSwitching = launcherUIRegistry.enableTemplateSwitching ? 'enabled' : 'disabled';
    console.log(`✓ ${seed.project.name} launcher initialized from seed file`);
    console.log(`  Mode: ${mode}, Template switching: ${templateSwitching}`);
  } catch (error) {
    console.error('❌ Failed to initialize integrations:', error);
    // Don't crash the app - placeholder launcher remains in registry
  }
}
