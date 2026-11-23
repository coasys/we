/**
 * Print an expression back to source, canonically.
 *
 * Canonical matters more than pretty: the visual editor parses an expression into a structure,
 * lets somebody edit it, and prints it back — and a print that changed spacing or quoting on every
 * round trip would make every edit a diff. So one spacing, single quotes, and parentheses only
 * where precedence needs them.
 */
import type { Expr, LiteralValue } from './ast';

const PRECEDENCE: Record<string, number> = {
  conditional: 0,
  '??': 1,
  '||': 2,
  '&&': 3,
  '==': 4,
  '!=': 4,
  '<': 5,
  '>': 5,
  '<=': 5,
  '>=': 5,
  in: 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
  unary: 8,
  postfix: 9,
  atom: 10,
};

function precedenceOf(expr: Expr): number {
  switch (expr.kind) {
    case 'conditional':
      return PRECEDENCE.conditional;
    case 'binary':
    case 'logical':
      return PRECEDENCE[expr.op];
    case 'unary':
      return PRECEDENCE.unary;
    case 'member':
    case 'index':
    case 'call':
    case 'macro':
      return PRECEDENCE.postfix;
    default:
      return PRECEDENCE.atom;
  }
}

export function printLiteral(value: LiteralValue): string {
  if (typeof value === 'string') return quote(value);
  if (value === null) return 'null';
  return String(value);
}

/** Single-quoted, with only what must be escaped. */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}'`;
}

const IDENT_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function wrap(child: Expr, parentPrecedence: number, rightAssociativeSide = false): string {
  const own = precedenceOf(child);
  // Equal precedence on the right of a left-associative operator needs parentheses: a - (b - c).
  const needs = rightAssociativeSide ? own <= parentPrecedence : own < parentPrecedence;
  const printed = printExpression(child);
  return needs ? `(${printed})` : printed;
}

export function printExpression(expr: Expr): string {
  switch (expr.kind) {
    case 'literal':
      return printLiteral(expr.value);
    case 'template':
      return (
        '`' +
        expr.parts
          .map((part) =>
            typeof part === 'string'
              ? part.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
              : '${' + printExpression(part) + '}',
          )
          .join('') +
        '`'
      );
    case 'ident':
      return expr.name;
    case 'member':
      return `${wrap(expr.object, PRECEDENCE.postfix)}.${expr.property}`;
    case 'index':
      return `${wrap(expr.object, PRECEDENCE.postfix)}[${printExpression(expr.index)}]`;
    case 'unary':
      return `${expr.op}${wrap(expr.operand, PRECEDENCE.unary)}`;
    case 'binary':
    case 'logical': {
      const precedence = PRECEDENCE[expr.op];
      return `${wrap(expr.left, precedence)} ${expr.op} ${wrap(expr.right, precedence, true)}`;
    }
    case 'conditional':
      return `${wrap(expr.test, PRECEDENCE.conditional + 1)} ? ${printExpression(expr.consequent)} : ${printExpression(expr.alternate)}`;
    case 'call': {
      const args = expr.args.map(printExpression).join(', ');
      return expr.receiver
        ? `${wrap(expr.receiver, PRECEDENCE.postfix)}.${expr.callee}(${args})`
        : `${expr.callee}(${args})`;
    }
    case 'macro':
      return `${wrap(expr.receiver, PRECEDENCE.postfix)}.${expr.name}(${expr.variable}, ${printExpression(expr.body)})`;
    case 'list':
      return `[${expr.elements.map(printExpression).join(', ')}]`;
    case 'object':
      return expr.entries.length === 0
        ? '{}'
        : `{ ${expr.entries
            .map(
              (entry) => `${IDENT_KEY.test(entry.key) ? entry.key : quote(entry.key)}: ${printExpression(entry.value)}`,
            )
            .join(', ')} }`;
    default:
      return '';
  }
}
