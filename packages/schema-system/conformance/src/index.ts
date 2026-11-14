/**
 * The conformance surface: load committed vectors, or re-record them in memory for comparison.
 *
 * `loadVectors` reads the committed JSON files — the same files the Rust renderer's crates read
 * (see README.md for the format). `recordAll` re-derives them from the live implementation, which
 * is what `tests/vectors.test.ts` compares against: a committed vector that drifted from the code
 * fails there with the case id.
 *
 * `navigation.json` is the exception: its cases run a mounted RouteStore over jsdom's history, so
 * in-memory recording only exists inside the `solid` vitest project (`tests/navigation.test.tsx`
 * and `tests/record-navigation.test.tsx` call `runNavigationScript` in app-shell directly).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  recordExpressions,
  recordFunctions,
  recordHostFunctions,
  recordPaths,
  recordQueryCompile,
  recordStyle,
} from './record';

export const VECTOR_FILES = [
  'expressions.json',
  'functions.json',
  'paths.json',
  'query-compile.json',
  'host-functions.json',
  'style.json',
  'navigation.json',
] as const;

export const TOKEN_THEMES = ['light', 'dark', 'black', 'retro', 'cyberpunk', 'glow'] as const;

export type VectorFile = (typeof VECTOR_FILES)[number];
export type TokenTheme = (typeof TOKEN_THEMES)[number];

export interface Vectors {
  expressions: unknown;
  functions: unknown;
  paths: unknown;
  'query-compile': unknown;
  'host-functions': unknown;
  style: unknown;
  navigation: unknown;
}

/** Read one committed vector file (or a token table) relative to the vectors directory. */
export function loadVectorFile(vectorsDir: string, name: string): unknown {
  return JSON.parse(readFileSync(join(vectorsDir, name), 'utf8'));
}

export function loadTokenTable(vectorsDir: string, theme: TokenTheme): { theme: string; vars: Record<string, string> } {
  return loadVectorFile(vectorsDir, join('tokens', `${theme}.json`)) as { theme: string; vars: Record<string, string> };
}

/** Everything except navigation — see the module note for why. */
export function recordAll(): Omit<Vectors, 'navigation'> {
  return {
    expressions: recordExpressions(),
    functions: recordFunctions(),
    paths: recordPaths(),
    'query-compile': recordQueryCompile(),
    'host-functions': recordHostFunctions(),
    style: recordStyle(),
  };
}

export { EXPRESSION_CASES, EXPRESSION_ENVS } from './cases/expressions';
export { FUNCTION_CASES } from './cases/functions';
export { HOST_FUNCTION_CASES } from './cases/hostFunctions';
export { NAVIGATION_CASES, type NavigationScriptCase } from './cases/navigation';
export { PATH_CASES } from './cases/paths';
export { QUERY_CASES } from './cases/queryCompile';
export { STYLE_CASES, THEME_NAMES } from './cases/style';
export { decodeValue, encodeValue, type EncodedValue } from './encode';
export { envFor } from './evalEnv';
export { resolveStyleCase, substituteVars, type TokenTable } from './styleResolve';
export { recordStyle } from './record';
