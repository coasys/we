/**
 * WE Seed File System
 * 
 * Allows external applications to define integration configurations
 * that can be used to embed their apps into WE launchers.
 */

import type { SchemaNode } from '@we/schema-renderer/shared';

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

  /** Host app customization (WE shell) */
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
      /** Custom app settings schema (replaces default) */
      appSettings?: SchemaNode;
      /** Enable/disable template switching in settings */
      enableTemplateSwitching?: boolean;
      /** Default template for native app mode */
      defaultTemplate?: string;
    };
  };

  /** AD4M-specific configuration */
  ad4m?: {
    /** AI agent configuration */
    ai?: {
      /** Enable AI features */
      enabled: boolean;
      /** Custom prompts or configurations */
      config?: Record<string, any>;
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
      config?: Record<string, any>;
    };
  };

  /** Embedded applications */
  apps: Array<{
    /** Unique app identifier (e.g., "flux", "chat") */
    id: string;
    /** Display name */
    name: string;
    /** Route path (e.g., "/", "/flux", "/chat") */
    route: string;
    /** Entry point file (relative to dist) */
    entry?: string;
    /** AD4M capabilities/permissions this app requires */
    capabilities: Array<'perspectives' | 'languages' | 'agents' | 'filesystem' | 'network'>;

    /** File paths and build configuration */
    paths: {
      /** Root directory of the app (relative to seed file) */
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
    };

    /** Build and development commands */
    commands: {
      /** Install dependencies (e.g., "yarn install", "pnpm install") */
      install: string;
      /** Production build command */
      build: string;
      /** Development server command */
      dev: string;
      /** Cleanup command (optional) */
      clean?: string;
    };
  }>;
}

/**
 * Validation result for seed files
 */
export interface SeedValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
  }>;
  warnings?: Array<{
    path: string;
    message: string;
  }>;
}

/**
 * Metadata generated during seed processing
 */
export interface SeedMetadata {
  /** Original seed file */
  seed: WeSeedFile;
  /** Timestamp of processing */
  processedAt: string;
  /** Generated integration ID */
  integrationId: string;
  /** Output paths */
  outputPaths: {
    schema: string;
    components: string;
    routes: string;
  };
}
