/**
 * WE Seed File System
 * 
 * Allows external applications to define integration configurations
 * that can be used to embed their apps into WE launchers.
 */

export interface WeSeedFile {
  /** Project metadata */
  project: {
    /** Application name */
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

  /** File paths and build configuration */
  paths: {
    /** Root directory of the project (relative to seed file) */
    projectRoot: string;
    /** AD4M data directory (for development) */
    ad4mRoot?: string;
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
    /** Install dependencies (e.g., "pnpm install") */
    install: string;
    /** Production build command */
    build: string;
    /** Development server command */
    dev: string;
    /** Cleanup command (optional) */
    clean?: string;
  };

  /** UI customization and overrides */
  ui?: {
    /** Custom UI templates mapped by route/component name */
    templates?: Record<string, any>;
    /** Theme overrides */
    theme?: {
      colors?: Record<string, string>;
      fonts?: Record<string, string>;
    };
    /** Custom routes to register */
    routes?: Array<{
      path: string;
      component: string;
    }>;
    /** Custom components to register */
    components?: Record<string, string>;
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

  /** Integration settings */
  integration: {
    /** Mount point in WE (e.g., "flux", "community-hub") */
    mount: string;
    /** Application capabilities/permissions */
    capabilities: Array<'perspectives' | 'languages' | 'agents' | 'filesystem' | 'network'>;
    /** Supported platforms */
    platforms: Array<'electron' | 'tauri' | 'web'>;
    /** Entry point file (relative to dist) */
    entry?: string;
  };
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
