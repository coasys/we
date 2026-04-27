/**
 * WE Seed File System
 *
 * Defines the shape of we-seed.json — the single source of truth for
 * project metadata, platform paths, and which apps are embedded in the shell.
 */

import type { SchemaNode } from '@we/schema-shared';

export interface WeSeedFile {
  /** Project metadata */
  project: {
    /** Workspace/project name */
    name: string;
    /** Semantic version */
    version: string;
    /** Brief description */
    description: string;
    /** Author or organization */
    author: string;
    /** Repository URL */
    repository?: string;
    /** License identifier (SPDX) */
    license?: string;
  };

  /** Host app customization (WE shell) — optional white-labeling */
  host?: {
    /** Theme overrides for the host */
    theme?: {
      colors?: Record<string, string>;
      fonts?: Record<string, string>;
    };
    /** Launcher UI customization */
    ui?: {
      /** Custom boot screen schema (replaces default) */
      bootScreen?: SchemaNode;
    };
  };

  /** AD4M-specific configuration */
  ad4m?: {
    /** AI agent configuration */
    ai?: {
      /** Enable AI features */
      enabled: boolean;
      /** Custom prompts or configurations */
      config?: Record<string, unknown>;
    };
    /** Perspective definitions */
    perspectives?: Array<{
      name: string;
      uuid?: string;
    }>;
    /** Language bundles to install */
    languages?: Array<{
      name: string;
      address?: string;
    }>;
    /** Executor configuration */
    executor?: {
      /** Custom executor settings */
      config?: Record<string, unknown>;
    };
  };

  /** Electron-specific configuration */
  electron?: {
    /** Path to the built app dist (relative to we-electron) */
    appDistPath?: string;
    /** Base port for Express servers serving embedded app bundles */
    basePort?: number;
  };

  /** Embedded applications shown in the shell sidebar */
  apps: Array<{
    /** Unique app identifier (e.g., "flux") */
    id: string;
    /** Display name shown in sidebar */
    name: string;
    /** Phosphor icon name for the sidebar button */
    icon: string;
    /** Brief description */
    description?: string;
    /** AD4M capabilities/permissions this app requires */
    capabilities: Array<'perspectives' | 'languages' | 'agents' | 'filesystem' | 'network'>;

    /** File paths — used by generate-seed-config.cjs and resolveAppUrl */
    paths: {
      /** Root directory of the app (relative to workspace root) */
      projectRoot: string;
      /** Distribution/build output directory */
      dist: string;
      /** Development server configuration */
      devServer?: {
        /** Port number */
        port: number;
        /** Host address */
        host?: string;
      };
      /** URL used when running on the web platform (e.g. deployed Netlify URL) */
      webUrl?: string;
    };
  }>;
}

/**
 * Validation result returned by the seed CLI validator.
 */
export interface SeedValidationResult {
  valid: boolean;
  errors?: Array<{ path: string; message: string }>;
  warnings?: Array<{ path: string; message: string }>;
}

/**
 * Metadata returned by the seed processor (legacy code-generation tooling).
 */
export interface SeedMetadata {
  seed: WeSeedFile;
  processedAt: string;
  integrationId: string;
  outputPaths: {
    schema: string;
    components: string;
    routes: string;
  };
}
