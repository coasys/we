//! `we-expr`: the value layer of WE's template language — [`Value`], the [`Env`]
//! an expression reads, and [`parse`], [`eval`] and [`ParseCache`].
//!
//! The semantics are JavaScript's, because the TypeScript evaluator is the
//! reference (`packages/schema-system/shared/src/expressions/evaluate.ts`):
//! evaluation is total — a missing name is [`Value::Undefined`], never a throw —
//! `==`/`!=` are strict, `&&`/`||` answer with booleans rather than operands,
//! and a namespace (a store bag) is `Undefined` in a value position.
//!
//! The evaluator here is the minimal one E0 ships: literals, names, member and
//! index access, `==`, `!=`, `!`, `&&`, `||`, the ternary and parentheses —
//! enough for the first resolver to pick a `$if` branch. The public entry
//! points — [`parse`], [`eval`], [`Expr`] and [`ParseCache`] — are final; E1
//! replaces the grammar inside them, not the signatures.
//!
//! No egui, no I/O, no tokio: this crate builds for `wasm32-unknown-unknown`.
#![forbid(unsafe_code)]

mod env;
mod eval;
mod parse;
mod value;

pub use env::{Env, MapEnv};
pub use eval::eval;
pub use parse::{parse, Expr, ParseCache, Span, SyntaxError};
pub use value::{CallFn, CallableRef, MapNamespace, Namespace, Value, DENIED_PROPERTIES};
