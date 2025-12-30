import { describe, expect, it } from 'vitest';

import { fluxSeedExample, minimalExample } from '../src/seed/examples';
import { processSeed, SeedProcessor } from '../src/seed/processor';

describe('SeedProcessor', () => {
  describe('constructor', () => {
    it('should create processor with valid seed', () => {
      expect(() => new SeedProcessor(minimalExample)).not.toThrow();
    });

    it('should throw with invalid seed', () => {
      const invalidSeed: any = { project: {} };
      expect(() => new SeedProcessor(invalidSeed)).toThrow('Invalid seed file');
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
      const schemas = processor.generateSchemas();

      expect(schemas.main).toBeDefined();
      expect(schemas.main.type).toBe('container');
      expect(schemas.main.props.class).toContain('we-integration');
    });

    it('should include custom templates', () => {
      const seed = {
        ...minimalExample,
        ui: {
          templates: {
            customComponent: {
              type: 'text',
              content: 'Custom',
            },
          },
        },
      };
      const processor = new SeedProcessor(seed);
      const schemas = processor.generateSchemas();

      expect(schemas.customComponent).toBeDefined();
      expect(schemas.customComponent.content).toBe('Custom');
    });
  });

  describe('generateRoutes', () => {
    it('should generate main mount route', () => {
      const processor = new SeedProcessor(minimalExample);
      const routes = processor.generateRoutes();

      expect(routes).toHaveLength(1);
      expect(routes[0].path).toBe('/myapp');
      expect(routes[0].component).toBe('main');
    });

    it('should include custom routes', () => {
      const seed = {
        ...minimalExample,
        ui: {
          routes: [{ path: '/custom', component: 'CustomComponent' }],
        },
      };
      const processor = new SeedProcessor(seed);
      const routes = processor.generateRoutes();

      expect(routes).toHaveLength(2);
      expect(routes[1].path).toBe('/custom');
      expect(routes[1].component).toBe('CustomComponent');
    });
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

    it('should include route array', () => {
      const processor = new SeedProcessor(minimalExample);
      const code = processor.generateRoutesCode();

      expect(code).toContain('[');
      expect(code).toContain('/myapp');
      expect(code).toContain('"component": "main"');
    });
  });

  describe('generateManifest', () => {
    it('should generate valid TypeScript code', () => {
      const processor = new SeedProcessor(fluxSeedExample);
      const code = processor.generateManifest();

      expect(code).toContain('export const');
      expect(code).toContain('fluxManifest');
      expect(code).toContain('"id": "flux"');
      expect(code).toContain('"name": "Flux"');
      expect(code).toContain('"mount": "flux"');
    });

    it('should include all manifest fields', () => {
      const processor = new SeedProcessor(fluxSeedExample);
      const code = processor.generateManifest();

      expect(code).toContain('"version"');
      expect(code).toContain('"description"');
      expect(code).toContain('"author"');
      expect(code).toContain('"capabilities"');
      expect(code).toContain('"platforms"');
    });
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
    const invalidSeed: any = { project: {} };
    await expect(processSeed(invalidSeed)).rejects.toThrow();
  });
});
