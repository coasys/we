/**
 * Setting a space up for an app: the record types, then the workflows, then the sections — and a
 * step that throws reported like one that refused, since the space exists by then.
 */
import { describe, expect, it } from 'vitest';

import { setUpForApp } from '../src/shared/bundles/setUpForApp';

const recording = () => {
  const ran: string[] = [];
  const step =
    (name: string, answer: string[] | Error = []) =>
    async () => {
      ran.push(name);
      if (answer instanceof Error) throw answer;
      return answer;
    };
  return { ran, step };
};

describe('setting a space up for an app', () => {
  it('adds the record types, then the workflows, then switches the sections on', async () => {
    const { ran, step } = recording();
    const problems = await setUpForApp({
      addRecordTypes: step('types'),
      installWorkflows: step('workflows'),
      finish: async () => void (await step('sections')()),
    });
    expect(problems).toEqual([]);
    expect(ran).toEqual(['types', 'workflows', 'sections']);
  });

  it('stops after a step that refused, so no section reads a type the space would not take', async () => {
    const { ran, step } = recording();
    const problems = await setUpForApp({
      addRecordTypes: step('types', ['the space already has a “Question” from another app']),
      installWorkflows: step('workflows'),
      finish: async () => void (await step('sections')()),
    });
    expect(problems).toEqual(['the space already has a “Question” from another app']);
    expect(ran).toEqual(['types']);
  });

  it('reports a save that throws as a problem, rather than throwing out of the set-up', async () => {
    const { ran, step } = recording();
    const problems = await setUpForApp({
      addRecordTypes: step('types', new Error('the store could not be written')),
      installWorkflows: step('workflows'),
      finish: async () => void (await step('sections')()),
    });
    expect(problems).toEqual(['adding its record types failed: the store could not be written']);
    expect(ran).toEqual(['types']);
  });

  it('reports a section that cannot be switched on the same way', async () => {
    const problems = await setUpForApp({
      addRecordTypes: async () => [],
      installWorkflows: async () => [],
      finish: async () => {
        throw new Error('no such section');
      },
    });
    expect(problems).toEqual(['switching its sections on failed: no such section']);
  });
});
