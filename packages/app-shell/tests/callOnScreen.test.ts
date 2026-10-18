/**
 * When the address starts naming the call this agent joined — coasys/we#304.
 */
import { callParamToWrite } from '@shared/callOnScreen';
import { describe, expect, it } from 'vitest';

const spaceIdOf = (uri: string) => uri.replace(/^[a-z]+:\/\//, '');
const base = {
  segments: ['space', 'cid-1', 'canvas'],
  current: null,
  recordId: 'rec-1',
  datasetUri: 'neighbourhood://cid-1',
  spaceIdOf,
};

describe('naming a joined call in the address', () => {
  it('writes the call into an address that names none', () => {
    expect(callParamToWrite(base)).toBe('rec-1');
  });

  it('replaces another call the address named', () => {
    // Joining is a choice to be in this call; a past call left on screen is not one to keep.
    expect(callParamToWrite({ ...base, current: 'rec-old' })).toBe('rec-1');
  });

  it('writes nothing when the address already names it', () => {
    expect(callParamToWrite({ ...base, current: 'rec-1' })).toBeNull();
  });

  it('writes nothing while the address is about another space', () => {
    expect(callParamToWrite({ ...base, segments: ['space', 'cid-2', 'canvas'] })).toBeNull();
  });

  it('writes nothing outside a space', () => {
    expect(callParamToWrite({ ...base, segments: [] })).toBeNull();
    expect(callParamToWrite({ ...base, segments: ['settings'] })).toBeNull();
  });

  it('takes a call that names no space to be in the one on screen', () => {
    expect(callParamToWrite({ ...base, datasetUri: null })).toBe('rec-1');
  });

  it('writes nothing for a call with no record', () => {
    expect(callParamToWrite({ ...base, recordId: '' })).toBeNull();
  });
});
