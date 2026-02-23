import type { ScenarioModule } from '../harness/types';
import { scenario as s01 } from './01-basic-crud';
import { scenario as s02 } from './02-querying';
import { scenario as s03 } from './03-collections';
import { scenario as s04 } from './04-relationships';
import { scenario as s05 } from './05-subscriptions';
import { scenario as s06 } from './06-transactions';
import { scenario as s07 } from './07-prolog-bridge';
import { scenario as s08 } from './08-decorator-api';
import { scenario as s09 } from './09-model-inheritance';
import { scenario as s10 } from './10-crdt-ordering';

export const scenarios: ScenarioModule[] = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10];
