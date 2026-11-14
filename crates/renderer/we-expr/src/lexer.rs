//! Tokens for the expression language — the same token set as `lexer.ts`,
//! lexed over UTF-16 code units so spans match the TypeScript positions
//! exactly (`source.length`/`source[i]` are UTF-16 there).
use crate::Span;

/// Longest an expression may be, in UTF-16 units — `MAX_EXPRESSION_LENGTH` in
/// `index.ts`. Well past anything a template writes; a bound on a hostile one.
pub const MAX_EXPRESSION_LENGTH: usize = 4000;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum TokenKind {
    /// The raw source text — the parser converts it with JS `Number`.
    Number(String),
    /// The decoded string value.
    Str(String),
    /// A backtick literal: literal runs interleaved with `${…}` hole sources.
    /// Hole `start` positions are absolute to the whole source.
    Template(Vec<TemplatePart>),
    Ident(String),
    /// An operator, a punctuation mark, or a keyword (`true`/`false`/`null`/`in`).
    Punct(String),
    Eof,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum TemplatePart {
    /// A decoded literal run.
    Text(String),
    /// The raw source of a `${…}` hole, with its absolute start offset.
    Hole { source: String, start: usize },
}

#[derive(Debug, Clone)]
pub(crate) struct Token {
    pub kind: TokenKind,
    pub span: Span,
}

/// Longest first, so `<=` is tried before `<` — the same order as
/// `PUNCTUATION` in `lexer.ts`.
const PUNCTUATION: &[&str] = &[
    "??", "&&", "||", "==", "!=", "<=", ">=", "?", ":", "!", "<", ">", "+", "-", "*", "/", "%",
    "(", ")", "[", "]", "{", "}", ",", ".",
];

const KEYWORDS: &[&str] = &["true", "false", "null", "in"];

fn is_ident_start(c: u16) -> bool {
    matches!(c, 0x41..=0x5A | 0x61..=0x7A | 0x5F | 0x24)
}

fn is_ident_part(c: u16) -> bool {
    matches!(c, 0x30..=0x39 | 0x41..=0x5A | 0x61..=0x7A | 0x5F | 0x24)
}

fn is_digit(c: u16) -> bool {
    matches!(c, 0x30..=0x39)
}

pub(crate) fn tokenize(source: &str) -> Result<Vec<Token>, crate::SyntaxError> {
    let source: Vec<u16> = source.encode_utf16().collect();
    if source.len() > MAX_EXPRESSION_LENGTH {
        return Err(crate::SyntaxError::new_raw(
            format!("Expression is longer than {MAX_EXPRESSION_LENGTH} characters"),
            (0, source.len()),
        ));
    }
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < source.len() {
        let c = source[i];
        if matches!(c, 0x20 | 0x09 | 0x0A | 0x0D) {
            i += 1;
            continue;
        }
        let start = i;

        if is_digit(c) || (c == 0x2E && source.get(i + 1).is_some_and(|d| is_digit(*d))) {
            while i < source.len() && is_digit(source[i]) {
                i += 1;
            }
            if source.get(i) == Some(&0x2E) && source.get(i + 1).is_some_and(|d| is_digit(*d)) {
                i += 1;
                while i < source.len() && is_digit(source[i]) {
                    i += 1;
                }
            }
            if matches!(source.get(i), Some(0x65 | 0x45)) {
                // `e`/`E` — an exponent only when a digit follows the sign.
                let mut j = i + 1;
                if matches!(source.get(j), Some(0x2B | 0x2D)) {
                    j += 1;
                }
                if source.get(j).is_some_and(|d| is_digit(*d)) {
                    i = j;
                    while i < source.len() && is_digit(source[i]) {
                        i += 1;
                    }
                }
            }
            tokens.push(Token {
                kind: TokenKind::Number(text(&source[start..i])),
                span: (start, i),
            });
            continue;
        }

        if c == 0x27 || c == 0x22 {
            // `'` or `"`
            let (value, end) = read_quoted(&source, i, c)?;
            tokens.push(Token {
                kind: TokenKind::Str(value),
                span: (start, end),
            });
            i = end;
            continue;
        }

        if c == 0x60 {
            // '`'
            let (parts, end) = read_template(&source, i)?;
            tokens.push(Token {
                kind: TokenKind::Template(parts),
                span: (start, end),
            });
            i = end;
            continue;
        }

        if is_ident_start(c) {
            while i < source.len() && is_ident_part(source[i]) {
                i += 1;
            }
            let word = text(&source[start..i]);
            tokens.push(Token {
                kind: if KEYWORDS.contains(&word.as_str()) {
                    TokenKind::Punct(word)
                } else {
                    TokenKind::Ident(word)
                },
                span: (start, i),
            });
            continue;
        }

        if let Some(punct) = PUNCTUATION.iter().find(|p| starts_with(&source, i, p)) {
            tokens.push(Token {
                kind: TokenKind::Punct((*punct).to_string()),
                span: (i, i + punct.len()),
            });
            i += punct.len();
            continue;
        }

        return Err(crate::SyntaxError::new_raw(
            format!(
                "Unexpected character \"{}\"",
                char::from_u32(c as u32).unwrap_or('�')
            ),
            (i, i + 1),
        ));
    }
    tokens.push(Token {
        kind: TokenKind::Eof,
        span: (source.len(), source.len()),
    });
    Ok(tokens)
}

fn text(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

fn starts_with(source: &[u16], at: usize, word: &str) -> bool {
    word.encode_utf16()
        .enumerate()
        .all(|(k, u)| source.get(at + k) == Some(&u))
}

/// `ESCAPES` in `lexer.ts` — anything else escapes to itself (`\0` → `0`,
/// `\x` → `x`, `\u` → `u`).
fn escape(next: u16) -> u16 {
    match next {
        0x6E => 0x0A, // n → \n
        0x74 => 0x09, // t → \t
        0x72 => 0x0D, // r → \r
        _ => next,    // \\ ' " ` $ and every other char → itself
    }
}

fn read_quoted(
    source: &[u16],
    start: usize,
    quote: u16,
) -> Result<(String, usize), crate::SyntaxError> {
    let mut i = start + 1;
    let mut units = Vec::new();
    while i < source.len() {
        let c = source[i];
        if c == 0x5C {
            // '\\'
            let Some(&next) = source.get(i + 1) else {
                break;
            };
            units.push(escape(next));
            i += 2;
            continue;
        }
        if c == quote {
            return Ok((text(&units), i + 1));
        }
        units.push(c);
        i += 1;
    }
    Err(crate::SyntaxError::new_raw(
        "Unterminated string",
        (start, source.len()),
    ))
}

/// Read a backtick literal. Holes come back as raw source with their absolute
/// offset, so the parser can recurse on them and errors inside a hole still
/// point at the right column.
fn read_template(
    source: &[u16],
    start: usize,
) -> Result<(Vec<TemplatePart>, usize), crate::SyntaxError> {
    let mut parts = Vec::new();
    let mut i = start + 1;
    let mut run: Vec<u16> = Vec::new();

    while i < source.len() {
        let c = source[i];
        if c == 0x5C {
            // '\\'
            let Some(&next) = source.get(i + 1) else {
                break;
            };
            run.push(escape(next));
            i += 2;
            continue;
        }
        if c == 0x60 {
            // '`'
            if !run.is_empty() {
                parts.push(TemplatePart::Text(text(&run)));
            }
            return Ok((parts, i + 1));
        }
        if c == 0x24 && source.get(i + 1) == Some(&0x7B) {
            // '${'
            if !run.is_empty() {
                parts.push(TemplatePart::Text(text(&run)));
                run = Vec::new();
            }
            let hole_start = i + 2;
            let mut depth = 1;
            let mut j = hole_start;
            // Skip over nested strings and braces so a hole may itself contain
            // an object literal or another template.
            while j < source.len() && depth > 0 {
                let d = source[j];
                if d == 0x27 || d == 0x22 {
                    j = read_quoted(source, j, d)?.1;
                    continue;
                }
                if d == 0x60 {
                    j = read_template(source, j)?.1;
                    continue;
                }
                if d == 0x7B {
                    depth += 1;
                } else if d == 0x7D {
                    depth -= 1;
                }
                if depth > 0 {
                    j += 1;
                }
            }
            if depth != 0 {
                return Err(crate::SyntaxError::new_raw(
                    "Unterminated ${ in template",
                    (i, source.len()),
                ));
            }
            parts.push(TemplatePart::Hole {
                source: text(&source[hole_start..j]),
                start: hole_start,
            });
            i = j + 1;
            continue;
        }
        run.push(c);
        i += 1;
    }
    Err(crate::SyntaxError::new_raw(
        "Unterminated template literal",
        (start, source.len()),
    ))
}
