/**
 * How a declared operation fails, in two classes a caller can act on differently.
 *
 * - **static** — the operation, or the call to it, is wrong: malformed, unknown, called with bad
 *   arguments, reading a name nothing bound. Running it again unchanged fails the same way, so the
 *   fault is in whoever wrote the definition or the call.
 * - **precondition** — the data was not as the operation requires: the record was not there, there
 *   were two, a `check` failed, the policy refused a write. Running it again later may succeed.
 *
 * `step` names where it happened, as a path into the operation (`steps.2.forEach[a].steps.0`), so a
 * failure deep in a loop says which item it was on.
 */
import type { Refusal } from '@we/backend-shared';

export type OperationErrorClass = 'static' | 'precondition';

/** The codes the runner itself raises. A `check` raises one of its operation's own `errors` names. */
export type StaticErrorCode =
  | 'malformed'
  | 'unknownOperation'
  | 'versionMismatch'
  | 'badArgs'
  | 'unboundName'
  | 'unknownEntity'
  | 'outsideOneOf'
  | 'notGranted'
  | 'protectedEntity'
  | 'forEachKey'
  | 'notAList'
  | 'callDepth';

export type PreconditionErrorCode =
  'notFound' | 'ambiguous' | 'alreadyLinked' | 'notLinked' | 'recordExists' | 'expectChanged' | 'refused';

export interface OperationErrorInit {
  class: OperationErrorClass;
  code: string;
  message: string;
  step?: string;
  /** Why the space's policy refused a write, for a `refused` error: a caller may treat a policy it could not read apart from one that said no. */
  refusal?: Refusal;
  /**
   * The error is one of the operation's own `errors`, raised by a `check`, and its message is the
   * declaration's: words written for the person who asked, which a host may show them as they are.
   */
  declared?: boolean;
}

export class OperationError extends Error {
  readonly class: OperationErrorClass;
  readonly code: string;
  readonly step?: string;
  readonly refusal?: Refusal;
  readonly declared?: boolean;

  constructor(init: OperationErrorInit) {
    super(init.message);
    this.name = 'OperationError';
    this.class = init.class;
    this.code = init.code;
    if (init.step !== undefined) this.step = init.step;
    if (init.refusal !== undefined) this.refusal = init.refusal;
    if (init.declared) this.declared = true;
  }
}

/** By name as well as by class, so an error from a second copy of this package still matches. */
export function isOperationError(error: unknown): error is OperationError {
  return error instanceof OperationError || (error instanceof Error && error.name === 'OperationError');
}

export const staticError = (code: StaticErrorCode, message: string, step?: string) =>
  new OperationError({ class: 'static', code, message, step });

export const preconditionError = (code: string, message: string, step?: string) =>
  new OperationError({ class: 'precondition', code, message, step });

/** A `check` that failed: one of the operation's own errors, in its own words. */
export const declaredError = (code: string, message: string, step?: string) =>
  new OperationError({ class: 'precondition', code, message, step, declared: true });
