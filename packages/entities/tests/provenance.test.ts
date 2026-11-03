/**
 * Whether a model made a record: its own `generatedBy`, or the call an extraction pass made it from.
 */
import { describe, expect, it } from 'vitest';

import { generatedRun } from '../src/utils/provenance';

describe('generatedRun', () => {
  it('names the run that wrote a record, as an id or an included record', () => {
    expect(generatedRun({ generatedBy: 'we://run/1' })).toEqual({ by: 'run', run: 'we://run/1' });
    expect(generatedRun({ generatedBy: { id: 'we://run/1' } })).toEqual({ by: 'run', run: 'we://run/1' });
  });

  it('names the call for what an extraction pass made', () => {
    expect(generatedRun({ extractedFrom: 'we://call/1' })).toEqual({ by: 'extraction', from: 'we://call/1' });
  });

  it('prefers the run where a record carries both', () => {
    expect(generatedRun({ generatedBy: 'we://run/1', extractedFrom: 'we://call/1' })).toEqual({
      by: 'run',
      run: 'we://run/1',
    });
  });

  it('says nothing for what a person made', () => {
    expect(generatedRun({})).toBeUndefined();
    expect(generatedRun({ generatedBy: '', extractedFrom: null })).toBeUndefined();
  });
});
