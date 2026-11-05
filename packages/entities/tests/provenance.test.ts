/**
 * Whether a model made a record: the run its own `generatedBy` names, and nothing else.
 */
import { describe, expect, it } from 'vitest';

import { generatedRun } from '../src/utils/provenance';

describe('generatedRun', () => {
  it('names the run that wrote a record, as an id or an included record', () => {
    expect(generatedRun({ generatedBy: 'we://run/1' })).toEqual({ by: 'run', run: 'we://run/1' });
    expect(generatedRun({ generatedBy: { id: 'we://run/1' } })).toEqual({ by: 'run', run: 'we://run/1' });
  });

  it('reads lineage as lineage: coming from a call is not being written by a model', () => {
    expect(generatedRun({ extractedFrom: 'we://call/1' } as never)).toBeUndefined();
  });

  it('says nothing for what a person made', () => {
    expect(generatedRun({})).toBeUndefined();
    expect(generatedRun({ generatedBy: '' })).toBeUndefined();
  });
});
