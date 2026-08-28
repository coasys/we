/**
 * A Pratt parser for the expression language. See `ast.ts` for what the grammar is and why it is
 * closed.
 *
 * Precedence, loosest first: `?:` · `??` · `||` · `&&` · `== !=` · `< > <= >= in` · `+ -` · `* / %`
 * · unary `! -` · postfix `.name` `[i]` `(args)`. The same table JavaScript uses for the same
 * symbols, so nothing here surprises anyone who has written a condition before.
 */
import type { BinaryOp, Expr, LogicalOp, MacroName, Span } from './ast';
import { DENIED_PROPERTIES, MACRO_NAMES } from './ast';
import { ExpressionSyntaxError, type Token, tokenize } from './lexer';

/** Deeper than any real expression; a bound on a hostile one. */
const MAX_DEPTH = 40;

const BINARY_PRECEDENCE: Record<string, number> = {
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
};

const LOGICAL_OPS = new Set<string>(['&&', '||', '??']);

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly offset: number,
  ) {}

  parse(): Expr {
    const expr = this.expression();
    if (this.peek().kind !== 'eof') {
      const token = this.peek();
      throw new ExpressionSyntaxError(`Unexpected "${token.value}"`, this.absolute(token.span));
    }
    return expr;
  }

  private absolute(span: Span): Span {
    return [span[0] + this.offset, span[1] + this.offset];
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private isPunct(value: string): boolean {
    const token = this.peek();
    return token.kind === 'punct' && token.value === value;
  }

  private expect(value: string): Token {
    if (!this.isPunct(value)) {
      const token = this.peek();
      const found = token.kind === 'eof' ? 'end of expression' : `"${token.value}"`;
      throw new ExpressionSyntaxError(`Expected "${value}" but found ${found}`, this.absolute(token.span));
    }
    return this.next();
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) {
      throw new ExpressionSyntaxError('Expression is nested too deeply', this.absolute(this.peek().span));
    }
  }

  private leave(): void {
    this.depth--;
  }

  private expression(): Expr {
    this.enter();
    const test = this.binary(1);
    if (this.isPunct('?')) {
      this.next();
      const consequent = this.expression();
      this.expect(':');
      const alternate = this.expression();
      this.leave();
      return { kind: 'conditional', test, consequent, alternate, span: [test.span[0], alternate.span[1]] };
    }
    this.leave();
    return test;
  }

  private binary(minPrecedence: number): Expr {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'punct') break;
      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      this.next();
      const right = this.binary(precedence + 1);
      const span: Span = [left.span[0], right.span[1]];
      left = LOGICAL_OPS.has(token.value)
        ? { kind: 'logical', op: token.value as LogicalOp, left, right, span }
        : { kind: 'binary', op: token.value as BinaryOp, left, right, span };
    }
    return left;
  }

  private unary(): Expr {
    if (this.isPunct('!') || this.isPunct('-')) {
      const token = this.next();
      this.enter();
      const operand = this.unary();
      this.leave();
      return {
        kind: 'unary',
        op: token.value as '!' | '-',
        operand,
        span: [this.absolute(token.span)[0], operand.span[1]],
      };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let expr = this.primary();
    for (;;) {
      if (this.isPunct('.')) {
        this.next();
        const name = this.next();
        if (name.kind !== 'ident' && !(name.kind === 'punct' && /^[a-z]+$/.test(name.value))) {
          throw new ExpressionSyntaxError('Expected a property name after "."', this.absolute(name.span));
        }
        this.refuseDenied(name);
        if (this.isPunct('(')) {
          expr = this.call(name.value, expr, expr.span[0]);
          continue;
        }
        expr = {
          kind: 'member',
          object: expr,
          property: name.value,
          span: [expr.span[0], this.absolute(name.span)[1]],
        };
        continue;
      }
      if (this.isPunct('[')) {
        this.next();
        const index = this.expression();
        const close = this.expect(']');
        if (index.kind === 'literal' && typeof index.value === 'string' && DENIED_PROPERTIES.has(index.value)) {
          throw new ExpressionSyntaxError(`"${index.value}" is not a readable property`, index.span);
        }
        expr = { kind: 'index', object: expr, index, span: [expr.span[0], this.absolute(close.span)[1]] };
        continue;
      }
      if (this.isPunct('(') && expr.kind === 'ident') {
        expr = this.call(expr.name, undefined, expr.span[0]);
        continue;
      }
      break;
    }
    return expr;
  }

  private refuseDenied(name: Token): void {
    if (DENIED_PROPERTIES.has(name.value)) {
      throw new ExpressionSyntaxError(`"${name.value}" is not a readable property`, this.absolute(name.span));
    }
  }

  /**
   * `f(a, b)` or `receiver.f(a, b)`. A macro is recognised by its name *and* its shape — a bare
   * identifier then a comma — so `items.filter({ role: 'admin' })` is still the library call with a
   * where-object, and `items.filter(x, x.role == 'admin')` is the comprehension.
   */
  private call(callee: string, receiver: Expr | undefined, start: number): Expr {
    this.expect('(');
    this.enter();

    const isMacroShape =
      receiver !== undefined &&
      (MACRO_NAMES as readonly string[]).includes(callee) &&
      this.peek().kind === 'ident' &&
      this.tokens[this.pos + 1]?.kind === 'punct' &&
      this.tokens[this.pos + 1]?.value === ',';

    if (isMacroShape) {
      const variable = this.next();
      this.expect(',');
      const body = this.expression();
      const close = this.expect(')');
      this.leave();
      return {
        kind: 'macro',
        name: callee as MacroName,
        receiver: receiver!,
        variable: variable.value,
        body,
        span: [start, this.absolute(close.span)[1]],
      };
    }

    const args: Expr[] = [];
    if (!this.isPunct(')')) {
      for (;;) {
        args.push(this.expression());
        if (this.isPunct(',')) {
          this.next();
          if (this.isPunct(')')) break;
          continue;
        }
        break;
      }
    }
    const close = this.expect(')');
    this.leave();
    return { kind: 'call', callee, receiver, args, span: [start, this.absolute(close.span)[1]] };
  }

  private primary(): Expr {
    const token = this.next();
    const span = this.absolute(token.span);

    switch (token.kind) {
      case 'number':
        return { kind: 'literal', value: Number(token.value), span };
      case 'string':
        return { kind: 'literal', value: token.value, span };
      case 'template': {
        const parts: (string | Expr)[] = [];
        for (const part of token.template!.parts) {
          if (typeof part === 'string') {
            parts.push(part);
          } else {
            parts.push(parseExpression(part.source, part.start + this.offset));
          }
        }
        return { kind: 'template', parts, span };
      }
      case 'ident':
        return { kind: 'ident', name: token.value, span };
      case 'punct':
        switch (token.value) {
          case 'true':
            return { kind: 'literal', value: true, span };
          case 'false':
            return { kind: 'literal', value: false, span };
          case 'null':
            return { kind: 'literal', value: null, span };
          case '(': {
            this.enter();
            const inner = this.expression();
            this.leave();
            this.expect(')');
            return inner;
          }
          case '[':
            return this.list(span[0]);
          case '{':
            return this.object(span[0]);
          default:
            break;
        }
        throw new ExpressionSyntaxError(`Unexpected "${token.value}"`, span);
      case 'eof':
        throw new ExpressionSyntaxError('Unexpected end of expression', span);
      default:
        throw new ExpressionSyntaxError(`Unexpected "${token.value}"`, span);
    }
  }

  private list(start: number): Expr {
    this.enter();
    const elements: Expr[] = [];
    if (!this.isPunct(']')) {
      for (;;) {
        elements.push(this.expression());
        if (this.isPunct(',')) {
          this.next();
          if (this.isPunct(']')) break;
          continue;
        }
        break;
      }
    }
    const close = this.expect(']');
    this.leave();
    return { kind: 'list', elements, span: [start, this.absolute(close.span)[1]] };
  }

  private object(start: number): Expr {
    this.enter();
    const entries: { key: string; value: Expr }[] = [];
    if (!this.isPunct('}')) {
      for (;;) {
        const keyToken = this.next();
        if (
          keyToken.kind !== 'ident' &&
          keyToken.kind !== 'string' &&
          !(keyToken.kind === 'punct' && /^[a-z]+$/.test(keyToken.value))
        ) {
          throw new ExpressionSyntaxError('Expected a property name', this.absolute(keyToken.span));
        }
        this.refuseDenied(keyToken);
        this.expect(':');
        const value = this.expression();
        entries.push({ key: keyToken.value, value });
        if (this.isPunct(',')) {
          this.next();
          if (this.isPunct('}')) break;
          continue;
        }
        break;
      }
    }
    const close = this.expect('}');
    this.leave();
    return { kind: 'object', entries, span: [start, this.absolute(close.span)[1]] };
  }
}

/**
 * Parse one expression. Throws `ExpressionSyntaxError` with the span of the offending token.
 *
 * `offset` is where this source sits inside a larger one — a template-literal hole — so spans stay
 * absolute to the string the author wrote.
 */
export function parseExpression(source: string, offset = 0): Expr {
  const tokens = tokenize(source);
  return new Parser(tokens, offset).parse();
}

export { ExpressionSyntaxError };
