import { describe, expect, it } from 'vitest';

import { fluxSeedExample, minimalExample } from '../src/seed/examples';
import { normalizeSeedPaths, validateSeed } from '../src/seed/validator';
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

    it('should reject missing app paths.projectRoot', () => {
      const seed = {
        ...minimalExample,
        apps: [{ ...minimalExample.apps[0], paths: { ...minimalExample.apps[0].paths, projectRoot: '' } }],
      };
      const result = validateSeed(seed);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path === 'apps[0].paths.projectRoot')).toBe(true);
    });

    it('should reject missing app paths.dist', () => {
      const seed = {
        ...minimalExample,
        apps: [{ ...minimalExample.apps[0], paths: { ...minimalExample.apps[0].paths, dist: '' } }],
      };
      const result = validateSeed(seed);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path === 'apps[0].paths.dist')).toBe(true);
    });

    it('should reject missing app commands.install', () => {
      const seed = {
        ...minimalExample,
        apps: [{ ...minimalExample.apps[0], commands: { ...minimalExample.apps[0].commands, install: '' } }],
      };
      const result = validateSeed(seed);
      expect(result.valid).toBe(false);
      expect(result.errors?.some((e) => e.path === 'apps[0].commands.install')).toBe(true);
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
      expect(result.warnings?.some((w) => w.path === 'apps[0].capabilities')).toBe(true);
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
      apps: [
        {
          ...minimalExample.apps[0],
          paths: {
            projectRoot: './app',
            dist: './app/dist',
          },
        },
      ],
    };

    const normalized = normalizeSeedPaths(seed, '/base/path');

    expect(normalized.apps[0].paths.projectRoot).toBe('/base/path/app');
    expect(normalized.apps[0].paths.dist).toBe('/base/path/app/dist');
  });

  it('should preserve other seed properties', () => {
    const normalized = normalizeSeedPaths(minimalExample, '/base');
    expect(normalized.project.name).toBe(minimalExample.project.name);
    expect(normalized.apps[0].commands.build).toBe(minimalExample.apps[0].commands.build);
  });
});
