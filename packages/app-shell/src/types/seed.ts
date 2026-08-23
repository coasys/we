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

  /** Experimental feature flags (dev/rollout toggles read by the running app). */
  features?: {
    /**
     * Route each template query through the neutral QueryIR (compileQuery → irToFlatQuery)
     * before it reaches the backend. Off by default; falls back to the direct (non-IR) path for anything the
     * IR can't yet express, so it's always safe. In dev the seed is a watched static import, so
     * flipping this + reloading takes effect (a production build bakes the seed → needs a rebuild).
     */
    useQueryIR?: boolean;
  };

  /**
   * Feature modules this deployment ships, by module id.
   *
   * A deployment declaring what it includes is what the seed is *for* — "which modules to include" is
   * already in its stated purpose. Ids here are matched against the bundled module set at boot; an id
   * with no bundled module is reported rather than ignored, since a silently missing module surfaces
   * later as an unexplained missing component.
   *
   * Bundled only for now. When modules become installable, this stays the deployment-level list and
   * `AgentSettings.installedModules` / `Space.enabledModules` carry the per-agent and per-space halves.
   */
  modules?: string[];

  /**
   * Built-in template ids this deployment ships, matched against the bundled template set.
   *
   * The counterpart to `modules`, and until now the missing half of the seed: a deployment could
   * declare which *capabilities* it includes but not which *interfaces*, even though templates are
   * the highest-volume contribution type in the whole system. Without it "built-in" was
   * all-or-nothing — whatever `templateRegistry` happened to import shipped everywhere, so adding a
   * showcase template imposed it on every white-label.
   *
   * **Unlisted templates leave the bundle**, not merely the picker: `pnpm --filter @we/app-shell
   * generate-templates` rewrites the generated registry from this list, so an unselected template
   * is never imported. Runtime filtering would have hidden it while still shipping it.
   *
   * Omit to ship the default set (`['default']`). An empty array is a deployment with no built-in
   * templates at all — legal, and what a host expecting to load everything from a marketplace
   * wants.
   */
  templates?: string[];

  /**
   * Built-in view ids this deployment ships — a space's *sections*, as opposed to `templates`, which
   * are whole interfaces.
   *
   * Same mechanism, one tier down, and the tier is what it buys: a deployment that wants the default
   * arrangement but not the globe used to have to fork the default template to remove one route.
   * Now it drops `"globe"` from this list and the Cesium view leaves the bundle entirely.
   *
   * **The order is the default section order.** A space that has never been configured shows its
   * sections in the order written here, so arranging a deployment's nav is done by writing this
   * array rather than by a second setting.
   *
   * Omit to ship every bundled view. An empty array is a deployment whose spaces have no sections at
   * all — legal, and what a kiosk or a single-purpose landing shell wants.
   */
  views?: string[];

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
    /**
     * Where the bundled executor keeps its data — the agent's keys, datasets and settings.
     * `~` expands to the home directory. Read at build time by each desktop host's
     * `generate-seed-config.cjs`; overridden at run time by `WE_AD4M_DATA_PATH`.
     *
     * Defaults to `~/.ad4m`, which is also the launcher's location — so out of the box WE
     * desktop, Flux and the ADAM launcher share one agent. Pointing this elsewhere gives WE its
     * own isolated agent, and is a **data migration, not a preference**: an existing agent does
     * not follow the path, so a running install would come up empty with no error and no obvious
     * way back. Change it deliberately, on a fresh install or after moving the directory yourself.
     */
    dataPath?: string;
    /**
     * The `ad4m-executor` binary the desktop hosts bundle, relative to the workspace root (or
     * absolute). Required — `setup-workspace` and `validate-seed` both fail without it.
     */
    executorPath?: string;
    /**
     * The ad4m repo checkout, relative to the workspace root (or absolute). Feeds the Tauri
     * `Cargo.toml` path dependencies, which is why its absence is only a warning: Electron
     * spawns the prebuilt binary and never needs the source.
     */
    repoPath?: string;
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

  /**
   * The neighbourhood URL of the global discovery space.
   * When set, users who haven't joined will be prompted to join on first launch.
   * Create this perspective locally, publish it as a neighbourhood, then paste its sharedUrl here.
   */
  globalSpaceUrl?: string;

  /**
   * The neighbourhood URL of the module marketplace.
   * When set, users get a marketplace icon in the sidebar. First click prompts them to join.
   */
  marketplaceUrl?: string;

  /** Embedded applications shown in the shell sidebar */
  apps: Array<{
    /** Unique app identifier (e.g., "flux") */
    id: string;
    /** Display name shown in sidebar */
    name: string;
    /** Phosphor icon name for the sidebar button */
    icon: string;
    /** Optional image URL for the sidebar avatar */
    image?: string;
    /** Brief description */
    description?: string;
    /** AD4M capabilities/permissions this app requires */
    capabilities: Array<'perspectives' | 'languages' | 'agents' | 'filesystem' | 'network'>;

    /** Build and install commands for this app */
    commands: {
      /** Command to install dependencies */
      install: string;
      /** Command to build the app */
      build?: string;
      /** Command to start the dev server */
      dev?: string;
    };

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
