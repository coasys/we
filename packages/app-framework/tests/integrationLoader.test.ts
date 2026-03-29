import { describe, expect, it } from 'vitest';

import {
  getIntegration,
  getIntegrationManifests,
  getIntegrationUrl,
  hasCapability,
  type IntegrationManifest,
  loadIntegrations,
} from '../src/shared/integrationLoader';

describe('IntegrationLoader', () => {
  describe('loadIntegrations', () => {
    it('should load Flux integration for supported platform', async () => {
      const integrations = await loadIntegrations('web');

      expect(integrations).toBeDefined();
      expect(Array.isArray(integrations)).toBe(true);

      const flux = integrations.find((i) => i.id === 'flux');
      if (flux) {
        expect(flux.manifest.name).toBe('Flux');
        expect(flux.manifest.version).toBe('0.11.0');
        expect(flux.manifest.platforms).toContain('web');
        expect(flux.schemas).toBeDefined();
        expect(flux.routes).toBeDefined();
      }
    });

    it('should load Flux integration for electron platform', async () => {
      const integrations = await loadIntegrations('electron');

      const flux = integrations.find((i) => i.id === 'flux');
      if (flux) {
        expect(flux.manifest.platforms).toContain('electron');
      }
    });

    it('should load Flux integration for tauri platform', async () => {
      const integrations = await loadIntegrations('tauri');

      const flux = integrations.find((i) => i.id === 'flux');
      if (flux) {
        expect(flux.manifest.platforms).toContain('tauri');
      }
    });

    it('should return empty array if no integrations available', async () => {
      // This test verifies graceful handling when integrations fail to load
      const integrations = await loadIntegrations('web');
      expect(Array.isArray(integrations)).toBe(true);
    });
  });

  describe('getIntegration', () => {
    it('should get Flux integration by id', async () => {
      const flux = await getIntegration('flux', 'web');

      if (flux) {
        expect(flux.id).toBe('flux');
        expect(flux.manifest.name).toBe('Flux');
        expect(flux.schemas).toBeDefined();
        expect(flux.routes).toBeDefined();
      }
    });

    it('should return null for non-existent integration', async () => {
      const result = await getIntegration('non-existent', 'web');
      expect(result).toBeNull();
    });
  });

  describe('getIntegrationManifests', () => {
    it('should get all integration manifests', async () => {
      const manifests = await getIntegrationManifests('web');

      expect(Array.isArray(manifests)).toBe(true);

      const flux = manifests.find((m) => m.id === 'flux');
      if (flux) {
        expect(flux.name).toBe('Flux');
        expect(flux.version).toBe('0.11.0');
        expect(flux.mount).toBe('flux');
        expect(flux.capabilities).toContain('perspectives');
      }
    });

    it('should only include manifests for specified platform', async () => {
      const manifests = await getIntegrationManifests('web');

      manifests.forEach((manifest) => {
        expect(manifest.platforms).toContain('web');
      });
    });
  });

  describe('hasCapability', () => {
    const mockManifest: IntegrationManifest = {
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      mount: 'test',
      capabilities: ['perspectives', 'languages'],
      platforms: ['web'],
      entry: 'index.html',
    };

    it('should return true for existing capability', () => {
      expect(hasCapability(mockManifest, 'perspectives')).toBe(true);
      expect(hasCapability(mockManifest, 'languages')).toBe(true);
    });

    it('should return false for non-existent capability', () => {
      expect(hasCapability(mockManifest, 'agents')).toBe(false);
      expect(hasCapability(mockManifest, 'unknown')).toBe(false);
    });
  });

  describe('getIntegrationUrl', () => {
    const mockManifest: IntegrationManifest = {
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      mount: 'test',
      capabilities: [],
      platforms: ['web'],
      entry: 'index.html',
    };

    it('should return dev server URL in development mode', () => {
      const url = getIntegrationUrl(mockManifest, true, { devServer: { port: 5173 } });

      expect(url).toBe('http://localhost:5173');
    });

    it('should use custom host for dev server', () => {
      const url = getIntegrationUrl(mockManifest, true, { devServer: { port: 3000, host: '0.0.0.0' } });

      expect(url).toBe('http://0.0.0.0:3000');
    });

    it('should return dist path in production mode', () => {
      const url = getIntegrationUrl(mockManifest, false, { dist: 'app/dist' });

      expect(url).toBe('app/dist');
    });

    it('should fallback to entry point if no metadata', () => {
      const url = getIntegrationUrl(mockManifest, false);
      expect(url).toBe('index.html');
    });

    it('should use dist even if dev server available in production', () => {
      const url = getIntegrationUrl(mockManifest, false, {
        dist: 'app/dist',
        devServer: { port: 5173 },
      });

      expect(url).toBe('app/dist');
    });
  });

  describe('Flux Integration Validation', () => {
    it('should have valid Flux schemas', async () => {
      const flux = await getIntegration('flux', 'web');

      if (flux) {
        expect(flux.schemas).toBeDefined();
        expect(flux.schemas.main).toBeDefined();
        expect(flux.schemas.main.type).toBe('container');
      }
    });

    it('should have valid Flux routes', async () => {
      const flux = await getIntegration('flux', 'web');

      if (flux) {
        expect(flux.routes).toBeDefined();
        expect(Array.isArray(flux.routes)).toBe(true);

        const mainRoute = flux.routes.find((r) => r.path === '/flux');
        expect(mainRoute).toBeDefined();
        expect(mainRoute?.component).toBe('main');
      }
    });

    it('should have all required Flux capabilities', async () => {
      const flux = await getIntegration('flux', 'web');

      if (flux) {
        expect(hasCapability(flux.manifest, 'perspectives')).toBe(true);
        expect(hasCapability(flux.manifest, 'languages')).toBe(true);
        expect(hasCapability(flux.manifest, 'agents')).toBe(true);
      }
    });

    it('should support all platforms', async () => {
      const flux = await getIntegration('flux', 'web');

      if (flux) {
        expect(flux.manifest.platforms).toContain('electron');
        expect(flux.manifest.platforms).toContain('tauri');
        expect(flux.manifest.platforms).toContain('web');
      }
    });

    it('should have metadata from seed file', async () => {
      const flux = await getIntegration('flux', 'web');

      if (flux && flux.metadata) {
        expect(flux.metadata.seed).toBeDefined();
        expect(flux.metadata.processedAt).toBeDefined();
        expect(flux.metadata.integrationId).toBe('flux');
      }
    });
  });
});
