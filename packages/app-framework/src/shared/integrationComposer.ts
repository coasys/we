/**
 * Integration Composer
 * 
 * Generates launcher templates from WE seed files.
 * Composes host shell + embedded apps into a unified launcher experience.
 */

import type { TemplateSchema } from '@we/schema-renderer/shared';
import type { WeSeedFile } from '../types/seed';

/**
 * Generate a launcher template from a seed file
 * 
 * Phase 1: Simple implementation
 * - Single app: Full-screen iframe at root route
 * - Multi-app: Sidebar navigation + iframe routes
 * - Host theme: Applied if provided
 */
export function generateLauncherFromSeed(seed: WeSeedFile): TemplateSchema {
  if (seed.apps.length === 0) {
    throw new Error('Seed file must contain at least one app');
  }

  if (seed.apps.length === 1) {
    console.log('🎯 Generating single-app launcher (full-screen, no sidebar)');
    return generateSingleAppLauncher(seed);
  }

  console.log(`🎯 Generating multi-app launcher (sidebar with ${seed.apps.length} apps)`);
  return generateMultiAppLauncher(seed);
}

/**
 * Generate launcher for a single embedded app
 */
function generateSingleAppLauncher(seed: WeSeedFile): TemplateSchema {
  const app = seed.apps[0];
  const devUrl = `http://${app.paths.devServer?.host || 'localhost'}:${app.paths.devServer?.port || 3000}`;
  const prodUrl = app.paths.dist;

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
 */
function generateMultiAppLauncher(seed: WeSeedFile): TemplateSchema {
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
      const devUrl = `http://${app.paths.devServer?.host || 'localhost'}:${app.paths.devServer?.port || 3000}`;
      const prodUrl = app.paths.dist;

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

  if (!seed.apps || seed.apps.length === 0) {
    errors.push('Seed file must contain at least one app');
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
