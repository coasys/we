/**
 * What a person is told when something fails.
 *
 * Six call sites put `error instanceof Error ? error.message : 'Unknown error'` into a toast, which
 * reads as thorough and is wrong twice: a backend message is written for whoever is reading the
 * stack (`AD4M error: gql: Failed to execute perspectiveAddLink: …`), and it publishes internals
 * into a surface with no trust boundary in front of it — templates render toasts too.
 *
 * The rule these pin is that the *fallback* is what a person sees by default, and recognition is
 * deliberately narrow. A wrong guess that reassures somebody about the wrong problem is worse than
 * the honest fallback, so anything unrecognised must come back untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { explain } from '../src/shared/userMessage';

const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => errors.mockClear());

describe('explain', () => {
  it('answers with the caller’s sentence when it recognises nothing', () => {
    // The common case, and the one that must not be clever: the caller knows what was being
    // attempted, which is the part of "what went wrong" a person can actually act on.
    expect(explain(new Error('gql: Failed to execute perspectiveAddLink at 0x3f'), 'Could not publish')).toBe(
      'Could not publish',
    );
  });

  it('never puts the backend’s words in front of a person', () => {
    const message = 'Failed to execute perspectiveAddLink: /home/someone/.ad4m/db?token=secret';
    expect(explain(new Error(message), 'Could not publish')).not.toContain('perspectiveAddLink');
    expect(explain(new Error(message), 'Could not publish')).not.toContain('token=secret');
  });

  it('still sends the whole error to the console', () => {
    // The detail is not hidden, it is relocated. A developer or a bug report must still be able to
    // reach it, which is the entire reason this can afford to say so little on screen.
    const cause = new Error('gql: something specific');
    explain(cause, 'Could not publish');
    expect(errors).toHaveBeenCalledWith('Could not publish', cause);
  });

  it.each([
    ['Failed to fetch', /could not reach the node/i],
    ['NetworkError when attempting to fetch resource', /could not reach the node/i],
    ['connect ECONNREFUSED 127.0.0.1:12000', /could not reach the node/i],
    ['Unauthorized: capability not granted', /refused the request/i],
    ['request timed out after 30000ms', /took too long/i],
  ])('recognises %s', (message, expected) => {
    // Matched on text rather than on type because nothing this crosses throws typed errors: the
    // AD4M client rethrows GraphQL strings, `fetch` throws a TypeError, and a Holochain failure
    // arrives as text from three layers down.
    const answer = explain(new Error(message), 'Could not publish');
    expect(answer).toMatch(expected);
    expect(answer.startsWith('Could not publish')).toBe(true);
  });

  it('copes with things that are not errors at all', () => {
    // A rejected promise can carry anything, and a store's catch has no say in what.
    expect(explain('a bare string', 'Could not publish')).toBe('Could not publish');
    expect(explain(undefined, 'Could not publish')).toBe('Could not publish');
    expect(explain({ weird: true }, 'Could not publish')).toBe('Could not publish');
  });
});
