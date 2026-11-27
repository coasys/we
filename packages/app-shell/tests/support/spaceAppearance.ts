/**
 * What the space store lends the template and theme stores, for a test that has no space store: the
 * spaces it is given, and this agent's overrides held in a signal, each space following its own
 * default until one is set.
 */
import type { SpaceAppearance, SpaceAppearanceRecord, SpaceOverride } from '@shared/spaceAppearance';
import { FOLLOW_SPACE } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';

export function appearanceOf(
  reactivity: Pick<ReactivityPort, 'signal' | 'untrack'>,
  spaces: () => SpaceAppearanceRecord[],
): SpaceAppearance & { written: [string, keyof SpaceOverride, string][] } {
  const [overrides, setOverrides] = reactivity.signal<Record<string, SpaceOverride>>({});
  const written: [string, keyof SpaceOverride, string][] = [];
  return {
    written,
    spaces,
    spaceFor: (datasetId) => spaces().find((space) => space.uuid === datasetId),
    overrideFor: (datasetId) => overrides()[datasetId] ?? { template: FOLLOW_SPACE, theme: FOLLOW_SPACE },
    async setOverride(datasetId, which, id) {
      written.push([datasetId, which, id]);
      const all = reactivity.untrack(overrides);
      const held = all[datasetId] ?? { template: FOLLOW_SPACE, theme: FOLLOW_SPACE };
      setOverrides({ ...all, [datasetId]: { ...held, [which]: id } });
    },
  };
}
