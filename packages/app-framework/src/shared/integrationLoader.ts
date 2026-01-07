/**
 * Integration Loader
 *
 * Dynamically loads integrations generated from WE seed files.
 * Registers schemas, routes, and manifests with the platform adapters.
 */

export interface IntegrationManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  mount: string;
  capabilities: string[];
  platforms: ('electron' | 'tauri' | 'web')[];
  entry: string;
}

export interface IntegrationModule {
  schemas: Record<string, any>;
  routes: Array<{ path: string; component: string }>;
  manifest: IntegrationManifest;
}

export interface LoadedIntegration {
  id: string;
  manifest: IntegrationManifest;
  schemas: Record<string, any>;
  routes: Array<{ path: string; component: string }>;
  metadata?: any; // Generated metadata from seed processor
}

/**
 * Load all integrations from the integrations directory
 */
export async function loadIntegrations(platform: 'electron' | 'tauri' | 'web'): Promise<LoadedIntegration[]> {
  const integrations: LoadedIntegration[] = [];

  try {
    // Try to load Flux integration
    const flux = await loadFluxIntegration(platform);
    if (flux) {
      integrations.push(flux);
    }
  } catch (error) {
    console.warn('Failed to load Flux integration:', error);
  }

  return integrations;
}

/**
 * Load Flux integration if available for the platform
 */
async function loadFluxIntegration(platform: 'electron' | 'tauri' | 'web'): Promise<LoadedIntegration | null> {
  try {
    // Dynamic imports to avoid bundling if not needed
    const [schemasModule, routesModule, manifestModule] = await Promise.all([
      import('./schemas/integrations/flux/schemas'),
      import('./schemas/integrations/flux/routes'),
      import('./schemas/integrations/flux/manifest'),
    ]);

    const manifest = manifestModule.fluxManifest as IntegrationManifest;

    // Check if this integration supports the current platform
    if (!manifest.platforms.includes(platform)) {
      console.log(`Flux integration not available for platform: ${platform}`);
      return null;
    }

    // Load optional metadata
    let metadata;
    try {
      const metadataModule = await import('./schemas/integrations/flux/metadata.json');
      metadata = metadataModule.default || metadataModule;
    } catch {
      // Metadata is optional
    }

    return {
      id: manifest.id,
      manifest,
      schemas: schemasModule.fluxSchemas,
      routes: routesModule.fluxRoutes,
      metadata,
    };
  } catch (error) {
    console.error('Error loading Flux integration:', error);
    return null;
  }
}

/**
 * Get integration by ID
 */
export async function getIntegration(
  id: string,
  platform: 'electron' | 'tauri' | 'web',
): Promise<LoadedIntegration | null> {
  const integrations = await loadIntegrations(platform);
  return integrations.find((i) => i.id === id) || null;
}

/**
 * Get all integration manifests (lightweight)
 */
export async function getIntegrationManifests(platform: 'electron' | 'tauri' | 'web'): Promise<IntegrationManifest[]> {
  const integrations = await loadIntegrations(platform);
  return integrations.map((i) => i.manifest);
}

/**
 * Check if an integration has a specific capability
 */
export function hasCapability(manifest: IntegrationManifest, capability: string): boolean {
  return manifest.capabilities.includes(capability);
}

/**
 * Get integration URL for the current environment
 */
export function getIntegrationUrl(
  manifest: IntegrationManifest,
  isDevelopment: boolean,
  seedMetadata?: {
    devServer?: { port: number; host?: string };
    dist?: string;
    projectRoot?: string;
  },
): string {
  if (isDevelopment && seedMetadata?.devServer) {
    const { port, host = 'localhost' } = seedMetadata.devServer;
    return `http://${host}:${port}`;
  }

  // Production mode - use dist path
  if (seedMetadata?.dist) {
    return seedMetadata.dist;
  }

  // Fallback to entry point
  return manifest.entry;
}
