import type { WeSeedFile, SeedValidationResult } from '../types/seed';

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

  // Validate paths
  if (!s.paths) {
    errors.push({ path: 'paths', message: 'Paths configuration is required' });
  } else {
    if (!s.paths.projectRoot) {
      errors.push({ path: 'paths.projectRoot', message: 'Project root path is required' });
    }
    if (!s.paths.dist) {
      errors.push({ path: 'paths.dist', message: 'Distribution path is required' });
    }
  }

  // Validate commands
  if (!s.commands) {
    errors.push({ path: 'commands', message: 'Commands configuration is required' });
  } else {
    if (!s.commands.install) {
      errors.push({ path: 'commands.install', message: 'Install command is required' });
    }
    if (!s.commands.build) {
      errors.push({ path: 'commands.build', message: 'Build command is required' });
    }
    if (!s.commands.dev) {
      errors.push({ path: 'commands.dev', message: 'Development command is required' });
    }
  }

  // Validate integration
  if (!s.integration) {
    errors.push({ path: 'integration', message: 'Integration configuration is required' });
  } else {
    if (!s.integration.mount) {
      errors.push({ path: 'integration.mount', message: 'Integration mount point is required' });
    }
    if (!s.integration.capabilities || s.integration.capabilities.length === 0) {
      warnings.push({ 
        path: 'integration.capabilities', 
        message: 'No capabilities specified - app may have limited functionality' 
      });
    }
    if (!s.integration.platforms || s.integration.platforms.length === 0) {
      errors.push({ path: 'integration.platforms', message: 'At least one platform must be specified' });
    }
  }

  // Warnings for optional but recommended fields
  if (!s.project?.repository) {
    warnings.push({ 
      path: 'project.repository', 
      message: 'Repository URL is recommended for traceability' 
    });
  }

  if (!s.project?.license) {
    warnings.push({ 
      path: 'project.license', 
      message: 'License identifier is recommended' 
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
    const errorMessages = validation.errors?.map(e => `${e.path}: ${e.message}`).join('\n');
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
    paths: {
      ...seed.paths,
      projectRoot: path.resolve(basePath, seed.paths.projectRoot),
      dist: path.resolve(basePath, seed.paths.dist),
      ad4mRoot: seed.paths.ad4mRoot 
        ? path.resolve(basePath, seed.paths.ad4mRoot) 
        : undefined,
    },
  };
}
