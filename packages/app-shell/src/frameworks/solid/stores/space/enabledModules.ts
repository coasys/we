import { isCommunityDecided, moduleRegistry } from '@shared/registries/moduleRegistry';
import { seedDefaultEnabledModules } from '@shared/seedModules';
import { getSeed } from '@shared/seedRegistry';

import type { ModuleSetting } from './types';

/**
 * Which modules a layer has on, from its stored value.
 *
 * An unset field means "not decided", never "none" — see `Space.enabledModules`. Falling back is
 * what stops this being a silent regression that strips every existing space of its chrome. A value
 * that is not a list is a corrupt setting, not a decision to disable everything.
 *
 * The fallback differs by layer, which is why it is a parameter: a community that has not decided
 * gets the deployment's default, and an agent who has not decided gets everything registered.
 *
 * A plain function over the stored value rather than a memo over the current space, because the
 * settings page answers this for spaces the agent is not standing in.
 */
export function resolveEnabledModules(stored: unknown, fallback: () => string[] = defaultEnabledModules): string[] {
  if (Array.isArray(stored)) return stored.filter((id): id is string => typeof id === 'string');
  if (stored !== undefined && stored !== null && stored !== '') {
    console.warn('enabledModules is not a list; falling back to the default');
  }
  return fallback();
}

/** Every module this build registered. */
export function registeredModules(): string[] {
  return moduleRegistry.all().map((entry) => entry.definition.manifest.id);
}

/**
 * What a space has on until its community decides: the deployment's default, among what registered.
 *
 * The seed's, not "every registered module", so a module a deployment adds does not appear in every
 * existing space. A host with no seed (a test) falls back to the registered set, the right answer
 * when nobody has said otherwise.
 */
export function defaultEnabledModules(): string[] {
  const registered = registeredModules();
  try {
    const shipped = new Set(seedDefaultEnabledModules(getSeed()));
    return registered.filter((id) => shipped.has(id));
  } catch {
    return registered;
  }
}

/**
 * Every registered module, with each layer's answer for one space — the shape a settings list renders.
 *
 * All three answers travel together because the settings page has to explain *why* a module is not
 * showing. "Enabled by the community but not installed by you" and "installed but the community has
 * it off" are different situations with different remedies, and a single boolean cannot tell them
 * apart — it would leave a toggle that is on next to a module that is not there.
 */
export function moduleSettingsFrom(stored: unknown, installed: Set<string>, muted: Set<string>): ModuleSetting[] {
  const on = new Set(resolveEnabledModules(stored));
  return (
    moduleRegistry
      .all()
      // Chrome and content only. A contribution is gated where it renders, and those are the two that
      // render inside a space — an app switcher is shell-level, a capability is mounted by whatever
      // template asks for it, and an agent-scoped module is active wherever its agent is. None of
      // those is a community's decision. See `isCommunityDecided`.
      .filter(({ definition }) => isCommunityDecided(definition))
      .map(({ definition: { manifest } }) => {
        const enabled = on.has(manifest.id);
        const isInstalled = installed.has(manifest.id);
        const isMuted = muted.has(manifest.id);
        return {
          id: manifest.id,
          name: manifest.name,
          description: manifest.description ?? '',
          icon: manifest.icon ?? 'puzzle-piece',
          enabled,
          installed: isInstalled,
          visible: !isMuted,
          active: enabled && isInstalled && !isMuted,
        };
      })
  );
}
