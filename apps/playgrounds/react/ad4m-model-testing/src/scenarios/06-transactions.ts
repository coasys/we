// Phase 3b — validates TransactionContext atomic multi-save/update/delete
import type { ScenarioModule } from '../harness/types';
import { stub } from '../harness/types';

export const scenario: ScenarioModule = {
  name: '06 — Transactions',
  run: async (_perspective) => {
    return [
      stub('Ad4mModel.transaction() commits all saves atomically'),
      stub('Ad4mModel.transaction() commits mixed save/update/delete atomically'),
      stub('throwing inside transaction() aborts — no partial writes visible'),
      stub('tx context passed to save/update/delete uses same batch ID'),
      stub('passing raw batchId string to save() is a type error (compile-time)'),
    ];
  },
};
