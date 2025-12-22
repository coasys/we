/**
 * Integration Initialization
 * 
 * Loads seed files and generates launcher templates at app startup.
 */

import { generateLauncherFromSeed, validateSeedForLauncher } from './integrationComposer';
import { templateRegistry } from './registries/templateRegistry';
import type { WeSeedFile } from '../types/seed';

/**
 * Flux seed configuration (fallback)
 * 
 * Phase 1-2: Used as fallback if workspace seed not found
 * Phase 3: Remove once workspace seed loading is stable
 */
const fallbackFluxSeed: WeSeedFile = {
  project: {
    name: 'Flux',
    version: '0.11.0',
    description: 'A social web3 tool kit for communities',
    author: 'Junto Foundation',
    repository: 'https://github.com/juntofoundation/flux',
    license: 'MIT',
  },
  host: {
    theme: {
      colors: {
        primary: '#6366f1',
        secondary: '#8b5cf6',
      },
    },
  },
  ad4m: {
    ai: {
      enabled: true,
    },
    perspectives: [
      {
        name: 'Flux Channels',
      },
    ],
  },
  apps: [
    {
      id: 'flux',
      name: 'Flux',
      route: '/',
      entry: 'index.html',
      capabilities: ['perspectives', 'languages', 'agents'],
      paths: {
        projectRoot: './app',
        dist: 'app/dist',
        devServer: {
          port: 3030,
          host: 'localhost',
        },
      },
      commands: {
        install: 'yarn install',
        build: 'yarn build',
        dev: 'yarn dev',
        clean: 'yarn clean',
      },
    },
  ],
};

/**
 * Initialize integrations from seed files
 * 
 * Phase 2: For now, using fallback seed synchronously
 * TODO Phase 3: Load from workspace seed file asynchronously
 */
export function initializeIntegrations(): void {
  try {
    // For now, just use the fallback seed (synchronous)
    // TODO: Implement async workspace seed loading properly
    const seed = fallbackFluxSeed;
    
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
