/**
 * The form-state readers — `error()`, `valid()`, `touched()`, `formValid()` — as expression
 * functions this host registers.
 *
 * They are not the expression language's core: what they answer is the renderer's form state, the
 * `$localMeta` a drawn `$localState` scope carries, which exists only where a template is rendered.
 * An expression that must mean the same on every host (one checked with `functions: 'core'`) cannot
 * call them, and that is the point of keeping them out of the core library.
 *
 * Registered by a call rather than as a side effect of importing this file: this package declares
 * no side effects, so a bundler is entitled to drop an import that binds nothing. The two places
 * that need the readers — the handlers that write the same state, and the validator that checks
 * calls against the registry — each call `defineFormFunctions()`, and the second call is a no-op.
 */
import { defineFunction } from '@we/expressions';

import type { LocalMetaMap } from './propResolvers/local';

let defined = false;

const meta = (context: Record<string, unknown>) => context.$localMeta as LocalMetaMap | undefined;
const fieldName = (value: unknown): string => (typeof value === 'string' ? value : '');

export function defineFormFunctions(): void {
  if (defined) return;
  defined = true;

  defineFunction({
    name: 'error',
    category: 'form',
    params: ['field'],
    namesLocal: true,
    doc: "A field's first validation message, once it has been touched; empty otherwise. The field is named as a string.",
    example: "error('email')",
    impl: ([field], env) => {
      const entry = meta(env.context)?.[fieldName(field)];
      return entry && entry.touched() ? (entry.errors()[0] ?? '') : '';
    },
  });

  defineFunction({
    name: 'valid',
    category: 'form',
    params: ['field'],
    namesLocal: true,
    doc: 'Whether every validation rule on the field passes, touched or not. True for a field with no rules.',
    example: "valid('email')",
    impl: ([field], env) => {
      const entry = meta(env.context)?.[fieldName(field)];
      return entry ? entry.errors().length === 0 : true;
    },
  });

  defineFunction({
    name: 'touched',
    category: 'form',
    params: ['field'],
    namesLocal: true,
    doc: 'Whether the field has been blurred or marked with $touch.',
    example: "touched('email')",
    impl: ([field], env) => meta(env.context)?.[fieldName(field)]?.touched() ?? false,
  });

  defineFunction({
    name: 'formValid',
    category: 'form',
    params: [],
    doc: 'Whether every validated field in the enclosing $localState scope passes.',
    example: 'formValid()',
    impl: (_args, env) => {
      const map = meta(env.context);
      const fields = env.context.$localScopeFields as string[] | undefined;
      if (!map || !fields) return true;
      return fields.every((name) => (map[name]?.errors().length ?? 0) === 0);
    },
  });
}
