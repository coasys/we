/**
 * The evaluation environment a case's `env` decodes to, matching `makeEvalEnv` in
 * propResolvers/expression.ts: roots answer `{ bound, value }` and `call` dispatches to the
 * built-in registry first and the host's `$sources` bag second, with source functions taking the
 * first argument as their options object. Errors are swallowed to `undefined` the same way —
 * totality is the contract.
 */
import { hostSourceBag } from '../../../app-shell/src/shared/sources/index.ts';
import { type EvaluationEnv, getFunction } from '../../shared/src/index.ts';
import { decodeValue, type EncodedValue } from './encode';

export function envFor(roots: Record<string, EncodedValue>): EvaluationEnv {
  const decoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(roots)) decoded[k] = decodeValue(v);
  const sources = hostSourceBag();
  return {
    root: (name) => (name in decoded ? { bound: true, value: decoded[name] } : { bound: false, value: undefined }),
    call: (name, args) => {
      const builtin = getFunction(name);
      if (builtin) {
        try {
          return builtin.impl(args, { context: {}, stores: {} });
        } catch {
          return undefined;
        }
      }
      const source = sources[name];
      if (source) {
        try {
          return source(args[0]);
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
  };
}
