// Phase 2 migration smoke test — exercises @we/models Space and Block
// with the new decorator API before the @we/models migration is committed.
// Update this file when Phase 2 lands and @we/models is migrated.
import type { ScenarioModule } from '../harness/types';
import { stub } from '../harness/types';

export const scenario: ScenarioModule = {
  name: '08 — @we/models (Space + Block)',
  run: async (_perspective) => {
    return [
      stub('Space.save() writes expected links'),
      stub('Space.findAll() returns saved Space instances'),
      stub('Space fields (uuid, name, description, visibility) round-trip correctly'),
      stub('Space.locations @HasMany collection works'),
      stub('Block.save() writes expected links'),
      stub('Block.findAll() returns saved Block instances'),
      stub('Block.type @Field round-trips correctly'),
      stub('Block.comments @HasMany collection works'),
      stub('Block.reactions @HasMany collection works'),
    ];
  },
};
