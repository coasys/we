export interface IntegrationManifest {
  id: string;
  name: string;
  version: string;
  mount: string;
  capabilities: string[];
  platforms: string[];
  entry: string;
}

export interface IntegrationMetadata {
  devServer?: { port: number; host?: string };
  dist?: string;
}

export function hasCapability(manifest: IntegrationManifest, capability: string): boolean {
  return manifest.capabilities.includes(capability);
}

export function getIntegrationUrl(
  manifest: IntegrationManifest,
  isDev: boolean,
  metadata?: IntegrationMetadata,
): string {
  if (isDev && metadata?.devServer) {
    const host = metadata.devServer.host ?? 'localhost';
    return `http://${host}:${metadata.devServer.port}`;
  }
  if (!isDev && metadata?.dist) {
    return metadata.dist;
  }
  return manifest.entry;
}
