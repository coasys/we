import { describe, expect, it } from 'vitest';

import { fluxSeedExample, minimalExample } from '../src/seed/examples';
import { processSeed, SeedProcessor } from '../src/seed/processor';
import type { WeSeedFile } from '../src/types/seed';

describe('SeedProcessor', () => {
  describe('constructor', () => {
    it('should create processor with valid seed', () => {
      expect(() => new SeedProcessor(minimalExample)).not.toThrow();
    });

    it('should throw with invalid seed', () => {
      const invalidSeed = { project: {} };
      expect(() => new SeedProcessor(invalidSeed as WeSeedFile)).toThrow('Invalid seed file');
    });
  });

  describe('generateIntegrationId', () => {
    it('should convert name to kebab-case', () => {
      const processor = new SeedProcessor(minimalExample);
      const result = processor.process();
      expect(result.metadata.integrationId).toBe('my-app');
    });

    it('should handle spaces and special characters', () => {
      const seed = {
        ...minimalExample,
        project: { ...minimalExample.project, name: 'Test  App! 123' },
      };
      const processor = new SeedProcessor(seed);
      const result = processor.process();
      expect(result.metadata.integrationId).toBe('test-app-123');
    });

    it('should remove leading/trailing hyphens', () => {
      const seed = {
        ...minimalExample,
        project: { ...minimalExample.project, name: '  Test App  ' },
      };
      const processor = new SeedProcessor(seed);
      const result = processor.process();
      expect(result.metadata.integrationId).toBe('test-app');
    });
  });

  describe('generateSchemas', () => {
    it('should generate main schema', () => {
      const processor = new SeedProcessor(minimalExample);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const schemas = processor.generateSchemas() as Record<string, any>;

      expect(schemas.main).toBeDefined();
      expect(schemas.main.type).toBe('container');
      expect(schemas.main.props.class).toContain('we-integration');
    });

    it.todo('should include custom templates');
  });

  describe('generateRoutes', () => {
    it.todo('should generate main mount route');

    it.todo('should include custom routes');
  });

  describe('generateMetadata', () => {
    it('should generate metadata with correct structure', () => {
      const processor = new SeedProcessor(minimalExample);
      const metadata = processor.generateMetadata();

      expect(metadata.seed).toBe(minimalExample);
      expect(metadata.integrationId).toBe('my-app');
      expect(metadata.processedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(metadata.outputPaths.schema).toContain('my-app');
      expect(metadata.outputPaths.routes).toContain('my-app');
      expect(metadata.outputPaths.components).toContain('my-app');
    });
  });

  describe('generateSchemaCode', () => {
    it('should generate valid TypeScript code', () => {
      const processor = new SeedProcessor(minimalExample);
      const code = processor.generateSchemaCode();

      expect(code).toContain('export const');
      expect(code).toContain('myAppSchemas');
      expect(code).toContain('DO NOT EDIT MANUALLY');
      expect(code).toContain(minimalExample.project.name);
      expect(code).toContain(minimalExample.project.version);
    });

    it('should use camelCase variable names', () => {
      const seed = {
        ...minimalExample,
        project: { ...minimalExample.project, name: 'Test App' },
      };
      const processor = new SeedProcessor(seed);
      const code = processor.generateSchemaCode();

      expect(code).toContain('testAppSchemas');
      expect(code).not.toContain('test-appSchemas');
    });

    it('should include valid JSON', () => {
      const processor = new SeedProcessor(minimalExample);
      const code = processor.generateSchemaCode();

      // Extract the JSON part
      const jsonMatch = code.match(/= ({[\s\S]*});/);
      expect(jsonMatch).toBeTruthy();

      // Should be valid JSON
      expect(() => JSON.parse(jsonMatch![1])).not.toThrow();
    });
  });

  describe('generateRoutesCode', () => {
    it('should generate valid TypeScript code', () => {
      const processor = new SeedProcessor(minimalExample);
      const code = processor.generateRoutesCode();

      expect(code).toContain('export const');
      expect(code).toContain('myAppRoutes');
      expect(code).toContain('DO NOT EDIT MANUALLY');
    });

    it.todo('should include route array');
  });

  describe('generateManifest', () => {
    it.todo('should generate valid TypeScript code');

    it.todo('should include all manifest fields');
  });

  describe('process', () => {
    it('should return metadata and all generated files', () => {
      const processor = new SeedProcessor(minimalExample);
      const result = processor.process();

      expect(result.metadata).toBeDefined();
      expect(result.files.schemas).toBeDefined();
      expect(result.files.routes).toBeDefined();
      expect(result.files.manifest).toBeDefined();
    });

    it('should generate consistent output', () => {
      const processor = new SeedProcessor(minimalExample);
      const result1 = processor.process();
      const result2 = processor.process();

      // IDs should be the same
      expect(result1.metadata.integrationId).toBe(result2.metadata.integrationId);

      // Code structure should be the same (timestamps will differ)
      expect(result1.files.schemas).toContain('myAppSchemas');
      expect(result2.files.schemas).toContain('myAppSchemas');
    });
  });
});

describe('processSeed', () => {
  it('should process seed and return result', async () => {
    const result = await processSeed(minimalExample);

    expect(result.metadata).toBeDefined();
    expect(result.files.schemas).toBeDefined();
    expect(result.files.routes).toBeDefined();
    expect(result.files.manifest).toBeDefined();
  });

  it('should reject invalid seed', async () => {
    const invalidSeed = { project: {} };
    await expect(processSeed(invalidSeed as WeSeedFile)).rejects.toThrow();
  });
});
