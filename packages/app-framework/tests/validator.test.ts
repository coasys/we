import { describe, it, expect } from 'vitest';
import { validateSeed, loadSeed, normalizeSeedPaths } from '../src/seed/validator';
import { minimalExample, fluxSeedExample } from '../src/seed/examples';
import type { WeSeedFile } from '../src/types/seed';

describe('validateSeed', () => {
  describe('valid seeds', () => {
    it('should validate minimal seed file', () => {
      const result = validateSeed(minimalExample);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate full seed file', () => {
      const result = validateSeed(fluxSeedExample);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should allow empty capabilities array', () => {
      const seed = { ...minimalExample };
      const result = validateSeed(seed);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid seeds', () => {
    it('should reject non-object seed', () => {
      const result = validateSeed(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].message).toContain('must be an object');
    });

    it('should reject missing project.name', () => {
      const seed = {
        ...minimalExample,
        project: { ...minimalExample.project, name: '' },
      };
      const result = validateSeed(seed);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path === 'project.name')).toBe(true);
    });

    it('should reject missing project.version', () => {
      const seed = {
        ...minimalExample,
        project: { ...minimalExample.project, version: '' },
      };
      const result = validateSeed(seed);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path === 'project.version')).toBe(true);
    });

    it('should reject missing paths.projectRoot', () => {
      const seed = {
        ...minimalExample,
        paths: { ...minimalExample.paths, projectRoot: '' },
      };
      const result = validateSeed(seed);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path === 'paths.projectRoot')).toBe(true);
    });

    it('should reject missing paths.dist', () => {
      const seed = {
        ...minimalExample,
        paths: { ...minimalExample.paths, dist: '' },
      };
      const result = validateSeed(seed);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path === 'paths.dist')).toBe(true);
    });

    it('should reject missing commands.install', () => {
      const seed = {
        ...minimalExample,
        commands: { ...minimalExample.commands, install: '' },
      };
      const result = validateSeed(seed);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path === 'commands.install')).toBe(true);
    });

    it('should reject missing integration.mount', () => {
      const seed = {
        ...minimalExample,
        integration: { ...minimalExample.integration, mount: '' },
      };
      const result = validateSeed(seed);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path === 'integration.mount')).toBe(true);
    });

    it('should reject missing integration.platforms', () => {
      const seed = {
        ...minimalExample,
        integration: { ...minimalExample.integration, platforms: [] },
      };
      const result = validateSeed(seed);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path === 'integration.platforms')).toBe(true);
    });
  });

  describe('warnings', () => {
    it('should warn about missing repository', () => {
      const result = validateSeed(minimalExample);
      expect(result.valid).toBe(true);
      expect(result.warnings?.some((w) => w.path === 'project.repository')).toBe(true);
    });

    it('should warn about missing license', () => {
      const result = validateSeed(minimalExample);
      expect(result.valid).toBe(true);
      expect(result.warnings?.some((w) => w.path === 'project.license')).toBe(true);
    });

    it('should warn about empty capabilities', () => {
      const result = validateSeed(minimalExample);
      expect(result.valid).toBe(true);
      expect(result.warnings?.some((w) => w.path === 'integration.capabilities')).toBe(true);
    });

    it('should not warn when optional fields are present', () => {
      const result = validateSeed(fluxSeedExample);
      expect(result.warnings).toBeUndefined();
    });
  });
});

describe('normalizeSeedPaths', () => {
  it('should resolve relative paths', () => {
    const seed: WeSeedFile = {
      ...minimalExample,
      paths: {
        projectRoot: './app',
        dist: './app/dist',
      },
    };

    const normalized = normalizeSeedPaths(seed, '/base/path');
    
    expect(normalized.paths.projectRoot).toBe('/base/path/app');
    expect(normalized.paths.dist).toBe('/base/path/app/dist');
  });

  it('should handle ad4mRoot when present', () => {
    const seed: WeSeedFile = {
      ...minimalExample,
      paths: {
        projectRoot: './app',
        dist: './dist',
        ad4mRoot: './ad4m-data',
      },
    };

    const normalized = normalizeSeedPaths(seed, '/base');
    
    expect(normalized.paths.ad4mRoot).toBe('/base/ad4m-data');
  });

  it('should leave ad4mRoot undefined when not present', () => {
    const normalized = normalizeSeedPaths(minimalExample, '/base');
    expect(normalized.paths.ad4mRoot).toBeUndefined();
  });

  it('should preserve other seed properties', () => {
    const normalized = normalizeSeedPaths(minimalExample, '/base');
    expect(normalized.project.name).toBe(minimalExample.project.name);
    expect(normalized.commands.build).toBe(minimalExample.commands.build);
    expect(normalized.integration.mount).toBe(minimalExample.integration.mount);
  });
});
