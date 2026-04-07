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
    it('should return empty array when no integrations are generated', async () => {
      const integrations = await loadIntegrations('web');

      expect(integrations).toEqual([]);
    });

    it('should return empty array for all platforms', async () => {
      expect(await loadIntegrations('electron')).toEqual([]);
      expect(await loadIntegrations('tauri')).toEqual([]);
      expect(await loadIntegrations('web')).toEqual([]);
    });
  });

  describe('getIntegration', () => {
    it('should return null for non-existent integration', async () => {
      const result = await getIntegration('non-existent', 'web');
      expect(result).toBeNull();
    });
  });

  describe('getIntegrationManifests', () => {
    it('should return empty array when no integrations exist', async () => {
      const manifests = await getIntegrationManifests('web');
      expect(manifests).toEqual([]);
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
});
