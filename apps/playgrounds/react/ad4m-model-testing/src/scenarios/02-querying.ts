// Phase 3c — validates JSON-first Query<T> and fluent ModelQueryBuilder
import type { ScenarioModule } from '../harness/types';
import { stub } from '../harness/types';

export const scenario: ScenarioModule = {
  name: '02 — Querying',
  run: async (_perspective) => {
    return [
      stub('findAll() with where clause filters correctly'),
      stub('findAll() with order: ASC returns sorted results'),
      stub('findAll() with order: DESC returns sorted results'),
      stub('findAll() with limit/offset paginates correctly'),
      stub('findAll() with count:true returns total alongside results'),
      stub('fluent .query().where().exec() produces same results as JSON form'),
      stub('Query<T> objects are composable with spread'),
    ];
  },
};
