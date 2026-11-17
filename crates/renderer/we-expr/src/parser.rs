//! The parser — a Pratt parser mirroring `parser.ts`: `?:` over a binary
//! ladder (`??` 1, `||` 2, `&&` 3, `==`/`!=` 4, `<`/`>`/`<=`/`>=`/`in` 5,
//! `+`/`-` 6, `*`/`/`/`%` 7), unary, then postfix member/index/call. The
//! `depth` counter matches `enter()`/`leave()` exactly — `(` and the
//! containers count twice — so the nesting error lands on the same token.
use crate::ast::*;
use crate::lexer::{tokenize, TemplatePart, Token, TokenKind};
use crate::{Expr, Span, SyntaxError};

/// `MAX_DEPTH` — deeper than any real expression; a bound on a hostile one.
const MAX_DEPTH: usize = 40;

struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
    offset: usize,
    depth: usize,
}

impl Parser<'_> {
    fn parse(&mut self) -> Result<Node, SyntaxError> {
        let expr = self.expression()?;
        let token = self.peek();
        if !matches!(token.kind, TokenKind::Eof) {
            let span = token.span;
            return Err(self.err(format!("Unexpected \"{}\"", token_value(token)), span));
        }
        Ok(expr)
    }

    fn peek(&self) -> &Token {
        self.tokens
            .get(self.pos)
            .unwrap_or_else(|| self.tokens.last().expect("tokenize always emits EOF"))
    }

    fn at(&self, offset: usize) -> Option<&Token> {
        self.tokens.get(self.pos + offset)
    }

    fn next(&mut self) -> Token {
        let token = self.peek().clone();
        self.pos += 1;
        token
    }

    fn is_punct(&self, value: &str) -> bool {
        matches!(&self.peek().kind, TokenKind::Punct(p) if p == value)
    }

    fn expect(&mut self, value: &str) -> Result<Span, SyntaxError> {
        if !self.is_punct(value) {
            let token = self.peek().clone();
            let found = match &token.kind {
                TokenKind::Eof => "end of expression".to_string(),
                _ => format!("\"{}\"", token_value(&token)),
            };
            return Err(self.err(
                format!("Expected \"{value}\" but found {found}"),
                token.span,
            ));
        }
        Ok(self.next().span)
    }

    fn err(&self, message: impl Into<String>, span: Span) -> SyntaxError {
        SyntaxError::new_raw(message, (span.0 + self.offset, span.1 + self.offset))
    }

    fn enter(&mut self) -> Result<(), SyntaxError> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            let span = self.peek().span;
            return Err(self.err("Expression is nested too deeply", span));
        }
        Ok(())
    }

    fn leave(&mut self) {
        self.depth -= 1;
    }

    /// `expression()` in `parser.ts`: `?:` over the binary ladder, with
    /// `enter()`/`leave()` around the whole level.
    fn expression(&mut self) -> Result<Node, SyntaxError> {
        self.enter()?;
        let test = self.binary(1)?;
        if self.is_punct("?") {
            self.next();
            let consequent = self.expression()?;
            self.expect(":")?;
            let alternate = self.expression()?;
            self.leave();
            return Ok(Node::Conditional {
                test: Box::new(test),
                consequent: Box::new(consequent),
                alternate: Box::new(alternate),
            });
        }
        self.leave();
        Ok(test)
    }

    /// The binary ladder — left-associative, `??` loosest at precedence 1.
    fn binary(&mut self, min_precedence: u8) -> Result<Node, SyntaxError> {
        let mut left = self.unary()?;
        loop {
            let token = self.peek();
            let TokenKind::Punct(value) = &token.kind else {
                break;
            };
            let precedence = match value.as_str() {
                "??" => 1,
                "||" => 2,
                "&&" => 3,
                "==" | "!=" => 4,
                "<" | ">" | "<=" | ">=" | "in" => 5,
                "+" | "-" => 6,
                "*" | "/" | "%" => 7,
                _ => break,
            };
            if precedence < min_precedence {
                break;
            }
            let op = value.clone();
            self.next();
            let right = self.binary(precedence + 1)?;
            left = match op.as_str() {
                "&&" => Node::Logical {
                    op: LogicalOp::And,
                    left: Box::new(left),
                    right: Box::new(right),
                },
                "||" => Node::Logical {
                    op: LogicalOp::Or,
                    left: Box::new(left),
                    right: Box::new(right),
                },
                "??" => Node::Logical {
                    op: LogicalOp::Nullish,
                    left: Box::new(left),
                    right: Box::new(right),
                },
                _ => Node::Binary {
                    op: match op.as_str() {
                        "==" => BinaryOp::Eq,
                        "!=" => BinaryOp::Ne,
                        "<" => BinaryOp::Lt,
                        ">" => BinaryOp::Gt,
                        "<=" => BinaryOp::Le,
                        ">=" => BinaryOp::Ge,
                        "in" => BinaryOp::In,
                        "+" => BinaryOp::Add,
                        "-" => BinaryOp::Sub,
                        "*" => BinaryOp::Mul,
                        "/" => BinaryOp::Div,
                        "%" => BinaryOp::Mod,
                        _ => unreachable!(),
                    },
                    left: Box::new(left),
                    right: Box::new(right),
                },
            };
        }
        Ok(left)
    }

    fn unary(&mut self) -> Result<Node, SyntaxError> {
        if self.is_punct("!") || self.is_punct("-") {
            let token = self.next();
            let op = if token_value(&token) == "!" {
                UnaryOp::Not
            } else {
                UnaryOp::Neg
            };
            self.enter()?;
            let operand = self.unary()?;
            self.leave();
            return Ok(Node::Unary {
                op,
                operand: Box::new(operand),
            });
        }
        self.postfix()
    }

    /// `.name` members, `[expr]` indexes, `ident(args)` calls and
    /// `recv.name(args)`/`recv.macro(var, body)` — chained without limit.
    fn postfix(&mut self) -> Result<Node, SyntaxError> {
        let mut expr = self.primary()?;
        loop {
            if self.is_punct(".") {
                self.next();
                let name = self.next();
                let ok = match &name.kind {
                    TokenKind::Ident(_) => true,
                    // A keyword spelled like a lowercase word (`a.in`) still
                    // reads as a member name.
                    TokenKind::Punct(p) => p.chars().all(|c| c.is_ascii_lowercase()),
                    _ => false,
                };
                if !ok {
                    return Err(self.err("Expected a property name after \".\"", name.span));
                }
                self.refuse_denied(&name)?;
                let property = token_value(&name);
                if self.is_punct("(") {
                    expr = self.call(property, Some(expr))?;
                    continue;
                }
                expr = Node::Member {
                    object: Box::new(expr),
                    property,
                };
                continue;
            }
            if self.is_punct("[") {
                self.next();
                let index_start = self.peek().span.0;
                let index = self.expression()?;
                let index_end = self.tokens[self.pos - 1].span.1;
                self.expect("]")?;
                if let Node::Literal(Literal::Str(key)) = &index {
                    if crate::DENIED_PROPERTIES.contains(&key.as_str()) {
                        // The error names the literal's own span.
                        return Err(self.err(
                            format!("\"{key}\" is not a readable property"),
                            (index_start, index_end),
                        ));
                    }
                }
                expr = Node::Index {
                    object: Box::new(expr),
                    index: Box::new(index),
                };
                continue;
            }
            if self.is_punct("(") {
                if let Node::Ident(callee) = expr {
                    expr = self.call(callee, None)?;
                    continue;
                }
            }
            break;
        }
        Ok(expr)
    }

    fn refuse_denied(&self, name: &Token) -> Result<(), SyntaxError> {
        let value = token_value(name);
        if crate::DENIED_PROPERTIES.contains(&value.as_str()) {
            return Err(self.err(format!("\"{value}\" is not a readable property"), name.span));
        }
        Ok(())
    }

    /// `f(a, b)` or `receiver.f(a, b)`. A macro is recognised by its name
    /// *and* its shape — a bare identifier then a comma — so
    /// `items.filter({ role: 'admin' })` is still the library call with a
    /// where-object, and `items.filter(x, x.role == 'admin')` is the
    /// comprehension.
    fn call(&mut self, callee: String, receiver: Option<Node>) -> Result<Node, SyntaxError> {
        self.expect("(")?;
        self.enter()?;

        let is_macro_shape = receiver.is_some()
            && MacroName::from_str(&callee).is_some()
            && matches!(self.peek().kind, TokenKind::Ident(_))
            && self
                .at(1)
                .is_some_and(|t| matches!(&t.kind, TokenKind::Punct(p) if p == ","));

        if is_macro_shape {
            let name = MacroName::from_str(&callee).unwrap();
            let variable = token_value(&self.next());
            self.expect(",")?;
            let body = self.expression()?;
            self.expect(")")?;
            self.leave();
            return Ok(Node::Macro {
                name,
                receiver: Box::new(receiver.unwrap()),
                variable,
                body: Box::new(body),
            });
        }

        let mut args = Vec::new();
        if !self.is_punct(")") {
            loop {
                args.push(self.expression()?);
                if self.is_punct(",") {
                    self.next();
                    if self.is_punct(")") {
                        break;
                    }
                    continue;
                }
                break;
            }
        }
        self.expect(")")?;
        self.leave();
        Ok(Node::Call {
            callee,
            receiver: receiver.map(Box::new),
            args,
        })
    }

    fn primary(&mut self) -> Result<Node, SyntaxError> {
        let token = self.next();
        match &token.kind {
            TokenKind::Number(text) => Ok(Node::Literal(Literal::Num(
                crate::value::js_number_str(text),
            ))),
            TokenKind::Str(text) => Ok(Node::Literal(Literal::Str(text.clone()))),
            TokenKind::Template(parts) => {
                let mut nodes = Vec::new();
                for part in parts {
                    match part {
                        TemplatePart::Text(t) => nodes.push(TemplateNode::Text(t.clone())),
                        TemplatePart::Hole { source, start } => {
                            nodes.push(TemplateNode::Hole(Box::new(parse_node_at(
                                source,
                                start + self.offset,
                            )?)));
                        }
                    }
                }
                Ok(Node::Template(nodes))
            }
            TokenKind::Ident(name) => Ok(Node::Ident(name.clone())),
            TokenKind::Punct(value) => match value.as_str() {
                "true" => Ok(Node::Literal(Literal::Bool(true))),
                "false" => Ok(Node::Literal(Literal::Bool(false))),
                "null" => Ok(Node::Literal(Literal::Null)),
                "(" => {
                    self.enter()?;
                    let inner = self.expression()?;
                    self.leave();
                    self.expect(")")?;
                    Ok(inner)
                }
                "[" => self.list(),
                "{" => self.object(),
                _ => Err(self.err(format!("Unexpected \"{value}\""), token.span)),
            },
            TokenKind::Eof => Err(self.err("Unexpected end of expression", token.span)),
        }
    }

    fn list(&mut self) -> Result<Node, SyntaxError> {
        self.enter()?;
        let mut elements = Vec::new();
        if !self.is_punct("]") {
            loop {
                elements.push(self.expression()?);
                if self.is_punct(",") {
                    self.next();
                    if self.is_punct("]") {
                        break;
                    }
                    continue;
                }
                break;
            }
        }
        self.expect("]")?;
        self.leave();
        Ok(Node::List(elements))
    }

    fn object(&mut self) -> Result<Node, SyntaxError> {
        self.enter()?;
        let mut entries = Vec::new();
        if !self.is_punct("}") {
            loop {
                let key_token = self.next();
                let ok = match &key_token.kind {
                    TokenKind::Ident(_) | TokenKind::Str(_) => true,
                    TokenKind::Punct(p) => p.chars().all(|c| c.is_ascii_lowercase()),
                    _ => false,
                };
                if !ok {
                    return Err(self.err("Expected a property name", key_token.span));
                }
                self.refuse_denied(&key_token)?;
                self.expect(":")?;
                let value = self.expression()?;
                entries.push((token_value(&key_token), value));
                if self.is_punct(",") {
                    self.next();
                    if self.is_punct("}") {
                        break;
                    }
                    continue;
                }
                break;
            }
        }
        self.expect("}")?;
        self.leave();
        Ok(Node::Object(entries))
    }
}

/// A token's text — the decoded value for literals, the word otherwise.
fn token_value(token: &Token) -> String {
    match &token.kind {
        TokenKind::Number(t) | TokenKind::Str(t) | TokenKind::Ident(t) | TokenKind::Punct(t) => {
            t.clone()
        }
        TokenKind::Template(_) => "`template`".to_string(),
        TokenKind::Eof => "end of expression".to_string(),
    }
}

/// Parse `source` — `offset` shifts every reported span, so a template hole's
/// error lands on its absolute position in the outer source.
fn parse_node_at(source: &str, offset: usize) -> Result<Node, SyntaxError> {
    let tokens = match tokenize(source) {
        Ok(tokens) => tokens,
        Err(err) => return Err(err.shift(offset)),
    };
    let mut parser = Parser {
        tokens: &tokens,
        pos: 0,
        offset,
        depth: 0,
    };
    parser.parse()
}

/// The public entry — wraps `Node` in `Expr`.
pub(crate) fn parse_node(source: &str) -> Result<Expr, SyntaxError> {
    Ok(Expr {
        root: parse_node_at(source, 0)?,
    })
}
