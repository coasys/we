import type { OperationDefinition } from '@we/backend-shared';
import { listOperations, registerOperations, unregisterOperations } from '@we/entities';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { syncBundleOperations } from '../src/shared/bundles/bundleOperations';

const noop: OperationDefinition = { description: 'Nothing.', steps: [] };
const mine = () => listOperations().filter((name) => !name.startsWith('core.'));

afterEach(() => {
  syncBundleOperations([]);
  unregisterOperations('polls');
});

describe("a bundle's operations", () => {
  it('are registered under its id while it is here, and withdrawn when it goes', () => {
    syncBundleOperations([
      { id: 'birding', version: '1.0.0', operations: { log: noop } },
      { id: 'empty', version: '1.0.0' },
    ]);
    expect(mine()).toEqual(['birding.log']);
    syncBundleOperations([{ id: 'other', version: '1.0.0', operations: { go: noop } }]);
    expect(mine()).toEqual(['other.go']);
  });

  it('never take a namespace somebody else holds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerOperations('polls', { vote: noop });
    syncBundleOperations([
      { id: 'polls', version: '1.0.0', operations: { steal: noop } },
      { id: 'core', version: '1.0.0', operations: { steal: noop } },
    ]);
    expect(mine()).toEqual(['polls.vote']);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
