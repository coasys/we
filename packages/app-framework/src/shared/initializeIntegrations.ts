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

import { generateLauncherFromSeed, validateSeedForLauncher } from './integrationComposer';
import { templateRegistry } from './registries/templateRegistry';
import type { WeSeedFile } from '../types/seed';
import weSeedFile from '../../../../we-seed.json';

/**
 * Initialize integrations from seed file
 * 
 * This function:
 * 1. Loads seed via static import (synchronous, type-safe)
 * 2. Validates seed structure
 * 3. Generates launcher template
 * 4. Registers launcher in template registry
 * 
 * Called automatically at module load time from templateRegistry.ts
 */
export function initializeIntegrations(): void {
  try {
    // Load seed from workspace (static import for synchronous access)
    const seed = weSeedFile as WeSeedFile;
    
    // Validate seed can generate a launcher
    const validation = validateSeedForLauncher(seed);
    if (!validation.valid) {
      console.error('❌ Invalid seed file:', validation.errors);
      return;
    }
    
    // Generate launcher template based on seed configuration
    const launcher = generateLauncherFromSeed(seed);
    
    // Replace placeholder launcher in template registry
    templateRegistry.launcher = launcher;
    
    console.log(`✓ ${seed.project.name} launcher initialized from seed file`);
  } catch (error) {
    console.error('❌ Failed to initialize integrations:', error);
    // Don't crash the app - placeholder launcher remains in registry
  }
}

