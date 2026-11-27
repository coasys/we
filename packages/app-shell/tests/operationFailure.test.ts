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

  it('leaves rules that could not be read to the write check, which says them in the policy’s sentence', () => {
    // The sentence itself is pinned where it is said, in the roles part's tests.
    const unreadable = new OperationError({
      class: 'precondition',
      code: 'refused',
      message: "This space's rules could not be loaded, so changes are paused. Try again in a moment.",
      refusal: { reason: 'unreadable', action: 'CollectionBlock.create' },
    });
    expect(operationFailureMessage(unreadable, 'Could not add that')).toBeNull();
  });

  it('says an error the operation declares in its own words', () => {
    const taken = new OperationError({
      class: 'precondition',
      code: 'slugTaken',
      message: 'This space already has one called that.',
      declared: true,
    });
    expect(operationFailureMessage(taken, 'Could not add that')).toBe('This space already has one called that.');
  });

  it('says a precondition the runner raised in the host’s words, since its message is for the call’s author', () => {
    const missing = new OperationError({ class: 'precondition', code: 'notFound', message: 'No Signal matched' });
    expect(operationFailureMessage(missing, 'Could not add that')).toBe('Could not add that');
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
