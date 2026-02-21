// Phase 2 + 3c — validates @HasOne, @BelongsToOne, @BelongsToMany with include
import type { ScenarioModule } from '../harness/types';
import { stub } from '../harness/types';

export const scenario: ScenarioModule = {
  name: '04 — Relationships & Include',
  run: async (_perspective) => {
    return [
      stub('@BelongsToOne reverse traversal returns correct parent ID'),
      stub('@BelongsToMany reverse traversal returns all parent IDs'),
      stub('include: [{ relation }] hydrates @HasMany to typed instances'),
      stub('include: [{ relation }] hydrates @BelongsToOne to typed instance'),
      stub('nested include (2 levels deep) resolves correctly'),
      stub('include with where clause filters related instances'),
      stub('include with limit caps related results'),
      stub('maxIncludeDepth prevents infinite recursion on circular refs'),
      stub('lazy default: without include, relations remain string[]'),
    ];
  },
};
