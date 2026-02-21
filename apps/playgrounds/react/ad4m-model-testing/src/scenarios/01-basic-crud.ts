// Phase 1b + 2 — validates basic save/update/delete/getData against the new API
import type { ScenarioModule } from '../harness/types';
import { stub } from '../harness/types';

export const scenario: ScenarioModule = {
  name: '01 — Basic CRUD',
  run: async (_perspective) => {
    return [
      stub('save() writes model links into perspective'),
      stub('save() returns the base expression ID'),
      stub('update() modifies existing field links'),
      stub('delete() removes all links for an instance'),
      stub('getData() returns a plain-object snapshot'),
      stub('findAll() returns all saved instances'),
      stub('find() returns a single instance by ID'),
    ];
  },
};
