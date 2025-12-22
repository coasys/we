/**
 * Integration Initialization
 * 
 * Loads seed files and generates launcher templates at app startup.
 */

import { generateLauncherFromSeed, validateSeedForLauncher } from './integrationComposer';
import { templateRegistry } from './registries/templateRegistry';
import type { WeSeedFile } from '../types/seed';
import weSeedFile from '../../../../we-seed.json';

/**
 * Initialize integrations from seed files
 * 
 * Loads seed from workspace and generates launcher template.
 * Uses static import for synchronous access at module load time.
 */
export function initializeIntegrations(): void {
  try {
    // Load seed from workspace (static import - synchronous)
    const seed = weSeedFile as WeSeedFile;
    
    // Validate seed can generate a launcher
    const validation = validateSeedForLauncher(seed);
    if (!validation.valid) {
      console.error('Invalid seed file:', validation.errors);
      return;
    }
    
    // Generate launcher template
    const launcher = generateLauncherFromSeed(seed);
    
    // Register in template registry (replaces default launcher)
    templateRegistry.launcher = launcher;
    
    console.log(`✓ ${seed.project.name} launcher initialized from seed file`);
  } catch (error) {
    console.error('Failed to initialize integrations:', error);
    // Don't crash the app - fall back to default launcher
  }
}

/**
 * Discover and load all seed files from integrations directory
 * 
 * Phase 2 implementation - not used yet
 */
export async function discoverIntegrations(): Promise<WeSeedFile[]> {
  // TODO: Scan integrations directory for we-seed.json files
  // TODO: Support loading from URLs
  // TODO: Cache loaded seeds
  return [];
}
