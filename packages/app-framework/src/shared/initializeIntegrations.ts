/**
 * Integration Initialization
 * 
 * Loads seed files and generates launcher templates at app startup.
 */

import { generateLauncherFromSeed, validateSeedForLauncher } from './integrationComposer';
import { templateRegistry } from './registries/templateRegistry';
import type { WeSeedFile } from '../types/seed';

/**
 * Multi-app seed configuration (fallback)
 * 
 * Phase 2: Testing multi-app launcher with Flux + React playground
 * TODO Phase 3: Load from workspace seed file dynamically
 */
const fallbackMultiAppSeed: WeSeedFile = {
  project: {
    name: 'WE Multi-App',
    version: '0.1.0',
    description: 'Testing multi-app integration with Flux and React playground',
    author: 'James Weir',
  },
  host: {
    theme: {
      colors: {
        primary: '#667eea',
        secondary: '#764ba2',
        background: '#ffffff',
        text: '#1a202c',
      },
    },
  },
  ad4m: {},
  apps: [
    {
      id: 'flux',
      name: 'Flux',
      route: '/flux',
      capabilities: ['perspectives', 'languages', 'agents'],
      paths: {
        projectRoot: '../flux/app',
        dist: '../flux/app/dist',
        devServer: {
          port: 3030,
          host: 'localhost',
        },
      },
      commands: {
        install: 'yarn install',
        build: 'yarn build',
        dev: 'yarn dev',
      },
    },
    {
      id: 'playground',
      name: 'Playground',
      route: '/playground',
      capabilities: [],
      paths: {
        projectRoot: './apps/playgrounds/react/demo',
        dist: './apps/playgrounds/react/demo/dist',
        devServer: {
          port: 3040,
          host: 'localhost',
        },
      },
      commands: {
        install: 'pnpm install',
        build: 'pnpm build',
        dev: 'pnpm dev',
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
    const seed = fallbackMultiAppSeed;
    
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
