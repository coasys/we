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
 * Tries to load from sibling flux directory (workspace structure)
 */
export async function loadWorkspaceSeed(): Promise<WeSeedFile | null> {
  // Primary location: sibling flux directory
  // Path is relative to we-web: ../../flux/we-seed.json
  const primaryPath = '../../flux/we-seed.json';
  
  const seed = await loadSeedFromPath(primaryPath);
  if (seed) {
    console.log(`✓ Loaded workspace seed from: ${primaryPath}`);
    return seed;
  }

  console.warn('No workspace seed file found at:', primaryPath);
  return null;
}
