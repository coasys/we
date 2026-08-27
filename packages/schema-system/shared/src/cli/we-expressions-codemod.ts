#!/usr/bin/env node
/**
 * Print every value-operator tree in the repo's own schemas as an expression.
 *
 * `{ $eq: [{ $count: { items: { $store: 'a.b' } } }, 0] }` becomes `{ $: 'count(a.b) == 0' }`. Run
 * once, so the repo's templates are the reference corpus for the new spelling — and so the old one
 * stops being what a new template is copied from.
 *
 * ## What it converts, and what it leaves
 *
 * Only a subtree that is entirely literal in the TypeScript sense: object and array literals,
 * strings, numbers, booleans, null. A subtree holding an identifier, a spread, a call or a template
 * string is a fragment being composed and is left alone — the codemod cannot know what the
 * identifier holds. `operatorToExpr` then decides whether the literal tree is a *value* tree: one
 * with an `$action`, a `$query`, a schema node or a handler array inside it is not, and stays.
 *
 * Leaf references — a lone `{ $store: 'a.b' }` or `{ $local: 'x' }` — are left as they are. Both
 * spellings stay valid, and rewriting six hundred leaves would be churn for no reduction in what an
 * author has to know: the gain is in the trees, where five nested objects become one line.
 *
 * Outermost match wins: a tree is converted whole, not operator by operator.
 *
 *   tsx src/cli/we-expressions-codemod.ts <dir-or-file>…   [--dry]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import ts from 'typescript';

import { operatorToExpr } from '../expressions/convert.js';
import { printExpression, quote } from '../expressions/printer.js';

const VALUE_OPERATORS = new Set([
  '$concat',
  '$if',
  '$map',
  '$pick',
  '$eq',
  '$ne',
  '$lt',
  '$gt',
  '$in',
  '$not',
  '$and',
  '$or',
  '$filter',
  '$count',
  '$find',
  '$plural',
  '$source',
]);

const dry = process.argv.includes('--dry');
const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'target', '.turbo', 'tests'].includes(entry)) continue;
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry))
      out.push(full);
  }
}

/** A TypeScript literal tree as the JSON it denotes, or `undefined` when any part is not literal. */
function literalValue(node: ts.Node): { ok: true; value: unknown } | { ok: false } {
  if (ts.isParenthesizedExpression(node)) return literalValue(node.expression);
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literalValue(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { ok: true, value: node.text };
  if (ts.isNumericLiteral(node)) return { ok: true, value: Number(node.text) };
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return { ok: true, value: -Number(node.operand.text) };
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (ts.isArrayLiteralExpression(node)) {
    const out: unknown[] = [];
    for (const element of node.elements) {
      const inner = literalValue(element);
      if (!inner.ok) return { ok: false };
      out.push(inner.value);
    }
    return { ok: true, value: out };
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) return { ok: false };
      const key = propertyKey(property.name);
      if (key === undefined) return { ok: false };
      const inner = literalValue(property.initializer);
      if (!inner.ok) return { ok: false };
      out[key] = inner.value;
    }
    return { ok: true, value: out };
  }
  return { ok: false };
}

function propertyKey(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function isValueOperatorObject(node: ts.Node): node is ts.ObjectLiteralExpression {
  if (!ts.isObjectLiteralExpression(node) || node.properties.length !== 1) return false;
  const [property] = node.properties;
  if (!ts.isPropertyAssignment(property)) return false;
  const key = propertyKey(property.name);
  return key !== undefined && VALUE_OPERATORS.has(key);
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

function convertFile(file: string): { replacements: number; skipped: number } {
  const source = readFileSync(file, 'utf-8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const replacements: Replacement[] = [];
  let skipped = 0;

  const visit = (node: ts.Node): void => {
    if (isValueOperatorObject(node)) {
      const literal = literalValue(node);
      if (literal.ok) {
        const expr = operatorToExpr(literal.value);
        if (expr) {
          replacements.push({
            start: node.getStart(sourceFile),
            end: node.getEnd(),
            text: `{ $: ${quote(printExpression(expr))} }`,
          });
          return; // outermost wins
        }
      }
      skipped++;
      // Inside an unconvertible tree there may still be a convertible one — a `$count` in an `$if`
      // whose branches are nodes.
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (replacements.length && !dry) {
    let out = source;
    for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, replacement.start) + replacement.text + out.slice(replacement.end);
    }
    writeFileSync(file, out, 'utf-8');
  }
  return { replacements: replacements.length, skipped };
}

const files: string[] = [];
for (const target of targets) {
  const full = resolve(target);
  if (statSync(full).isDirectory()) walk(full, files);
  else files.push(full);
}

let total = 0;
let totalSkipped = 0;
for (const file of files.sort()) {
  const { replacements, skipped } = convertFile(file);
  total += replacements;
  totalSkipped += skipped;
  if (replacements || skipped) {
    console.log(
      `${relative(process.cwd(), file)}: ${replacements} converted${skipped ? `, ${skipped} left (not a value tree)` : ''}`,
    );
  }
}
console.log(
  `\n${total} operator trees ${dry ? 'would be' : ''} printed as expressions; ${totalSkipped} left in place.`,
);
