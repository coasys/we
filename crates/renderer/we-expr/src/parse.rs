//! `parse(&str) -> Result<Expr, SyntaxError>` and [`ParseCache`] — the public
//! surface of parsing. The grammar itself lives in `lexer.rs`, `ast.rs` and
//! `parser.rs`; this module keeps the signatures everything above depends on.
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

/// `[start, end)` offsets into the source string, in UTF-16 code units — the
/// positions the TypeScript parser reports.
pub type Span = (usize, usize);

/// A parsed expression. Opaque: build it with [`parse`], evaluate it with
/// [`crate::eval`], cache it with [`ParseCache`].
pub struct Expr {
    pub(crate) root: crate::ast::Node,
}

impl fmt::Debug for Expr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The canonical print is the useful debug form.
        write!(f, "{}", crate::print::print(self))
    }
}

/// Why a source string is not an expression, with where it went wrong.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntaxError {
    pub message: String,
    pub span: Span,
}

impl SyntaxError {
    pub(crate) fn new_raw(message: impl Into<String>, span: Span) -> Self {
        Self {
            message: message.into(),
            span,
        }
    }

    /// Shift the span by `offset` — a template hole's error lands on its
    /// absolute position in the outer source.
    pub(crate) fn shift(self, offset: usize) -> Self {
        Self {
            message: self.message,
            span: (self.span.0 + offset, self.span.1 + offset),
        }
    }
}

impl fmt::Display for SyntaxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} (at {}..{})", self.message, self.span.0, self.span.1)
    }
}

impl std::error::Error for SyntaxError {}

/// Parse `source` as one expression — the whole `parser.ts` grammar:
/// conditionals, `??`, `||`, `&&`, equality, comparisons and `in`, arithmetic,
/// unary, member/index/call postfix, macros, list and object literals, and
/// backtick templates.
///
/// ```
/// use we_expr::parse;
/// assert!(parse("a.b == 'x' ? 1 : 2").is_ok());
/// assert!(parse("a ??").is_err());
/// ```
pub fn parse(source: &str) -> Result<Expr, SyntaxError> {
    crate::parser::parse_node(source)
}

/// Parses a source once and keeps the tree by its text — the same memoisation
/// the TS side does in `expressions/index.ts`. Errors are cached too: a bad
/// source stays a shared `Err`.
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
