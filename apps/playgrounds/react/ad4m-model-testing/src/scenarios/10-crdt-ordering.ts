// Phase 5 — placeholder for CRDT ordering scenarios
// See CRDT-ORDERING-STRATEGY.md for design details.
import type { ScenarioModule } from '../harness/types';
import { stub } from '../harness/types';

export const scenario: ScenarioModule = {
  name: '10 — CRDT Ordering (Phase 5)',
  run: async (_perspective) => {
    return [
      stub('concurrent saves produce deterministic link ordering'),
      stub('ordering is stable across perspective sync'),
    ];
  },
};
