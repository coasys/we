//! [`Env`]: the two questions an evaluator may ask — what a root name means,
//! and what a function name does. Nothing else is reachable.
use std::collections::HashMap;
use std::sync::Arc;

use indexmap::IndexMap;

use crate::{CallFn, CallableKind, CallableRef, Namespace, Value};

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

/// The value of a call-time root — `event`, `arg`, `result` — as an
/// expression reads it (`callbackValue` in `evaluate.ts`).
///
/// An object is wrapped in a namespace whose members are read as data: a
/// function member comes back [`CallableKind::Callback`]-tagged (a composer's
/// `save()` is let through on purpose), an accessor member passes through so
/// `readValue` invokes it, and anything else is wrapped recursively. The
/// namespace settles back to the raw object — `event` alone is the event,
/// not a store. Any non-object is itself, unwrapped.
///
/// ```
/// use indexmap::IndexMap;
/// use std::sync::Arc;
/// use we_expr::{callback_value, eval, parse, MapEnv, Value};
///
/// let event: Value = Value::Obj(Arc::new(IndexMap::from([
///     ("id".into(), "ev:9".into()),
/// ])));
/// let env = MapEnv::new().with_root("event", callback_value(&event));
/// assert!(eval(&parse("event.id").unwrap(), &env).strict_eq(&"ev:9".into()));
/// // `event` itself settles back to the raw object.
/// assert_eq!(
///     eval(&parse("event").unwrap(), &env).to_json(),
///     event.to_json()
/// );
/// ```
pub fn callback_value(value: &Value) -> Value {
    match value {
        Value::Obj(_) => Value::Namespace(Arc::new(CallbackNamespace { raw: value.clone() })),
        _ => value.clone(),
    }
}

/// The namespace `callback_value` wraps an object in — `CallbackNamespace` in
/// `evaluate.ts`. Member reads go through [`Namespace::get`]; [`raw`] keeps
/// the value it wraps so `settle` hands the object itself back.
///
/// [`raw`]: Namespace::raw
#[derive(Debug)]
struct CallbackNamespace {
    raw: Value,
}

impl Namespace for CallbackNamespace {
    fn get(&self, property: &str) -> Value {
        let Value::Obj(raw) = &self.raw else {
            return Value::Undefined;
        };
        let member = raw.get(property).cloned().unwrap_or(Value::Undefined);
        match member {
            Value::Callable(c) => match c.kind() {
                // A signal stays itself — `readValue` calls it.
                CallableKind::Accessor => Value::Callable(c),
                // Any other function comes back bound to the payload and
                // callback-tagged — `readValue` lets it through. (`bound` is
                // the name JavaScript reports for the bound function, and
                // what the vectors re-encode.)
                _ => Value::Callable(CallableRef::callback("bound", move |args| c.call(args))),
            },
            member => callback_value(&member),
        }
    }

    fn raw(&self) -> Option<Value> {
        Some(self.raw.clone())
    }
}
