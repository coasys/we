/**
 * Integration Initialization
 *
 * Reads we-seed.json at startup, validates it, and populates appRegistry with
 * the resolved URL for each embedded app.  Everything else (display, switching,
 * iframe mounting) is handled by AppStore and TemplateProvider at runtime.
 */

import weSeedFile from '../../../../we-seed.json';
import type { WeSeedFile } from '../types/seed';
import { generateIframePermissions, validateSeedForLauncher } from './integrationComposer';
import type { PlatformAdapter } from './platform/types';
import { appRegistry } from './registries/appRegistry';
import { shellRegistry } from './registries/shellRegistry';

export function initializeIntegrations(platformAdapter: PlatformAdapter): void {
  try {
    const seed = weSeedFile as unknown as WeSeedFile;

    const validation = validateSeedForLauncher(seed);
    if (!validation.valid) {
      console.error('❌ Invalid seed file:', validation.errors);
      return;
    }

    // Apply optional white-label boot screen override
    if (seed.host?.ui?.bootScreen) {
      shellRegistry.bootScreen = seed.host.ui.bootScreen;
    }

    // Resolve each app URL once and register it
    const isDev = platformAdapter.isDevelopment;
    for (const app of seed.apps) {
      const url = platformAdapter.resolveAppUrl(app, isDev);
      appRegistry.push({
        id: app.id,
        name: app.name,
        icon: app.icon,
        image: app.image,
        url,
        allow: generateIframePermissions(app.capabilities),
      });
    }

    console.log(`✓ ${seed.project.name} initialized — ${seed.apps.length} embedded app(s)`);
  } catch (error) {
    console.error('❌ Failed to initialize integrations:', error);
  }
}
