/**
 * Seed Loader (Currently Unused)
 * 
 * Infrastructure for runtime seed file loading via fetch/dynamic imports.
 * 
 * NOTE: This module is currently NOT USED. We use static imports instead
 * (see initializeIntegrations.ts) because:
 * - Static imports are synchronous (no timing issues)
 * - Type-safe at build time
 * - Simple and reliable
 * 
 * This code is preserved for potential future use cases:
 * - Loading seeds from URLs
 * - Hot-reloading seed changes without rebuild
 * - Supporting dynamic seed discovery
 * 
 * Current approach (static import):
 * ```typescript
 * import weSeedFile from '../../../../we-seed.json';
 * const seed = weSeedFile as WeSeedFile;
 * ```
 */

import type { WeSeedFile } from '../types/seed';

/**
 * Load a seed file from a path via fetch
 * 
 * @param seedPath - Relative or absolute path to seed file
 * @returns Parsed seed file or null if not found/invalid
 */
export async function loadSeedFromPath(seedPath: string): Promise<WeSeedFile | null> {
  try {
    // For now, we'll use fetch to load the seed file
    // This works if the seed is served by the dev server or bundled
    const response = await fetch(seedPath);
    
    if (!response.ok) {
      console.warn(`Failed to load seed from ${seedPath}: ${response.status}`);
      return null;
    }

    const seed = await response.json();
    return seed as WeSeedFile;
  } catch (error) {
    console.warn(`Failed to load seed from ${seedPath}:`, error);
    return null;
  }
}

/**
 * Load seed from default workspace locations
 * 
 * Attempts to load from common workspace patterns:
 * 1. WE's own seed (../../we-seed.json) - for multi-app testing
 * 2. Sibling flux directory (../../flux/we-seed.json) - for single-app
 * 
 * @returns Parsed seed file or null if none found
 */
export async function loadWorkspaceSeed(): Promise<WeSeedFile | null> {
  // Try WE's multi-app seed first
  const weSeedPath = '../../we-seed.json';
  let seed = await loadSeedFromPath(weSeedPath);
  if (seed) {
    console.log(`✓ Loaded WE multi-app seed from: ${weSeedPath}`);
    return seed;
  }

  // Fall back to Flux single-app seed
  const fluxSeedPath = '../../flux/we-seed.json';
  seed = await loadSeedFromPath(fluxSeedPath);
  if (seed) {
    console.log(`✓ Loaded Flux seed from: ${fluxSeedPath}`);
    return seed;
  }

  console.warn('No workspace seed file found');
  return null;
}
