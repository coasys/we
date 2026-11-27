import { isOperationError } from '@we/entities';

/**
 * What a person is told when an operation they asked for did nothing, or `null` when it was said
 * already.
 *
 * A refusal by the write check was said by the write check, once, for every write. An error the
 * operation declares in its `errors` — a name the space already has — is said in the operation's own
 * words, which are written for the person who pressed. A record the interface on screen may not
 * change, chosen when the operation ran, is said as that: the press reached something the interface
 * was not granted. A space whose own record has not reached this device yet is said as that: the
 * same press succeeds once it has. Anything else (a malformed call, a record that was not there, a backend that
 * failed) is said in the host's words, `fallback`: what the runner's own errors say is for whoever
 * wrote the call.
 */
export function operationFailureMessage(error: unknown, fallback = 'Could not save that change.'): string | null {
  if (isOperationError(error) && error.code === 'refused') return null;
  if (isOperationError(error) && error.code === 'notGranted') return 'This interface may not change that.';
  if (isOperationError(error) && error.code === 'spaceNotReady')
    return 'This space is still arriving. Try again in a moment.';
  if (isOperationError(error) && error.declared) return error.message;
  return fallback;
}
