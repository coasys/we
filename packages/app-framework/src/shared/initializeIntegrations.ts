/**
 * Integration Initialization
 *
 * Reads we-seed.json at startup, validates it, and populates appRegistry with
 * the resolved URL for each embedded app.  Everything else (display, switching,
 * iframe mounting) is handled by AppStore and TemplateProvider at runtime.
 */

import { defineModule, type ModuleStoreDeps, seedCapabilityToModule } from '@we/module-shared';

import weSeedFile from '../../../../we-seed.json';
import type { WeSeedFile } from '../types/seed';
import { generateIframePermissions, validateSeedForLauncher } from './integrationComposer';
import type { PlatformAdapter } from './platform/types';
import { activateSeedModules } from './registries/bundledModules';
import { moduleRegistry } from './registries/moduleRegistry';
import { slotRegistry } from './registries/slotRegistry';

export interface IntegrationDeps {
  /**
   * Framework components a bundled module needs to describe itself, supplied by the caller.
   *
   * Injected rather than imported because this file is framework-neutral `shared/` code — importing
   * the Solid component registry here would drag the whole component tree into it. It is also what
   * keeps Solid and `@we/widgets` single instances shared with the host, which is the property that
   * starts to matter once modules load dynamically.
   */
  components?: Record<string, unknown>;
  /** Reactivity lent to module stores, so a module needn't import a framework. */
  storeDeps?: ModuleStoreDeps;
}

export function initializeIntegrations(platformAdapter: PlatformAdapter, deps: IntegrationDeps = {}): void {
  try {
    const seed = weSeedFile as unknown as WeSeedFile;

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

    const host = { backend: 'ad4m', framework: 'solid' };

    // Embedded apps register as modules whose contribution is an iframe. Only the URL resolution is
    // platform-specific, and only the host can do it — everything after that is ordinary module
    // registration, so an embedded app is gated, refused and reported like anything else.
    const isDev = platformAdapter.isDevelopment;
    const embedded: string[] = [];
    for (const app of seed.apps) {
      const definition = defineModule({
        id: app.id,
        name: app.name,
        icon: app.icon,
        capabilities: app.capabilities.map(seedCapabilityToModule),
        // An embedded app reaches the host's agent through the data layer, so it is coupled to
        // whichever one this build runs. Declared rather than assumed: on a host without that
        // backend it is refused at registration with a reason, instead of mounting an iframe that
        // waits on a handshake nobody will answer.
        backends: ['ad4m'],
        embed: {
          url: platformAdapter.resolveAppUrl(app, isDev),
          allow: generateIframePermissions(app.capabilities),
          image: app.image,
        },
      });
      const outcome = moduleRegistry.register(definition, host, deps.storeDeps);
      if (outcome.registered) embedded.push(app.id);
    }

    // Activate the feature modules this deployment declares. Components are passed in rather than
    // imported by each module, so Solid and @we/widgets stay single instances shared with the host.
    const { activated } = activateSeedModules(
      seed.modules,
      { components: deps.components ?? {}, storeDeps: deps.storeDeps },
      host,
      moduleRegistry,
    );

    console.log(
      `✓ ${seed.project.name} initialized — ${embedded.length} embedded app(s)` +
        (activated.length ? `, ${activated.length} module(s): ${activated.join(', ')}` : ''),
    );
  } catch (error) {
    console.error('❌ Failed to initialize integrations:', error);
  }
}
