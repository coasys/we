/**
 * A bundle's workflows, installed when a space is set up for it.
 */
import type { WorkflowDefinition } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { installBundleWorkflows } from '../src/shared/bundles/installWorkflows';

const workflow = (name: string): WorkflowDefinition => ({
  name,
  entities: ['Species'],
  states: [{ name: 'seen' }, { name: 'confirmed' }],
  transitions: [{ from: 'seen', to: 'confirmed' }],
});

describe('installing a bundle’s workflows into a space', () => {
  it('installs each into the space’s dataset', async () => {
    const installed: string[] = [];
    const port = {
      install: async (dataset: unknown, w: WorkflowDefinition) => void installed.push(`${String(dataset)}:${w.name}`),
    };
    expect(await installBundleWorkflows(port, 'space-1', [workflow('Confirm'), workflow('Archive')])).toEqual([]);
    expect(installed).toEqual(['space-1:Confirm', 'space-1:Archive']);
  });

  it('installs the rest when the backend refuses one, and names the one it refused', async () => {
    const installed: string[] = [];
    const port = {
      install: async (_dataset: unknown, w: WorkflowDefinition) => {
        if (w.name === 'Confirm') throw new Error('workflows: an approvals rule this backend does not keep');
        installed.push(w.name);
      },
    };
    const problems = await installBundleWorkflows(port, 'space-1', [workflow('Confirm'), workflow('Archive')]);
    expect(installed).toEqual(['Archive']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('“Confirm”');
  });

  it('says so once when the space cannot hold workflows, and is silent when there are none', async () => {
    expect(await installBundleWorkflows(undefined, 'space-1', [workflow('Confirm')])).toHaveLength(1);
    expect(await installBundleWorkflows({ install: async () => {} }, undefined, [workflow('Confirm')])).toHaveLength(1);
    expect(await installBundleWorkflows(undefined, undefined, [])).toEqual([]);
  });
});
