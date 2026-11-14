//! The parser: `parse(&str) -> Result<Expr, SyntaxError>` and [`ParseCache`].
//!
//! E0 ships the minimal grammar — literals, names, `.`/`[]` access, `==`,
//! `!=`, `!`, `&&`, `||`, ternary, parentheses, unary `-`. The AST is private
//! on purpose: E1 grows it to the full language (`expressions/ast.ts`) without
//! touching the signatures everything above depends on.
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

/// `[start, end)` offsets into the source string.
pub type Span = (usize, usize);

/// A parsed expression. Opaque: build it with [`parse`], evaluate it with
/// [`crate::eval`], cache it with [`ParseCache`].
#[derive(Debug)]
pub struct Expr {
    pub(crate) root: Node,
}

#[derive(Debug)]
pub(crate) enum Node {
    Literal(Literal),
    Ident(String),
    Member {
        object: Box<Node>,
        property: String,
    },
    Index {
        object: Box<Node>,
        index: Box<Node>,
    },
    Unary {
        op: UnaryOp,
        operand: Box<Node>,
    },
    Binary {
        op: BinaryOp,
        left: Box<Node>,
        right: Box<Node>,
    },
    Logical {
        op: LogicalOp,
        left: Box<Node>,
        right: Box<Node>,
    },
    Conditional {
        test: Box<Node>,
        consequent: Box<Node>,
        alternate: Box<Node>,
    },
}

#[derive(Debug)]
pub(crate) enum Literal {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum UnaryOp {
    Not,
    Neg,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum BinaryOp {
    Eq,
    Ne,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum LogicalOp {
    And,
    Or,
}

/// Why a source string is not an expression, with where it went wrong.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntaxError {
    pub message: String,
    pub span: Span,
}

impl SyntaxError {
    fn new(message: impl Into<String>, span: Span) -> Self {
        Self {
            message: message.into(),
            span,
        }
    }
}

impl fmt::Display for SyntaxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} (at {}..{})", self.message, self.span.0, self.span.1)
    }
}

impl std::error::Error for SyntaxError {}

/// Parse `source` as one expression. E1 keeps this signature and fills in the
/// rest of the grammar.
///
/// ```
/// use we_expr::parse;
/// assert!(parse("a.b == 'x' ? 1 : 2").is_ok());
/// assert!(parse("a ??").is_err());
/// ```
pub fn parse(source: &str) -> Result<Expr, SyntaxError> {
    let tokens = lex(source)?;
    let mut parser = Parser {
        tokens,
        pos: 0,
        end: source.chars().count(),
    };
    let root = parser.expr()?;
    match parser.peek() {
        None => Ok(Expr { root }),
        Some(token) => Err(SyntaxError::new(
            format!("unexpected {}", token.describe()),
            token.span,
        )),
    }
}

/// Parses a source once and keeps the tree by its text — the same memoisation
/// the TS side does in `expressions/index.ts`.
#[derive(Default)]
pub struct ParseCache {
    map: HashMap<Arc<str>, Result<Arc<Expr>, Arc<SyntaxError>>>,
}

impl ParseCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// The parsed `source`, from the cache when it was parsed before —
    /// including a remembered error.
    pub fn parse(&mut self, source: &str) -> Result<Arc<Expr>, Arc<SyntaxError>> {
        if let Some(hit) = self.map.get(source) {
            return hit.clone();
        }
        let parsed = parse(source).map(Arc::new).map_err(Arc::new);
        self.map.insert(source.into(), parsed.clone());
        parsed
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq)]
enum TokenKind {
    Num(f64),
    Str(String),
    Ident(String),
    Dot,
    LParen,
    RParen,
    LBracket,
    RBracket,
    Question,
    Colon,
    Not,
    Minus,
    Eq,
    Ne,
    And,
    Or,
}

#[derive(Debug)]
struct Token {
    kind: TokenKind,
    span: Span,
}

impl Token {
    fn describe(&self) -> String {
        match &self.kind {
            TokenKind::Num(n) => format!("number {n}"),
            TokenKind::Str(s) => format!("string {s:?}"),
            TokenKind::Ident(i) => format!("`{i}`"),
            other => format!("`{other:?}`").to_lowercase(),
        }
    }
}

fn lex(source: &str) -> Result<Vec<Token>, SyntaxError> {
    let chars: Vec<char> = source.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        let two = |a: char, b: char| a == c && chars.get(i + 1) == Some(&b);
        if two('=', '=') {
            tokens.push(Token {
                kind: TokenKind::Eq,
                span: (start, start + 2),
            });
            i += 2;
            continue;
        }
        if two('!', '=') {
            tokens.push(Token {
                kind: TokenKind::Ne,
                span: (start, start + 2),
            });
            i += 2;
            continue;
        }
        if two('&', '&') {
            tokens.push(Token {
                kind: TokenKind::And,
                span: (start, start + 2),
            });
            i += 2;
            continue;
        }
        if two('|', '|') {
            tokens.push(Token {
                kind: TokenKind::Or,
                span: (start, start + 2),
            });
            i += 2;
            continue;
        }
        let kind = match c {
            '.' => TokenKind::Dot,
            '(' => TokenKind::LParen,
            ')' => TokenKind::RParen,
            '[' => TokenKind::LBracket,
            ']' => TokenKind::RBracket,
            '?' => TokenKind::Question,
            ':' => TokenKind::Colon,
            '!' => TokenKind::Not,
            '-' => TokenKind::Minus,
            '\'' | '"' => {
                let (s, end) = lex_string(&chars, i, c)?;
                tokens.push(Token {
                    kind: TokenKind::Str(s),
                    span: (start, end),
                });
                i = end;
                continue;
            }
            c if c.is_ascii_digit()
                || (c == '.' && chars.get(i + 1).is_some_and(|d| d.is_ascii_digit())) =>
            {
                let (n, end) = lex_number(&chars, i)?;
                tokens.push(Token {
                    kind: TokenKind::Num(n),
                    span: (start, end),
                });
                i = end;
                continue;
            }
            c if c.is_alphabetic() || c == '_' || c == '$' => {
                let mut end = i + 1;
                while end < chars.len()
                    && (chars[end].is_alphanumeric() || chars[end] == '_' || chars[end] == '$')
                {
                    end += 1;
                }
                let ident: String = chars[i..end].iter().collect();
                tokens.push(Token {
                    kind: TokenKind::Ident(ident),
                    span: (start, end),
                });
                i = end;
                continue;
            }
            other => {
                return Err(SyntaxError::new(
                    format!("unexpected character {other:?}"),
                    (start, start + 1),
                ));
            }
        };
        tokens.push(Token {
            kind,
            span: (start, start + 1),
        });
        i += 1;
    }
    Ok(tokens)
}

fn lex_string(chars: &[char], start: usize, quote: char) -> Result<(String, usize), SyntaxError> {
    let mut out = String::new();
    let mut i = start + 1;
    while i < chars.len() {
        match chars[i] {
            c if c == quote => return Ok((out, i + 1)),
            '\\' => {
                i += 1;
                let esc = chars
                    .get(i)
                    .ok_or_else(|| SyntaxError::new("unterminated escape", (start, i)))?;
                match esc {
                    'n' => out.push('\n'),
                    'r' => out.push('\r'),
                    't' => out.push('\t'),
                    'b' => out.push('\u{8}'),
                    'f' => out.push('\u{c}'),
                    'v' => out.push('\u{b}'),
                    '0' => out.push('\0'),
                    '\\' | '\'' | '"' | '/' => out.push(*esc),
                    'u' => {
                        let hex: String = chars
                            .get(i + 1..i + 5)
                            .ok_or_else(|| SyntaxError::new("bad \\u escape", (i, i + 1)))?
                            .iter()
                            .collect();
                        let cp = u32::from_str_radix(&hex, 16)
                            .map_err(|_| SyntaxError::new("bad \\u escape", (i, i + 1)))?;
                        out.push(char::from_u32(cp).unwrap_or(char::REPLACEMENT_CHARACTER));
                        i += 4;
                    }
                    other => out.push(*other),
                }
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    Err(SyntaxError::new(
        "unterminated string",
        (start, chars.len()),
    ))
}

fn lex_number(chars: &[char], start: usize) -> Result<(f64, usize), SyntaxError> {
    let mut end = start;
    while end < chars.len()
        && (chars[end].is_ascii_digit()
            || chars[end] == '.'
            || chars[end] == 'e'
            || chars[end] == 'E'
            || ((chars[end] == '+' || chars[end] == '-')
                && (chars[end - 1] == 'e' || chars[end - 1] == 'E')))
    {
        end += 1;
    }
    let text: String = chars[start..end].iter().collect();
    let n: f64 = text
        .parse()
        .map_err(|_| SyntaxError::new(format!("bad number {text:?}"), (start, end)))?;
    Ok((n, end))
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
    /// Input length in chars — the position an end-of-input error reports.
    end: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn next(&mut self) -> Option<TokenKind> {
        let kind = self.tokens.get(self.pos)?.kind.clone();
        self.pos += 1;
        Some(kind)
    }

    fn eat(&mut self, kind: &TokenKind) -> bool {
        if self.peek().is_some_and(|t| &t.kind == kind) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn expect(&mut self, kind: &TokenKind, what: &str) -> Result<(), SyntaxError> {
        if self.eat(kind) {
            return Ok(());
        }
        let span = self.peek().map_or((self.end, self.end), |t| t.span);
        Err(SyntaxError::new(format!("expected {what}"), span))
    }

    fn expr(&mut self) -> Result<Node, SyntaxError> {
        self.ternary()
    }

    fn ternary(&mut self) -> Result<Node, SyntaxError> {
        let test = self.logical()?;
        if self.eat(&TokenKind::Question) {
            let consequent = self.expr()?;
            self.expect(&TokenKind::Colon, "`:` in the ternary")?;
            let alternate = self.expr()?;
            Ok(Node::Conditional {
                test: Box::new(test),
                consequent: Box::new(consequent),
                alternate: Box::new(alternate),
            })
        } else {
            Ok(test)
        }
    }

    fn logical(&mut self) -> Result<Node, SyntaxError> {
        let mut left = self.equality()?;
        loop {
            let op = if self.eat(&TokenKind::And) {
                LogicalOp::And
            } else if self.eat(&TokenKind::Or) {
                LogicalOp::Or
            } else {
                return Ok(left);
            };
            let right = self.equality()?;
            left = Node::Logical {
                op,
                left: Box::new(left),
                right: Box::new(right),
            };
        }
    }

    fn equality(&mut self) -> Result<Node, SyntaxError> {
        let mut left = self.unary()?;
        loop {
            let op = if self.eat(&TokenKind::Eq) {
                BinaryOp::Eq
            } else if self.eat(&TokenKind::Ne) {
                BinaryOp::Ne
            } else {
                return Ok(left);
            };
            let right = self.unary()?;
            left = Node::Binary {
                op,
                left: Box::new(left),
                right: Box::new(right),
            };
        }
    }

    fn unary(&mut self) -> Result<Node, SyntaxError> {
        if self.eat(&TokenKind::Not) {
            return Ok(Node::Unary {
                op: UnaryOp::Not,
                operand: Box::new(self.unary()?),
            });
        }
        if self.eat(&TokenKind::Minus) {
            return Ok(Node::Unary {
                op: UnaryOp::Neg,
                operand: Box::new(self.unary()?),
            });
        }
        self.postfix()
    }

    fn postfix(&mut self) -> Result<Node, SyntaxError> {
        let mut node = self.primary()?;
        loop {
            if self.eat(&TokenKind::Dot) {
                let property = match self.next() {
                    Some(TokenKind::Ident(name)) => name,
                    other => {
                        let span = self
                            .tokens
                            .get(self.pos.saturating_sub(1))
                            .map_or((0, 0), |t| t.span);
                        return Err(SyntaxError::new(
                            format!("expected a name after `.`, found {other:?}"),
                            span,
                        ));
                    }
                };
                node = Node::Member {
                    object: Box::new(node),
                    property,
                };
            } else if self.eat(&TokenKind::LBracket) {
                let index = self.expr()?;
                self.expect(&TokenKind::RBracket, "`]`")?;
                node = Node::Index {
                    object: Box::new(node),
                    index: Box::new(index),
                };
            } else {
                return Ok(node);
            }
        }
    }

    fn primary(&mut self) -> Result<Node, SyntaxError> {
        let token = match self.next() {
            Some(kind) => kind,
            None => {
                return Err(SyntaxError::new(
                    "expected an expression",
                    (self.end, self.end),
                ))
            }
        };
        match token {
            TokenKind::Num(n) => Ok(Node::Literal(Literal::Num(n))),
            TokenKind::Str(s) => Ok(Node::Literal(Literal::Str(s))),
            TokenKind::LParen => {
                let node = self.expr()?;
                self.expect(&TokenKind::RParen, "`)`")?;
                Ok(node)
            }
            TokenKind::Ident(name) => match name.as_str() {
                "true" => Ok(Node::Literal(Literal::Bool(true))),
                "false" => Ok(Node::Literal(Literal::Bool(false))),
                "null" => Ok(Node::Literal(Literal::Null)),
                _ => Ok(Node::Ident(name)),
            },
            other => {
                let span = self
                    .tokens
                    .get(self.pos.saturating_sub(1))
                    .map_or((0, 0), |t| t.span);
                Err(SyntaxError::new(format!("unexpected {other:?}"), span))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_have_spans() {
        let err = parse("a == ").unwrap_err();
        assert_eq!(err.span, (5, 5));
    }
}
