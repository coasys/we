/**
 * Integration Composer
 * 
 * Generates launcher templates from WE seed files.
 * Composes host shell + embedded apps into a unified launcher experience.
 * 
 * Single-app mode:
 * - Full-screen iframe at root route (/)
 * - No sidebar or navigation
 * - Ideal for standalone app launchers
 * 
 * Multi-app mode:
 * - Sidebar with app navigation (100px wide)
 * - Content area with routed iframes
 * - Each app has its own route
 */

import type { TemplateSchema } from '@we/schema-renderer/shared';
import type { WeSeedFile } from '../types/seed';
import type { PlatformAdapter } from './platform/types';
import { templateRegistry } from './registries/templateRegistry';

/**
 * Generate a launcher template from a seed file
 * 
 * Automatically detects mode based on apps array length:
 * - Zero apps: Native WE app (no embedded apps, template switching enabled)
 * - One app: Single embedded app in full-screen
 * - Multiple apps: Multi-app launcher with sidebar navigation
 * 
 * Returns a complete template schema ready to be registered and rendered.
 * 
 * @param seed - Validated WE seed file
 * @param platformAdapter - Platform adapter for URL resolution
 * @returns Template schema for the launcher
 */
export function generateLauncherFromSeed(
  seed: WeSeedFile,
  platformAdapter: PlatformAdapter
): TemplateSchema {
  if (seed.apps.length === 0) {
    return generateNativeLauncher(seed);
  }

  if (seed.apps.length === 1) {
    return generateSingleAppLauncher(seed, platformAdapter);
  }

  return generateMultiAppLauncher(seed, platformAdapter);
}

/**
 * Generate launcher for native WE app (no embedded apps)
 * 
 * If a default template is specified in the seed file, returns that template directly.
 * Otherwise returns an empty Column layout for template switching.
 * Template switching is enabled by default for native mode.
 * 
 * @param seed - WE seed file with zero apps
 * @returns Template schema for native WE app
 */
function generateNativeLauncher(seed: WeSeedFile): TemplateSchema {
  // Check if seed specifies a default template
  const defaultTemplate = seed.host?.ui?.defaultTemplate;

  // If a template is specified, load it from the registry
  if (defaultTemplate) {
    const template = templateRegistry[defaultTemplate as keyof typeof templateRegistry];
    
    if (template) {
      return template;
    }
    
    console.warn(`Template "${defaultTemplate}" not found in registry, falling back to empty launcher`);
  }

  // Fallback: empty launcher for template switching
  return {
    meta: {
      name: `${seed.project.name} Launcher`,
      description: seed.project.description || `Native WE application: ${seed.project.name}`,
      icon: 'rocket-launch',
    },
    type: 'Column',
    props: { width: '100%', height: '100%' },
    children: [{ type: '$routes' }],
    routes: [], // Empty routes - use template switcher
  };
}

/**
 * Generate launcher for a single embedded app
 * 
 * Creates a full-screen Column layout with a single iframe route at '/'.
 * No navigation UI is generated - the app occupies 100% of the viewport.
 * 
 * @param seed - WE seed file containing exactly one app
 * @param platformAdapter - Platform adapter for URL resolution
 * @returns Template schema with full-screen iframe
 */
function generateSingleAppLauncher(
  seed: WeSeedFile,
  platformAdapter: PlatformAdapter
): TemplateSchema {
  const app = seed.apps[0];
  const devUrl = platformAdapter.resolveAppUrl(app, true);
  const prodUrl = platformAdapter.resolveAppUrl(app, false);

  return {
    meta: {
      name: `${seed.project.name} Launcher`,
      description: seed.project.description || `Launcher for ${seed.project.name}`,
      icon: 'rocket-launch',
    },
    type: 'Column',
    props: { width: '100%', height: '100%' },
    children: [{ type: '$routes' }],
    routes: [
      {
        path: '/',  // Single app always loads at root
        type: 'we-iframe',
        props: {
          src: {
            $if: {
              condition: { $store: 'adamStore.isDevelopment' },
              then: devUrl,
              else: prodUrl,
            },
          },
          title: app.name,
          allow: generateIframePermissions(app.capabilities),
          width: '100%',
          height: '100%',
        },
      },
    ],
  };
}

/**
 * Generate launcher for multiple embedded apps
 * 
 * Creates a Row layout with:
 * - Left sidebar (100px): Navigation buttons for each app
 * - Right content area: Routed iframes for each app
 * 
 * Each app gets its own route (e.g. /flux, /playground) and can be
 * navigated to via sidebar buttons.
 * 
 * @param seed - WE seed file containing 2+ apps
 * @param platformAdapter - Platform adapter for URL resolution
 * @returns Template schema with sidebar navigation
 */
function generateMultiAppLauncher(
  seed: WeSeedFile,
  platformAdapter: PlatformAdapter
): TemplateSchema {
  return {
    meta: {
      name: `${seed.project.name} Launcher`,
      description: seed.project.description || `Multi-app launcher for ${seed.project.name}`,
      icon: 'rocket-launch',
    },
    type: 'Row',
    props: { width: '100%', height: '100%' },
    children: [
      // Sidebar with app navigation
      {
        type: 'Column',
        props: {
          width: '100px',
          bg: 'ui-0',
          p: '15px',
          gap: '10px',
        },
        children: seed.apps.map((app) => ({
          type: 'we-button',
          props: {
            width: '70px',
            height: '70px',
            r: 'full',
            onClick: { $action: 'routeStore.navigate', args: [app.route] },
            hoverProps: { bg: 'ui-200' },
          },
          children: [app.name],
        })),
      },
      // Content area with routes
      {
        type: 'Column',
        props: { width: '100%', bg: 'ui-50' },
        children: [{ type: '$routes' }],
      },
    ],
    routes: seed.apps.map((app) => {
      const devUrl = platformAdapter.resolveAppUrl(app, true);
      const prodUrl = platformAdapter.resolveAppUrl(app, false);

      return {
        path: app.route,
        type: 'we-iframe',
        props: {
          src: {
            $if: {
              condition: { $store: 'adamStore.isDevelopment' },
              then: devUrl,
              else: prodUrl,
            },
          },
          title: app.name,
          allow: generateIframePermissions(app.capabilities),
          width: '100%',
          height: '100%',
        },
      };
    }),
  };
}

/**
 * Generate iframe allow attribute from app capabilities
 * 
 * For cross-origin iframes, features need explicit origin. Using 'src' means
 * "allow for the iframe's src origin". Without it, features are blocked.
 * See: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#allow
 */
function generateIframePermissions(capabilities: string[]): string {
  const permissions: string[] = [];

  // Base permissions - use 'src' to allow from iframe's origin
  // Format: "feature 'src'" means allow feature from the iframe's src URL
  permissions.push("camera 'src'", "microphone 'src'", "display-capture 'src'");

  // Add capability-based permissions
  if (capabilities.includes('filesystem')) {
    permissions.push("storage-access 'src'");
  }

  if (capabilities.includes('geolocation')) {
    permissions.push("geolocation 'src'");
  }

  return permissions.join('; ');
}

/**
 * Apply theme customizations from seed to a template
 * 
 * Phase 1: Just return the seed theme for now
 * Phase 2: Actually merge theme into template props
 */
export function applyThemeToLauncher(
  template: TemplateSchema,
  seed: WeSeedFile
): TemplateSchema {
  // For now, theme will be applied globally by the theme system
  // In the future, we could inject theme props into the template
  return template;
}

/**
 * Validate that a seed file can generate a valid launcher
 */
export function validateSeedForLauncher(seed: WeSeedFile): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!seed.apps || !Array.isArray(seed.apps)) {
    errors.push('Seed file must have an apps array');
    return { valid: false, errors };
  }

  // Zero apps is valid for native WE app mode
  if (seed.apps.length === 0) {
    return { valid: true, errors: [] };
  }

  seed.apps.forEach((app, index) => {
    if (!app.id) {
      errors.push(`App at index ${index} missing required field: id`);
    }
    if (!app.name) {
      errors.push(`App at index ${index} missing required field: name`);
    }
    if (!app.route) {
      errors.push(`App at index ${index} missing required field: route`);
    }
    if (!app.paths?.projectRoot) {
      errors.push(`App "${app.id}" missing required field: paths.projectRoot`);
    }
    if (!app.paths?.dist) {
      errors.push(`App "${app.id}" missing required field: paths.dist`);
    }
    if (!app.commands?.install) {
      errors.push(`App "${app.id}" missing required field: commands.install`);
    }
    if (!app.commands?.build) {
      errors.push(`App "${app.id}" missing required field: commands.build`);
    }
    if (!app.commands?.dev) {
      errors.push(`App "${app.id}" missing required field: commands.dev`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
