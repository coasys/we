//! [`Env`]: the two questions an evaluator may ask — what a root name means,
//! and what a function name does. Nothing else is reachable.
use std::collections::HashMap;
use std::sync::Arc;

use indexmap::IndexMap;

use crate::{CallFn, Value};

/// The environment an expression is evaluated against.
///
/// Scopes nest: node scope (`local`, `item`, `index`, the `as` names of
/// `$each`/`$agent`, query results) → store bag → built-ins. Call-time roots
/// `event`, `arg`, `result` are bound only while a handler runs.
///
/// ```
/// use we_expr::{eval, parse, Env, Value};
///
/// struct Demo;
/// impl Env for Demo {
///     fn root(&self, name: &str) -> Option<Value> {
///         // `None` says the name is not bound — `bound: false` in evaluate.ts.
///         (name == "answer").then(|| 42.into())
///     }
///     fn call(&self, _name: &str, _args: &[Value]) -> Value {
///         Value::Undefined // unknown function
///     }
/// }
///
/// let expr = parse("answer == 42").unwrap();
/// assert!(eval(&expr, &Demo {}).strict_eq(&true.into()));
/// let expr = parse("missing").unwrap();
/// assert!(eval(&expr, &Demo {}).is_undefined());
/// ```
pub trait Env {
    /// What a root name means here. `None` — the name is not bound — evaluates
    /// to `Undefined`.
    fn root(&self, name: &str) -> Option<Value>;
    /// A built-in or host-registered function. `Undefined` for a name nothing
    /// provides.
    fn call(&self, name: &str, args: &[Value]) -> Value;
}

/// An [`Env`] over two maps — roots and functions — for tests and for the
/// vector loader.
#[derive(Default)]
pub struct MapEnv {
    roots: IndexMap<Arc<str>, Value>,
    functions: HashMap<Arc<str>, CallFn>,
}

impl MapEnv {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_root(mut self, name: impl Into<Arc<str>>, value: impl Into<Value>) -> Self {
        self.set_root(name, value);
        self
    }

    pub fn set_root(&mut self, name: impl Into<Arc<str>>, value: impl Into<Value>) {
        self.roots.insert(name.into(), value.into());
    }

    pub fn with_function(
        mut self,
        name: impl Into<Arc<str>>,
        f: impl Fn(&[Value]) -> Value + Send + Sync + 'static,
    ) -> Self {
        self.functions.insert(name.into(), Arc::new(f));
        self
    }
}

impl Env for MapEnv {
    fn root(&self, name: &str) -> Option<Value> {
        self.roots.get(name).cloned()
    }

    fn call(&self, name: &str, args: &[Value]) -> Value {
        self.functions
            .get(name)
            .map(|f| f(args))
            .unwrap_or(Value::Undefined)
    }
}
