/**
 * Seed Loader
 * 
 * Loads WE seed files from various sources:
 * - Dev mode: Import from file system
 * - Production: Bundled or fetched from URL
 */

import type { WeSeedFile } from '../types/seed';

/**
 * Load a seed file from a path
 * 
 * In dev mode, this can use dynamic imports.
 * In production, seeds should be bundled or fetched.
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
 * Load seed from default workspace location
 * 
 * Tries to load from:
 * 1. WE's own seed (../../we-seed.json) - for multi-app testing
 * 2. Sibling flux directory (../../flux/we-seed.json) - for single-app
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
