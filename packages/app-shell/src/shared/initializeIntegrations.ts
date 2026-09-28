/**
 * Integration Initialization
 *
 * Reads we-seed.json at startup, validates it, registers the embedded apps and the feature modules
 * the deployment declares. Everything else (display, switching, iframe mounting) is handled by
 * AppStore and TemplateProvider at runtime.
 */

import { defineModule, type ModuleHostProfile, type ModuleStoreDeps, seedCapabilityToModule } from '@we/module-shared';

import type { WeSeedFile } from '../types/seed';
import { installConsoleTrace } from './installConsoleTrace';
import { generateIframePermissions, validateSeedForLauncher } from './integrationComposer';
import type { PlatformAdapter } from './platform/types';
import { activateSeedModules } from './registries/bundledModules';
import { HOST_KERNELS } from './registries/moduleHostServices';
import { moduleRegistry } from './registries/moduleRegistry';
import { registerCoreSlots, slotRegistry } from './registries/slotRegistry';
import { seedModuleIds } from './seedModules';
import { provideSeed } from './seedRegistry';

export interface IntegrationDeps {
  /**
   * Framework components a bundled module needs to describe itself, supplied by the caller.
   *
   * Injected rather than imported because this file is framework-neutral `shared/` code — importing
   * the Solid component registry here would drag the whole component tree into it. It is also what
   * keeps Solid and `@we/widgets` single instances shared with the host.
   */
  components?: Record<string, unknown>;
  /** Reactivity lent to module stores, so a module needn't import a framework. */
  storeDeps?: ModuleStoreDeps;
  /**
   * What this host is, for compatibility. The backend id comes from the connector and the framework
   * from the renderer; the kernels are what `moduleHostServices` implements. Defaults are what the
   * bundled hosts are, so an app that says nothing gets the answer it always had.
   */
  host?: Partial<ModuleHostProfile>;
}

export function initializeIntegrations(
  platformAdapter: PlatformAdapter,
  seed: WeSeedFile,
  deps: IntegrationDeps = {},
): void {
  // Before anything else registers: presence starts early, and a trace that misses the first
  // handshake misses the part being complained about.
  installConsoleTrace();

  try {
    provideSeed(seed);

    /*
      The host's own chrome, before anything replaces or contributes to it. A call rather than an
      import side effect: the requirement is that core slots exist before the seed's boot-screen
      override below and before any module registers — which is exactly here.
    */
    registerCoreSlots();

    const validation = validateSeedForLauncher(seed);
    if (!validation.valid) {
      console.error('❌ Invalid seed file:', validation.errors);
      return;
    }

    // Apply optional white-label boot screen override. Deployment-level configuration of shell
    // chrome — the layer whose scope matches, unlike a per-space template.
    if (seed.host?.ui?.bootScreen) {
      slotRegistry.replace('core:bootScreen', seed.host.ui.bootScreen);
    }

    const host: ModuleHostProfile = {
      backend: deps.host?.backend ?? 'ad4m',
      framework: deps.host?.framework ?? 'solid',
      kernels: deps.host?.kernels ?? HOST_KERNELS,
    };

    // Embedded apps register as modules whose contribution is an iframe. Only the URL resolution is
    // platform-specific, and only the host can do it — everything after that is ordinary module
    // registration, so an embedded app is gated, refused and reported like anything else.
    const isDev = platformAdapter.isDevelopment;
    const embedded: string[] = [];
    for (const app of seed.apps) {
      const definition = defineModule({
        manifest: {
          id: app.id,
          name: app.name,
          description: app.description,
          icon: app.icon,
          requires: {
            // An embedded app reaches the host's agent through the data layer, so it is coupled to
            // whichever one this build runs. Declared rather than assumed: on a host without that
            // backend it is refused at registration with a reason.
            backends: ['ad4m'],
            permissions: app.capabilities.map(seedCapabilityToModule),
          },
        },
        contributes: {
          embed: {
            url: platformAdapter.resolveAppUrl(app, isDev),
            allow: generateIframePermissions(app.capabilities),
            image: app.image,
          },
        },
      });
      const outcome = moduleRegistry.register(definition, host, deps.storeDeps);
      if (outcome.registered) embedded.push(app.id);
    }

    // Activate the feature modules this deployment declares. Components are passed in rather than
    // imported by each module, so Solid and @we/widgets stay single instances shared with the host.
    const { activated, refused } = activateSeedModules(
      seedModuleIds(seed),
      { components: deps.components ?? {}, storeDeps: deps.storeDeps },
      host,
      moduleRegistry,
    );

    // `info`: one line, once, at boot, saying what this deployment turned out to be.
    console.info(
      `✓ ${seed.project.name} initialized — ${embedded.length} embedded app(s)` +
        (activated.length ? `, ${activated.length} module(s): ${activated.join(', ')}` : ''),
    );

    /*
      And say what did *not* start, in the same breath.

      The registry already warns per refusal, and that was not enough: the line somebody actually reads
      is this summary, and a summary that lists only what worked reads as a healthy boot. A module the
      seed asked for and the host refused is then a feature that is simply absent — no store, no
      launcher, no panel — with the only evidence a warning further up a console nobody had reason to
      scroll. That cost three rounds of looking for a switch that did not exist.

      `warn`, not `info`: the deployment asked for something it did not get.
    */
    if (refused.length) {
      const named = refused.map(({ id, problems }) => `${id} (${problems.join('; ')})`).join(', ');
      console.warn(`⚠ ${refused.length} module(s) the seed asked for did not start: ${named}`);
    }
  } catch (error) {
    console.error('❌ Failed to initialize integrations:', error);
  }
}
