/**
 * Integration Composer
 *
 * Validation utilities for WE seed files and iframe permission helpers.
 */

import type { WeSeedFile } from '../types/seed';

/**
 * Generate the iframe allow attribute from an app's capabilities array.
 *
 * Using 'src' grants each permission only from the iframe's own origin.
 * See: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#allow
 */
export function generateIframePermissions(capabilities: string[]): string {
  const permissions = ["camera 'src'", "microphone 'src'", "display-capture 'src'"];

  if (capabilities.includes('filesystem')) permissions.push("storage-access 'src'");
  if (capabilities.includes('geolocation')) permissions.push("geolocation 'src'");

  return permissions.join('; ');
}

/**
 * Validate that a seed file is structurally valid.
 */
export function validateSeedForLauncher(seed: WeSeedFile): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!seed.apps || !Array.isArray(seed.apps)) {
    errors.push('Seed file must have an apps array');
    return { valid: false, errors };
  }

  seed.apps.forEach((app, index) => {
    if (!app.id) errors.push(`App at index ${index} missing required field: id`);
    if (!app.name) errors.push(`App at index ${index} missing required field: name`);
    if (!app.icon) errors.push(`App at index ${index} missing required field: icon`);
    if (!app.paths?.projectRoot) errors.push(`App "${app.id}" missing required field: paths.projectRoot`);
    if (!app.paths?.dist) errors.push(`App "${app.id}" missing required field: paths.dist`);
  });

  return { valid: errors.length === 0, errors };
}
