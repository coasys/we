import { entityAddress, parseAddress, propertyAddress } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

import { isRecordAddress } from './recordAddress';

describe('isRecordAddress', () => {
  it('is a record for a stored entity', () => {
    expect(isRecordAddress(parseAddress(entityAddress('ds', 'TaskBlock', 't1')))).toBe(true);
  });

  it('is not one for the nodes a map of a vocabulary makes up', () => {
    // A click on these asked the inspector for a model called "$schema".
    expect(isRecordAddress(parseAddress(entityAddress('ds', '$schema', 'TaskBlock')))).toBe(false);
    expect(isRecordAddress(parseAddress(entityAddress('ds', '$instances', 'TaskBlock')))).toBe(false);
    expect(isRecordAddress(parseAddress(propertyAddress('ds', '$schema', 'TaskBlock', 'title')))).toBe(false);
  });
});
