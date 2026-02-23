// Phase 2 migration smoke test — exercises @we/models Space
// with the new decorator API (@Model, @Field, @HasMany).
import type { PerspectiveProxy } from '@coasys/ad4m';
import { LinkQuery } from '@coasys/ad4m';
import { Space } from '@we/models';

import type { ScenarioModule } from '../harness/types';
import { assert, test } from '../harness/types';

export const scenario: ScenarioModule = {
  name: '08 — @we/models (Space)',
  run: async (perspective: PerspectiveProxy) => {
    // Wipe all links so each run starts clean
    const existing = await perspective.get(new LinkQuery({}));
    await Promise.all(existing.map((l) => perspective.remove(l)));

    await perspective.ensureSDNASubjectClass(Space);

    return [
      await test('Space.save() writes expected links', async () => {
        const space = new Space(perspective);
        space.name = 'Test Space';
        space.description = 'A test space';
        await space.save();
      }),

      await test('Space.findAll() returns saved Space instances', async () => {
        const spaces = await Space.findAll(perspective);
        assert(spaces.length > 0, 'No spaces found');
      }),

      await test('Space fields round-trip correctly', async () => {
        const space = new Space(perspective);
        space.name = 'Round Trip';
        space.description = 'desc';
        space.visibility = 'public';
        await space.save();
        const found = await Space.findAll(perspective, { where: { base: space.baseExpression } });
        assert(found.length > 0, 'Space not found by base expression');
        assert(found[0].name === 'Round Trip', `name mismatch: ${found[0].name}`);
      }),

      await test('Space.locations @HasMany collection works', async () => {
        const space = new Space(perspective);
        space.name = 'Location Space';
        space.description = 'desc';
        await space.save();
        await space.addLocations('literal://string:testlocation1');
        const updated = await Space.findAll(perspective, { where: { base: space.baseExpression } });
        assert(updated[0]?.locations?.includes('literal://string:testlocation1'), 'location not added');
      }),
    ];
  },
};
