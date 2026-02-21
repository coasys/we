// Phase 2 + 3c — validates @HasMany collection operations
import type { ScenarioModule } from '../harness/types';
import { stub } from '../harness/types';

export const scenario: ScenarioModule = {
  name: '03 — Collections (@HasMany)',
  run: async (_perspective) => {
    return [
      stub('@HasMany property is [] on a fresh instance'),
      stub('addCollection() appends a target ID'),
      stub('setCollection() replaces all targets'),
      stub('removeCollection() removes a specific target ID'),
      stub('collection links are visible in perspective after save'),
      stub('@HasOne enforces single-value on read (returns first only)'),
    ];
  },
};
