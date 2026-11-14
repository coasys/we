/**
 * The recorder: run every case through the real implementation and write `vectors/*.json`.
 *
 * Everything except `navigation.json` is recorded here — navigation needs the mounted RouteStore
 * over a jsdom history, which is a vitest-solid-project job: `pnpm record` runs this file and then
 * `tests/record-navigation.test.tsx`. `style.json` additionally needs the browser-recorded token
 * tables (`pnpm record:tokens` first); a missing table records the case with the `var()` text left
 * unresolved rather than failing, so a partial regeneration stays possible.
 *
 * Output is one JSON object per file, `JSON.stringify(obj, null, 2)` — deterministic because the
 * cases are ordered arrays and `encode` preserves authored key order.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hostSourceBag } from '../../../app-shell/src/shared/sources/index.ts';
import {
  evaluateExpression,
  isRelativePath,
  parseExpression,
  printExpression,
  resolvePath,
} from '../../shared/src/index.ts';
import { getFunction } from '../../shared/src/index.ts';
import { pruneUnresolvedWhere, resolveQueryProp, scopeIsAnchored } from '../../shared/src/index.ts';
import { EXPRESSION_CASES, EXPRESSION_ENVS } from './cases/expressions';
import { FUNCTION_CASES } from './cases/functions';
import { HOST_FUNCTION_CASES } from './cases/hostFunctions';
import { PATH_CASES } from './cases/paths';
import { QUERY_CASES } from './cases/queryCompile';
import { STYLE_CASES } from './cases/style';
import { decodeValue, encodeValue } from './encode';
import { envFor } from './evalEnv';
import { resolveStyleCase, type TokenTable } from './styleResolve';

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(HERE, '..', 'vectors');

function write(name: string, data: unknown): void {
  writeFileSync(join(VECTORS, name), JSON.stringify(data, null, 2) + '\n');
  console.info(`wrote vectors/${name}`);
}

function tokenTable(theme: string): TokenTable {
  try {
    const file = JSON.parse(readFileSync(join(VECTORS, 'tokens', `${theme}.json`), 'utf8')) as {
      vars: TokenTable;
    };
    return file.vars;
  } catch {
    console.warn(`tokens/${theme}.json missing — var() values recorded unresolved (run record:tokens)`);
    return {};
  }
}

/** `note` for cases that do not author one — what the id pins, for the reader and the failure. */
const EXPR_NOTES: [RegExp, string][] = [
  [/^print\./, 'the printer: parse(source) → printExpression reproduces this string'],
  [/^op\./, 'an operator or grammar rule, pinned against a stub env'],
  [/^eval\./, 'evaluation over the named env'],
  [/^bundle\./, 'an expression lifted verbatim from bundles/coasys.bundle.json, over the stock env'],
];
const noteFor = (id: string, table: [RegExp, string][], fallback: string) =>
  table.find(([re]) => re.test(id))?.[1] ?? fallback;

export function recordExpressions() {
  return {
    version: 1,
    envs: EXPRESSION_ENVS,
    cases: EXPRESSION_CASES.map((c) => {
      const env = envFor(c.env ? EXPRESSION_ENVS[c.env] : {});
      const base = {
        id: c.id,
        note: noteFor(c.id, EXPR_NOTES, `expression case ${c.id}`),
        source: c.source,
        ...(c.env ? { env: c.env } : {}),
      };
      let ast;
      try {
        ast = parseExpression(c.source);
      } catch (error) {
        const e = error as Error & { span?: number[] };
        return { ...base, error: 'syntax', message: e.message, span: e.span ?? null };
      }
      return {
        ...base,
        result: encodeValue(evaluateExpression(ast, env)),
        print: printExpression(ast),
      };
    }),
  };
}

export function recordFunctions() {
  return {
    version: 1,
    cases: FUNCTION_CASES.map((c) => {
      const spec = getFunction(c.name);
      const args = c.args.map(decodeValue);
      const context = (c.context ? decodeValue(c.context) : {}) as Record<string, unknown>;
      let result: unknown;
      try {
        result = spec ? spec.impl(args, { context, stores: {} }) : undefined;
      } catch (error) {
        result = { $error: String((error as Error).message) };
      }
      return {
        id: c.id,
        note: `the ${c.name} built-in${c.context ? ' with $localMeta context' : ''}`,
        fn: c.name,
        args: c.args,
        ...(c.context ? { context: c.context } : {}),
        result: encodeValue(result),
      };
    }),
  };
}

export function recordPaths() {
  return {
    version: 1,
    cases: PATH_CASES.map((c) => ({
      id: c.id,
      note: `resolvePath(${JSON.stringify(c.to)}) and isRelativePath on the same input`,
      to: c.to,
      current: c.current,
      base: c.base,
      result: resolvePath(c.to, c.current, c.base),
      relative: isRelativePath(c.to.trim()),
    })),
  };
}

export function recordQueryCompile() {
  return {
    version: 1,
    cases: QUERY_CASES.map((c) => {
      switch (c.op) {
        case 'query':
          return {
            id: c.id,
            note: 'resolveQueryProp: a $query object becomes a query descriptor',
            op: c.op,
            query: c.query,
            descriptor: encodeValue(resolveQueryProp({ $query: decodeValue(c.query!) })),
          };
        case 'where':
          return {
            id: c.id,
            note: 'pruneUnresolvedWhere: unresolved holes widen, they never narrow',
            op: c.op,
            where: c.where,
            pruned: encodeValue(pruneUnresolvedWhere(decodeValue(c.where!) as Record<string, unknown>)),
          };
        case 'scope':
          return {
            id: c.id,
            note: 'scopeIsAnchored: absent/empty anchor widens; an empty anchor list is still anchored',
            op: c.op,
            scope: c.scope,
            anchored: encodeValue(scopeIsAnchored(decodeValue(c.scope!))),
          };
      }
    }),
  };
}

export function recordHostFunctions() {
  const bag = hostSourceBag();
  return {
    version: 1,
    cases: HOST_FUNCTION_CASES.map((c) => {
      const fn = bag[c.name];
      let result: unknown;
      try {
        result = fn ? fn(decodeValue(c.options)) : undefined;
      } catch (error) {
        result = { $error: String((error as Error).message) };
      }
      return {
        id: c.id,
        note: `the ${c.name} host source`,
        fn: c.name,
        options: c.options,
        result: encodeValue(result),
      };
    }),
  };
}

export function recordStyle() {
  return {
    version: 1,
    cases: STYLE_CASES.map((c) => {
      const vars = tokenTable(c.theme);
      const { style, resolved } = resolveStyleCase(c.props, c.direction ?? 'row', vars);
      return {
        id: c.id,
        note: styleNote(c),
        props: c.props,
        theme: c.theme,
        direction: c.direction ?? 'row',
        style: encodeValue(style),
        resolved: encodeValue(resolved),
      };
    }),
  };
}

function styleNote(c: { id: string; theme: string }): string {
  if (c.id.startsWith('token.')) return `a bundle token value resolved under the ${c.theme} theme`;
  if (c.id.startsWith('var.')) return `a bundle-authored raw var() passthrough, resolved under the ${c.theme} theme`;
  if (c.id.startsWith('combo.')) return `a multi-prop interaction under the ${c.theme} theme`;
  return 'a raw CSS value; var()s substituted from the dark token table';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  write('expressions.json', recordExpressions());
  write('functions.json', recordFunctions());
  write('paths.json', recordPaths());
  write('query-compile.json', recordQueryCompile());
  write('host-functions.json', recordHostFunctions());
  write('style.json', recordStyle());
}
