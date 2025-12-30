import type { SeedValidationResult, WeSeedFile } from '../types/seed';

/**
 * Validates a WE seed file against the schema
 */
export function validateSeed(seed: unknown): SeedValidationResult {
  const errors: Array<{ path: string; message: string }> = [];
  const warnings: Array<{ path: string; message: string }> = [];

  if (!seed || typeof seed !== 'object') {
    return {
      valid: false,
      errors: [{ path: 'root', message: 'Seed file must be an object' }],
    };
  }

  const s = seed as Partial<WeSeedFile>;

  // Validate required project fields
  if (!s.project) {
    errors.push({ path: 'project', message: 'Project metadata is required' });
  } else {
    if (!s.project.name) {
      errors.push({ path: 'project.name', message: 'Project name is required' });
    }
    if (!s.project.version) {
      errors.push({ path: 'project.version', message: 'Project version is required' });
    }
    if (!s.project.description) {
      errors.push({ path: 'project.description', message: 'Project description is required' });
    }
    if (!s.project.author) {
      errors.push({ path: 'project.author', message: 'Project author is required' });
    }
  }

  // Validate apps
  if (!s.apps || s.apps.length === 0) {
    errors.push({ path: 'apps', message: 'At least one app is required' });
  } else {
    s.apps.forEach((app, index) => {
      const prefix = `apps[${index}]`;

      if (!app.id) {
        errors.push({ path: `${prefix}.id`, message: 'App ID is required' });
      }
      if (!app.name) {
        errors.push({ path: `${prefix}.name`, message: 'App name is required' });
      }
      if (!app.route) {
        errors.push({ path: `${prefix}.route`, message: 'App route is required' });
      }

      // Validate paths
      if (!app.paths) {
        errors.push({ path: `${prefix}.paths`, message: 'App paths configuration is required' });
      } else {
        if (!app.paths.projectRoot) {
          errors.push({ path: `${prefix}.paths.projectRoot`, message: 'Project root is required' });
        }
        if (!app.paths.dist) {
          errors.push({ path: `${prefix}.paths.dist`, message: 'Distribution path is required' });
        }
      }

      // Validate commands
      if (!app.commands) {
        errors.push({ path: `${prefix}.commands`, message: 'App commands are required' });
      } else {
        if (!app.commands.install) {
          errors.push({ path: `${prefix}.commands.install`, message: 'Install command is required' });
        }
        if (!app.commands.build) {
          errors.push({ path: `${prefix}.commands.build`, message: 'Build command is required' });
        }
        if (!app.commands.dev) {
          errors.push({ path: `${prefix}.commands.dev`, message: 'Development command is required' });
        }
      }

      // Warnings
      if (!app.capabilities || app.capabilities.length === 0) {
        warnings.push({
          path: `${prefix}.capabilities`,
          message: 'No capabilities specified - app may have limited functionality',
        });
      }
    });
  }

  // Warnings for optional but recommended fields
  if (!s.project?.repository) {
    warnings.push({
      path: 'project.repository',
      message: 'Repository URL is recommended for traceability',
    });
  }

  if (!s.project?.license) {
    warnings.push({
      path: 'project.license',
      message: 'License identifier is recommended',
    });
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Load and parse a seed file from a path or URL
 */
export async function loadSeed(source: string): Promise<WeSeedFile> {
  let data: string;

  if (source.startsWith('http://') || source.startsWith('https://')) {
    // Load from URL
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch seed file from ${source}: ${response.statusText}`);
    }
    data = await response.text();
  } else {
    // Load from file system (Node.js environment)
    const fs = await import('fs/promises');
    data = await fs.readFile(source, 'utf-8');
  }

  const seed = JSON.parse(data) as WeSeedFile;

  const validation = validateSeed(seed);
  if (!validation.valid) {
    const errorMessages = validation.errors?.map((e) => `${e.path}: ${e.message}`).join('\n');
    throw new Error(`Invalid seed file:\n${errorMessages}`);
  }

  return seed;
}

/**
 * Normalize paths in seed file relative to a base directory
 */
export function normalizeSeedPaths(seed: WeSeedFile, basePath: string): WeSeedFile {
  const path = require('path');

  return {
    ...seed,
    apps: seed.apps.map((app) => ({
      ...app,
      paths: {
        ...app.paths,
        projectRoot: path.resolve(basePath, app.paths.projectRoot),
        dist: path.resolve(basePath, app.paths.dist),
      },
    })),
  };
}
