/**
 * Static checking — the reason to have a grammar at all.
 *
 * `{ $store: 'spaceStore.membrs' }` renders `undefined` in silence. An expression is checked
 * against what the template can actually see: which stores exist and what members they have (from
 * the generated context), which `local` fields the enclosing `$localState`/`$queries` declared,
 * which names `$each` and friends bound, and which functions the library provides. A wrong name is
 * reported with the column it sits at and the nearest right one — the feedback an LLM authoring loop
 * turns into a fix on the next attempt, where "resolved to nothing" turned into a bug report.
 */
import type { Expr, Span } from './ast';
import { CALL_TIME_ROOTS, referencedPaths, walkExpr, WELL_KNOWN_ROOTS } from './ast';
import { arityOf, getFunction, listFunctions } from './functions';

export interface ExpressionScope {
  /** Store names a schema may address. */
  storeNames: ReadonlySet<string>;
  /** Known members per store. A store absent here has an open member set (a module store, say). */
  storeMembers: ReadonlyMap<string, ReadonlySet<string>>;
  /** Fields `local.*` may name, or null when the scope is not knowable (a fragment judged alone). */
  locals: ReadonlySet<string> | null;
  /** Names bound by the enclosing nodes — `$each`'s `as`, `$agent`'s `as` — beyond the well-known set. */
  contextNames: ReadonlySet<string>;
  /**
   * Whether an unknown root is an error. False for a fragment, whose iteration variables and
   * locals are supplied by whatever composes it.
   */
  strict: boolean;
  /** Functions the host registers beyond the built-in library — the `$sources` names. */
  hostFunctions?: ReadonlySet<string>;
}

export interface ExpressionIssue {
  message: string;
  severity: 'error' | 'warning';
  span: Span;
}

const FIELD_READERS = new Set(['error', 'valid', 'touched']);

export function checkExpression(expr: Expr, scope: ExpressionScope): ExpressionIssue[] {
  const issues: ExpressionIssue[] = [];

  for (const { root, path, span } of referencedPaths(expr)) {
    if (root === 'local') {
      if (path.length === 0) {
        issues.push({ message: '"local" is a namespace — name a field: local.<name>', severity: 'error', span });
        continue;
      }
      if (scope.locals === null) continue;
      const [field] = path;
      if (!scope.locals.has(field)) {
        const hint = suggest(field, scope.locals);
        issues.push({
          message: `local.${field} is not declared in $localState or $queries here${hint ? ` — did you mean local.${hint}?` : ''}`,
          severity: 'error',
          span,
        });
      }
      continue;
    }

    // A name the enclosing nodes bound wins over a store of the same name, as it does at runtime —
    // `$each … as: 'model'` over the AI models makes `model.isDefault` the row's field, not a
    // member of the `model` pseudo-store.
    if (scope.contextNames.has(root)) continue;

    if (scope.storeNames.has(root)) {
      if (path.length === 0) {
        issues.push({
          message: `"${root}" is a store, not a value — name a member: ${root}.<member>`,
          severity: 'error',
          span,
        });
        continue;
      }
      const members = scope.storeMembers.get(root);
      if (members && !members.has(path[0])) {
        const hint = suggest(path[0], members);
        issues.push({
          message: `Unknown member "${path[0]}" on ${root}${hint ? ` — did you mean ${root}.${hint}?` : ''}`,
          severity: 'warning',
          span,
        });
      }
      continue;
    }

    if (WELL_KNOWN_ROOTS.has(root) || scope.contextNames.has(root)) continue;

    // A name spelled like a store is a store, whatever composes the fragment: nothing binds a
    // `fooStore` through `as`, so an unknown one is wrong even where other roots are unknowable.
    if (/Store$/.test(root)) {
      const hint = suggest(root, scope.storeNames);
      issues.push({
        message: `Unknown store "${root}"${hint ? ` — did you mean "${hint}"?` : ''}`,
        severity: 'error',
        span,
      });
      continue;
    }

    if (scope.strict) {
      const candidates = new Set([...scope.storeNames, ...scope.contextNames, ...WELL_KNOWN_ROOTS]);
      const hint = suggest(root, candidates);
      issues.push({
        message: `Unknown name "${root}"${hint ? ` — did you mean "${hint}"?` : ''}. A reference starts from a store, local, a name bound by $each, or one of ${[...WELL_KNOWN_ROOTS].join(', ')}`,
        severity: 'error',
        span,
      });
    }
  }

  walkExpr(expr, (node) => {
    if (node.kind !== 'call') return;
    // The form-state readers name a field as a string; it has to be one the scope declares.
    if (FIELD_READERS.has(node.callee) && scope.locals !== null) {
      const [field] = node.args;
      if (field?.kind === 'literal' && typeof field.value === 'string' && !scope.locals.has(field.value)) {
        const hint = suggest(field.value, scope.locals);
        issues.push({
          message: `${node.callee}('${field.value}') names a field $localState does not declare here${hint ? ` — did you mean '${hint}'?` : ''}`,
          severity: 'error',
          span: node.span,
        });
      }
    }
    const spec = getFunction(node.callee);
    const given = node.args.length + (node.receiver ? 1 : 0);
    if (!spec) {
      if (scope.hostFunctions?.has(node.callee)) return;
      const hint = suggest(node.callee, [...listFunctions().map((fn) => fn.name), ...(scope.hostFunctions ?? [])]);
      issues.push({
        message: `"${node.callee}" is not a built-in function${hint ? ` — did you mean ${hint}()?` : ''}${
          scope.hostFunctions ? '' : '. It must be one the host registers as a source'
        }`,
        severity: scope.hostFunctions ? 'error' : 'warning',
        span: node.span,
      });
      return;
    }
    const [min, max] = arityOf(spec);
    if (given < min || given > max) {
      const expected = max === Infinity ? `at least ${min}` : min === max ? `${min}` : `${min}–${max}`;
      issues.push({
        message: `${spec.name}(${spec.params.join(', ')}) takes ${expected} argument${min === 1 && max === 1 ? '' : 's'}, given ${given}`,
        severity: 'error',
        span: node.span,
      });
    }
  });

  return issues;
}

/** Whether the expression reads a name that only exists once a callback has fired. */
export function isCallTime(expr: Expr): boolean {
  for (const { root } of referencedPaths(expr)) if (CALL_TIME_ROOTS.has(root)) return true;
  return false;
}

function levenshtein(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] =
        a[i - 1] === b[j - 1] ? rows[i - 1][j - 1] : 1 + Math.min(rows[i - 1][j], rows[i][j - 1], rows[i - 1][j - 1]);
    }
  }
  return rows[a.length][b.length];
}

/** The nearest known name within an edit distance of three, or undefined. */
export function suggest(name: string, known: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = 4;
  for (const candidate of known) {
    const distance = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}
