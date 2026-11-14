//! The comprehension macros — `receiver.filter(variable, body)` and friends.
//!
//! The receiver is evaluated once, then `body` is evaluated once per element
//! against a [`ScopedEnv`]: a view over the caller's environment that answers
//! `variable` locally and delegates everything else — roots and calls — to
//! the parent. No clone of the environment, exactly as `evaluate.ts` nests
//! scope.
use crate::ast::{MacroName, Node};
use crate::{Env, Value};

/// The environment a macro body sees: the bound `variable` first, then the
/// parent's answers. Borrows the parent — nothing is cloned.
struct ScopedEnv<'a> {
    parent: &'a dyn Env,
    variable: &'a str,
    value: &'a Value,
}

impl Env for ScopedEnv<'_> {
    fn root(&self, name: &str) -> Option<Value> {
        if name == self.variable {
            Some(self.value.clone())
        } else {
            self.parent.root(name)
        }
    }

    fn call(&self, name: &str, args: &[Value]) -> Value {
        self.parent.call(name, args)
    }
}

/// `receiver` is the already-evaluated, already-settled value.
pub(crate) fn eval_macro(
    name: MacroName,
    receiver: &Value,
    variable: &str,
    body: &Node,
    env: &dyn Env,
) -> Value {
    match name {
        // `filter` on a list keeps elements whose body is truthy; a
        // non-list filters to `[]`.
        MacroName::Filter => match receiver {
            Value::List(items) => items
                .iter()
                .filter(|item| run_body(item, variable, body, env).truthy())
                .cloned()
                .collect::<Vec<Value>>()
                .into(),
            _ => Vec::<Value>::new().into(),
        },
        // `map` on a list maps each element. On a non-list it maps the single
        // object through the body — and the empty answer for anything else is
        // `[]` (`evaluate.ts`: `isRecord(receiver) ? body(receiver) : []`).
        MacroName::Map => match receiver {
            Value::List(items) => items
                .iter()
                .map(|item| run_body(item, variable, body, env))
                .collect::<Vec<Value>>()
                .into(),
            Value::Obj(_) => run_body(receiver, variable, body, env),
            _ => Vec::<Value>::new().into(),
        },
        // `find` returns the first element whose body is truthy, `undefined`
        // when none — and `undefined` on a non-list.
        MacroName::Find => match receiver {
            Value::List(items) => items
                .iter()
                .find(|item| run_body(item, variable, body, env).truthy())
                .cloned()
                .unwrap_or(Value::Undefined),
            _ => Value::Undefined,
        },
        // `exists`/`all` quantifiers: `false`/`true` on a non-list.
        MacroName::Exists => match receiver {
            Value::List(items) => items
                .iter()
                .any(|item| run_body(item, variable, body, env).truthy())
                .into(),
            _ => Value::Bool(false),
        },
        MacroName::All => match receiver {
            Value::List(items) => items
                .iter()
                .all(|item| run_body(item, variable, body, env).truthy())
                .into(),
            _ => Value::Bool(true),
        },
    }
}

fn run_body(item: &Value, variable: &str, body: &Node, env: &dyn Env) -> Value {
    let scoped = ScopedEnv {
        parent: env,
        variable,
        value: item,
    };
    crate::eval::eval_node(body, &scoped).settle()
}
