//! `we-expr`: the value layer of WE's template language — [`Value`], the [`Env`]
//! an expression reads, and [`parse`], [`eval`] and [`ParseCache`].
//!
//! The semantics are JavaScript's, because the TypeScript evaluator is the
//! reference (`packages/schema-system/shared/src/expressions/evaluate.ts`):
//! evaluation is total — a missing name is [`Value::Undefined`], never a throw —
//! `==`/`!=` are strict, `&&`/`||` answer with booleans rather than operands,
//! and a namespace (a store bag) is `Undefined` in a value position.
//!
//! The full language is here: the whole `lexer.ts`/`parser.ts` grammar
//! (conditionals, `??`, comparisons and `in`, arithmetic, calls, the five
//! comprehension macros, list/object literals, backtick templates), the
//! built-in function library of `functions.ts`, the `where.ts` matcher, and
//! the `printer.ts` canonical printer. The public entry points are the ones
//! E0 fixed: [`parse`], [`eval`], [`Expr`], [`ParseCache`], [`Value`], [`Env`].
//!
//! No egui, no I/O, no tokio: this crate builds for `wasm32-unknown-unknown`.
#![forbid(unsafe_code)]

mod ast;
mod env;
mod eval;
mod functions;
mod lexer;
mod macros;
mod parse;
mod parser;
mod print;
mod value;
mod where_match;

pub use ast::{CALL_TIME_ROOTS, WELL_KNOWN_ROOTS};
pub use env::{callback_value, Env, MapEnv};
pub use eval::eval;
pub use parse::{parse, Expr, ParseCache, Span, SyntaxError};
pub use print::print;
pub use value::{
    CallFn, CallableKind, CallableRef, MapNamespace, Namespace, Value, DENIED_PROPERTIES,
};
pub use where_match::{as_text, matches_where};
