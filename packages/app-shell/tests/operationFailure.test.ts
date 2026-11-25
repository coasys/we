/**
 * What a person is told when an operation a template invoked did nothing — the same rule the store
 * actions follow, so moving a call from a store action to `ops.*` loses no toast.
 */
import { OperationError } from '@we/entities';
import { describe, expect, it } from 'vitest';

import { operationFailureMessage } from '../src/shared/operationFailure';

describe('saying why an operation did nothing', () => {
  it('stays quiet for a refusal, which the write check already said', () => {
    const refused = new OperationError({ class: 'precondition', code: 'refused', message: 'Not allowed' });
    expect(operationFailureMessage(refused)).toBeNull();
  });

  it('says a precondition the operation names in its own words', () => {
    const taken = new OperationError({
      class: 'precondition',
      code: 'slugTaken',
      message: 'This space already has one called that.',
    });
    expect(operationFailureMessage(taken, 'Could not add that')).toBe('This space already has one called that.');
  });

  it('says anything else in the host’s words, never the call’s', () => {
    const malformed = new OperationError({
      class: 'static',
      code: 'badArgs',
      message: 'core.createBoard requires "title"',
    });
    expect(operationFailureMessage(malformed)).toBe('Could not save that change.');
    expect(operationFailureMessage(new Error('the backend went away'), 'Could not add that')).toBe(
      'Could not add that',
    );
  });
});
